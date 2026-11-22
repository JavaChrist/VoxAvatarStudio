import { VIDEO_FORMATS, type Project, type VideoFormat } from "@/features/projects/schema";
import type { AvatarVideos } from "@/features/projects/video";
import { isVoiceStale } from "@/features/projects/voice";
import { hasEnv } from "@/server/env";
import { errorCode } from "@/server/firebase-admin";
import { getProject, saveAvatar } from "@/server/projects";
import { isVoiceBusy, withVideoLock } from "@/server/script-lock";
import { getSessionUser } from "@/server/session";
import { AVATAR_ERROR_STATUS, AvatarGenerationError, avatarUrl, refreshAvatar, startAvatar } from "@/server/video";

// Le suivi peut copier une vidéo de 90 s (environ 90 Mo) de fal vers Storage ; le lancement est quasi immédiat.
export const maxDuration = 300;

type Context = { params: Promise<{ id: string }> };
type PlaybackUrls = Partial<Record<VideoFormat, { url: string; expiresAt: string }>>;

const NO_STORE = { "Cache-Control": "private, no-store" };

const isFormat = (value: unknown): value is VideoFormat => typeof value === "string" && (VIDEO_FORMATS as readonly string[]).includes(value);

async function loadProject(uid: string, id: string, scope: string): Promise<Project | null | Response> {
  try {
    return await getProject(uid, id);
  } catch (error) {
    console.error(`[video] ${scope} project read failed`, errorCode(error));
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}

/** Liens de lecture temporaires des formats terminés (gratuit). */
async function playbackUrls(avatars: AvatarVideos): Promise<PlaybackUrls> {
  const urls: PlaybackUrls = {};
  for (const video of Object.values(avatars)) {
    const link = await avatarUrl(video);
    if (link) urls[video.format] = link;
  }
  return urls;
}

/** Lance la vidéo d'un format chez fal : un appel facturé. Corps : { format: "9:16" | "4:5" | "1:1" }. */
export async function POST(request: Request, { params }: Context) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!hasEnv("FAL_KEY")) return Response.json({ error: "not_configured" }, { status: 503 });
  const { id } = await params;

  const body = (await request.json().catch(() => null)) as { format?: unknown } | null;
  if (!isFormat(body?.format)) return Response.json({ error: "format_invalid" }, { status: 422 });
  const format = body.format;

  const project = await loadProject(user.uid, id, "start");
  if (project instanceof Response) return project;
  if (!project) return Response.json({ error: "not_found" }, { status: 404 });
  if (!project.voice) return Response.json({ error: "voice_missing" }, { status: 409 });
  // Pas de vidéo payante sur une voix qui ne correspond plus au script.
  if (isVoiceStale(project.voice, project.script)) return Response.json({ error: "voice_stale" }, { status: 409 });
  if (isVoiceBusy(id)) return Response.json({ error: "in_progress" }, { status: 409 });

  try {
    const locked = await withVideoLock(id, async () => saveAvatar(id, await startAvatar(project, format)));
    if (!locked) return Response.json({ error: "in_progress" }, { status: 409 });
    return Response.json({ project: locked.value }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof AvatarGenerationError) {
      console.error("[video] start failed", error.code, error.message);
      return Response.json({ error: error.code }, { status: AVATAR_ERROR_STATUS[error.code] });
    }
    console.error("[video] save failed", errorCode(error));
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}

/**
 * Suivi (gratuit) : met à jour les formats en cours auprès de fal, copie les vidéos terminées dans Storage,
 * puis renvoie l'état de chaque format et un lien de lecture temporaire pour ceux qui sont prêts.
 */
export async function GET(_request: Request, { params }: Context) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const found = await loadProject(user.uid, id, "poll");
  if (found instanceof Response) return found;
  if (!found) return Response.json({ error: "not_found" }, { status: 404 });
  let project = found;

  try {
    if (hasEnv("FAL_KEY")) {
      // Si un autre suivi tourne déjà sur ce projet, on renvoie simplement l'état enregistré.
      await withVideoLock(id, async () => {
        for (const video of Object.values(project.avatars)) {
          const updated = await refreshAvatar(id, video);
          if (updated) project = await saveAvatar(id, updated);
        }
      });
    }
    return Response.json(
      { status: project.status, avatars: project.avatars, urls: await playbackUrls(project.avatars) },
      { headers: NO_STORE },
    );
  } catch (error) {
    console.error("[video] poll failed", errorCode(error));
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
