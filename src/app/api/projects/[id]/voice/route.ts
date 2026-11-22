import { hasActiveAvatar } from "@/features/projects/video";
import { hasEnv } from "@/server/env";
import { errorCode } from "@/server/firebase-admin";
import { getProject, saveVoice } from "@/server/projects";
import { isScriptBusy, isVideoBusy, withVoiceLock } from "@/server/script-lock";
import { getSessionUser } from "@/server/session";
import { VOICE_ERROR_STATUS, VoiceGenerationError, generateVoice, voiceUrl } from "@/server/voice";

// La synthèse d'une minute de voix prend en général moins de 30 s ; le délai d'ElevenLabs est borné à 90 s.
export const maxDuration = 120;

type Context = { params: Promise<{ id: string }> };

/** Génère (ou régénère) la voix du script avec ElevenLabs : un appel facturé. Renvoie le projet et un lien d'écoute. */
export async function POST(_request: Request, { params }: Context) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!hasEnv("ELEVENLABS_API_KEY") || !hasEnv("ELEVENLABS_VOICE_ID")) {
    return Response.json({ error: "not_configured" }, { status: 503 });
  }
  const { id } = await params;

  let project;
  try {
    project = await getProject(user.uid, id);
  } catch (error) {
    console.error("[voice] project read failed", errorCode(error));
    return Response.json({ error: "server_error" }, { status: 500 });
  }
  if (!project) return Response.json({ error: "not_found" }, { status: 404 });
  if (!project.script) return Response.json({ error: "script_missing" }, { status: 409 });
  // Le script ne doit pas changer pendant la synthèse.
  if (isScriptBusy(id)) return Response.json({ error: "in_progress" }, { status: 409 });
  // fal lit le MP3 au démarrage de la vidéo : on ne le remplace pas tant qu'une vidéo est en cours.
  if (isVideoBusy(id) || hasActiveAvatar(project.avatars)) return Response.json({ error: "video_in_progress" }, { status: 409 });

  try {
    const locked = await withVoiceLock(id, async () => saveVoice(id, await generateVoice(project)));
    if (!locked) return Response.json({ error: "in_progress" }, { status: 409 });
    const saved = locked.value;
    return Response.json({ project: saved, audio: saved.voice ? await voiceUrl(saved.voice) : null });
  } catch (error) {
    if (error instanceof VoiceGenerationError) {
      console.error("[voice] generation failed", error.code, error.message);
      return Response.json({ error: error.code }, { status: VOICE_ERROR_STATUS[error.code] });
    }
    console.error("[voice] save failed", errorCode(error));
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}

/** Renvoie un nouveau lien d'écoute temporaire pour la voix existante (gratuit : aucun appel à ElevenLabs). */
export async function GET(_request: Request, { params }: Context) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  try {
    const project = await getProject(user.uid, id);
    if (!project) return Response.json({ error: "not_found" }, { status: 404 });
    if (!project.voice) return Response.json({ error: "no_voice" }, { status: 404 });
    return Response.json(await voiceUrl(project.voice), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[voice] url failed", errorCode(error));
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
