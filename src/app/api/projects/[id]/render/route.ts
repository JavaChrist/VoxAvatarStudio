import type { ProjectRenders } from "@/features/projects/render";
import { VIDEO_FORMATS, type Project, type VideoFormat } from "@/features/projects/schema";
import { hasEnv } from "@/server/env";
import { errorCode } from "@/server/firebase-admin";
import { getProject, saveRender } from "@/server/projects";
import { RENDER_ERROR_STATUS, RenderError, refreshRender, renderUrls, startRender } from "@/server/render";
import { isVideoBusy, isVoiceBusy, withRenderLock } from "@/server/script-lock";
import { getSessionUser } from "@/server/session";
import { getSignature } from "@/server/signatures";
import type { Signature } from "@/features/signatures/schema";

// Le lancement et le suivi ne font que des appels courts (GitHub, Storage) ; le rendu lui-même tourne sur GitHub Actions.
export const maxDuration = 60;

type Context = { params: Promise<{ id: string }> };
type RenderLinks = Partial<Record<VideoFormat, { url: string; downloadUrl: string; expiresAt: string }>>;

const NO_STORE = { "Cache-Control": "private, no-store" };

const isFormat = (value: unknown): value is VideoFormat => typeof value === "string" && (VIDEO_FORMATS as readonly string[]).includes(value);

async function loadProject(uid: string, id: string, scope: string): Promise<Project | null | Response> {
  try {
    return await getProject(uid, id);
  } catch (error) {
    console.error(`[render] ${scope} project read failed`, errorCode(error));
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}

/** Liens temporaires des rendus terminés (gratuit). */
async function links(renders: ProjectRenders): Promise<RenderLinks> {
  const urls: RenderLinks = {};
  for (const render of Object.values(renders)) {
    const link = await renderUrls(render);
    if (link) urls[render.format] = link;
  }
  return urls;
}

/**
 * Lance le rendu final d'un format sur GitHub Actions (gratuit).
 * Corps : { format: "9:16" | "4:5" | "1:1", signatureId?: string | null } (null ou absent : pas de signature de fin).
 */
export async function POST(request: Request, { params }: Context) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!hasEnv("GITHUB_RENDER_TOKEN")) return Response.json({ error: "not_configured" }, { status: 503 });
  const { id } = await params;

  const body = (await request.json().catch(() => null)) as { format?: unknown; signatureId?: unknown } | null;
  if (!isFormat(body?.format)) return Response.json({ error: "format_invalid" }, { status: 422 });
  const format = body.format;
  const signatureId = body.signatureId ?? null;
  if (signatureId !== null && typeof signatureId !== "string") return Response.json({ error: "invalid_input" }, { status: 400 });

  const project = await loadProject(user.uid, id, "start");
  if (project instanceof Response) return project;
  if (!project) return Response.json({ error: "not_found" }, { status: 404 });
  // Voix ou vidéo de Chris en train de changer : le rendu partirait sur des fichiers en cours de remplacement.
  if (isVoiceBusy(id) || isVideoBusy(id)) return Response.json({ error: "in_progress" }, { status: 409 });

  let signature: Signature | null = null;
  if (signatureId !== null) {
    try {
      // getSignature vérifie le propriétaire : on ne peut pas monter la signature d'un autre compte.
      signature = await getSignature(user.uid, signatureId);
    } catch (error) {
      console.error("[render] signature read failed", errorCode(error));
      return Response.json({ error: "server_error" }, { status: 500 });
    }
    if (!signature) return Response.json({ error: "signature_not_found" }, { status: 422 });
  }

  try {
    const locked = await withRenderLock(id, async () => saveRender(id, await startRender(project, format, signature)));
    if (!locked) return Response.json({ error: "in_progress" }, { status: 409 });
    return Response.json({ project: locked.value }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof RenderError) {
      console.error("[render] start failed", error.code, error.message);
      return Response.json({ error: error.code }, { status: RENDER_ERROR_STATUS[error.code] });
    }
    console.error("[render] start failed", errorCode(error));
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}

/**
 * Suivi (gratuit) : met à jour les rendus en cours (fichier de résultat dans Storage, exécution GitHub),
 * puis renvoie l'état de chaque format et des liens temporaires de lecture et de téléchargement.
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
    if (hasEnv("GITHUB_RENDER_TOKEN")) {
      // Si un autre suivi tourne déjà sur ce projet, on renvoie simplement l'état enregistré.
      await withRenderLock(id, async () => {
        for (const render of Object.values(project.renders)) {
          const updated = await refreshRender(id, render);
          if (updated) project = await saveRender(id, updated);
        }
      });
    }
    return Response.json(
      { status: project.status, renders: project.renders, urls: await links(project.renders) },
      { headers: NO_STORE },
    );
  } catch (error) {
    console.error("[render] poll failed", errorCode(error));
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
