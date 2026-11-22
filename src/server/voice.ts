import "server-only";
import type { Project } from "@/features/projects/schema";
import type { Script } from "@/features/projects/script";
import { SCENE_SEPARATOR, textHash, voiceText, type SceneTiming, type Voice } from "@/features/projects/voice";
import { adminBucket } from "./firebase-admin";
import { elevenLabsFetch, voiceId } from "./providers/elevenlabs";

// Synthèse de la voix off avec ElevenLabs (text-to-speech with timestamps), puis stockage privé dans Firebase Storage.
// Doc : elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps

export const VOICE_MODEL = "eleven_v4";
const OUTPUT_FORMAT = "mp3_44100_128";

/** Garde-fou de coût : un script de 90 s fait environ 1 400 caractères. */
export const MAX_VOICE_CHARACTERS = 5000;

/** Erreur métier : `code` est renvoyé au navigateur, jamais le détail du fournisseur. */
export class VoiceGenerationError extends Error {
  constructor(
    readonly code: "script_missing" | "text_too_long" | "provider_busy" | "provider_error" | "voice_invalid",
    detail: string,
  ) {
    super(detail);
  }
}

/** Statut HTTP renvoyé pour chaque erreur métier. */
export const VOICE_ERROR_STATUS: Record<VoiceGenerationError["code"], number> = {
  script_missing: 409,
  text_too_long: 422,
  provider_busy: 503,
  provider_error: 502,
  voice_invalid: 502,
};

interface Alignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

interface TimestampsResponse {
  audio_base64?: unknown;
  alignment?: Alignment | null;
}

const isAlignment = (value: unknown): value is Alignment => {
  const a = value as Partial<Alignment> | null;
  return (
    !!a &&
    Array.isArray(a.characters) &&
    Array.isArray(a.character_start_times_seconds) &&
    Array.isArray(a.character_end_times_seconds) &&
    a.characters.length > 0 &&
    a.characters.length === a.character_start_times_seconds.length &&
    a.characters.length === a.character_end_times_seconds.length
  );
};

/** Un appel facturé à ElevenLabs ; renvoie le MP3 et l'alignement sur le texte d'origine. */
async function requestSpeech(text: string): Promise<{ audio: Buffer; alignment: Alignment }> {
  let response: Response;
  try {
    response = await elevenLabsFetch(`/text-to-speech/${encodeURIComponent(voiceId())}/with-timestamps?output_format=${OUTPUT_FORMAT}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        text,
        model_id: VOICE_MODEL,
        language_code: "fr",
        voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0, speed: 1, use_speaker_boost: true },
      }),
      // Pas de nouvel essai automatique : chaque appel est facturé.
      signal: AbortSignal.timeout(90_000),
    });
  } catch (error) {
    const reason = error instanceof Error && error.name === "TimeoutError" ? "délai dépassé" : "réseau";
    throw new VoiceGenerationError("provider_error", `ElevenLabs ${reason}`);
  }

  if (!response.ok) {
    // Le corps d'erreur peut citer le texte ou l'identifiant de voix : on ne garde que le statut.
    await response.body?.cancel();
    if (response.status === 429) throw new VoiceGenerationError("provider_busy", "ElevenLabs 429");
    throw new VoiceGenerationError("provider_error", `ElevenLabs ${response.status}`);
  }

  let data: TimestampsResponse;
  try {
    data = (await response.json()) as TimestampsResponse;
  } catch {
    throw new VoiceGenerationError("voice_invalid", "JSON illisible");
  }
  if (typeof data.audio_base64 !== "string" || !data.audio_base64) {
    throw new VoiceGenerationError("voice_invalid", "audio absent");
  }
  if (!isAlignment(data.alignment)) throw new VoiceGenerationError("voice_invalid", "alignement absent");
  const audio = Buffer.from(data.audio_base64, "base64");
  if (audio.length === 0) throw new VoiceGenerationError("voice_invalid", "audio vide");
  return { audio, alignment: data.alignment };
}

/**
 * Bornes de chaque scène dans l'audio, à partir de l'alignement caractère par caractère.
 * L'alignement porte sur le texte envoyé ; si sa longueur diffère, on répartit au prorata des caractères.
 */
function sceneTimings(script: Script, alignment: Alignment, duration: number): SceneTiming[] {
  const starts = alignment.character_start_times_seconds;
  const ends = alignment.character_end_times_seconds;
  const total = voiceText(script).length;
  const scale = alignment.characters.length / total;
  const at = (list: number[], index: number) => list[Math.min(list.length - 1, Math.max(0, Math.round(index * scale)))] ?? 0;

  let offset = 0;
  return script.scenes.map((scene, i) => {
    const first = offset;
    const last = offset + scene.spokenText.length - 1;
    offset += scene.spokenText.length + SCENE_SEPARATOR.length;
    const start = i === 0 ? 0 : at(starts, first);
    const end = i === script.scenes.length - 1 ? duration : at(ends, last);
    return { start: round(start), end: round(Math.max(start, end)) };
  });
}

const round = (seconds: number) => Math.round(seconds * 1000) / 1000;

/** Durée de validité d'un lien d'écoute. */
export const VOICE_URL_TTL_SECONDS = 15 * 60;

/**
 * Lien de lecture temporaire (URL signée V4, signée localement avec la clé du compte de service, gratuit).
 * Le propriétaire du projet doit avoir été vérifié par getProject.
 */
export async function voiceUrl(voice: Voice): Promise<{ url: string; expiresAt: string }> {
  const expires = Date.now() + VOICE_URL_TTL_SECONDS * 1000;
  const [url] = await adminBucket().file(voice.storagePath).getSignedUrl({
    version: "v4",
    action: "read",
    expires,
    responseType: "audio/mpeg",
  });
  return { url, expiresAt: new Date(expires).toISOString() };
}

/**
 * Génère la voix du script (un appel facturé), puis enregistre le MP3 et l'alignement dans Storage, en privé.
 * Le propriétaire du projet doit avoir été vérifié par getProject.
 */
export async function generateVoice(project: Project): Promise<Voice> {
  const script = project.script;
  if (!script || script.scenes.length === 0) throw new VoiceGenerationError("script_missing", "pas de script");
  const text = voiceText(script);
  if (text.length > MAX_VOICE_CHARACTERS) {
    throw new VoiceGenerationError("text_too_long", `${text.length} caractères`);
  }

  const { audio, alignment } = await requestSpeech(text);
  const durationSeconds = round(Math.max(...alignment.character_end_times_seconds));
  console.info("[voice] usage", { model: VOICE_MODEL, characters: text.length, seconds: durationSeconds, bytes: audio.length });

  const storagePath = `projects/${project.id}/voice.mp3`;
  const alignmentPath = `projects/${project.id}/voice-alignment.json`;
  const bucket = adminBucket();
  // Fichiers privés : ni lien public ni jeton de téléchargement ; lecture uniquement par URL signée côté serveur.
  await Promise.all([
    bucket.file(storagePath).save(audio, { resumable: false, contentType: "audio/mpeg", metadata: { cacheControl: "private, no-store" } }),
    bucket.file(alignmentPath).save(JSON.stringify(alignment), {
      resumable: false,
      contentType: "application/json",
      metadata: { cacheControl: "private, no-store" },
    }),
  ]);

  return {
    storagePath,
    alignmentPath,
    durationSeconds,
    characters: text.length,
    model: VOICE_MODEL,
    scenes: sceneTimings(script, alignment, durationSeconds),
    scriptHash: textHash(text),
    generatedAt: new Date().toISOString(),
  };
}
