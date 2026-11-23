import "server-only";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { ApiError } from "@fal-ai/client";
import { outfitPose, type Appearance } from "@/features/projects/appearance";
import type { Project, VideoFormat } from "@/features/projects/schema";
import {
  avatarCostUsd,
  avatarStoragePath,
  estimateAvatarCostUsd,
  isAvatarPending,
  isAvatarStalled,
  type AvatarVideo,
} from "@/features/projects/video";
import { adminBucket } from "./firebase-admin";
import { AVATAR_ENDPOINT, falClient } from "./providers/fal";

// Vidéo de Chris qui parle : Kling AI Avatar v2 Pro via la file d'attente fal (image + voix → MP4 sur fond vert).
// Doc vérifiée le 2026-11-23 : fal.ai/models/fal-ai/kling-video/ai-avatar/v2/pro/api et fal.ai/docs/model-apis/model-endpoints/queue

/** Validité des liens signés envoyés à fal pour lire l'image et la voix. */
const INPUT_URL_TTL_SECONDS = 2 * 60 * 60;

/** Si le travail n'a pas démarré avant ce délai, fal l'abandonne : les liens signés seraient expirés. */
const START_TIMEOUT_SECONDS = 100 * 60;

/** fal supprime la vidéo produite après 24 h ; on la copie dans Storage dès qu'elle est prête. */
const OUTPUT_LIFECYCLE = JSON.stringify({ expiration_duration_seconds: 24 * 60 * 60 });

/** Garde-fou de taille au téléchargement : le spike donnait environ 1 Mo par seconde, 90 s font donc environ 90 Mo. */
const MAX_VIDEO_BYTES = 400 * 1024 * 1024;

/** Durée de validité d'un lien de lecture dans l'app. */
export const AVATAR_URL_TTL_SECONDS = 15 * 60;

/** Erreur métier : `code` est renvoyé au navigateur, jamais le détail du fournisseur. */
export class AvatarGenerationError extends Error {
  constructor(
    readonly code: "voice_missing" | "format_invalid" | "already_running" | "reference_missing" | "provider_busy" | "provider_error",
    detail: string,
  ) {
    super(detail);
  }
}

/** Statut HTTP renvoyé pour chaque erreur métier. */
export const AVATAR_ERROR_STATUS: Record<AvatarGenerationError["code"], number> = {
  voice_missing: 409,
  format_invalid: 422,
  already_running: 409,
  reference_missing: 500,
  provider_busy: 503,
  provider_error: 502,
};

/**
 * Image de référence de Chris pour une tenue, une pose et un format :
 * même chemin dans le dépôt et dans le bucket (npm run upload:character).
 */
function referencePath(appearance: Appearance, format: VideoFormat): string {
  const path = outfitPose(appearance)?.referenceImages[format];
  if (!path) throw new AvatarGenerationError("reference_missing", `pas d'image pour ${appearance.outfit} ${appearance.pose} ${format}`);
  return path;
}

/** Lien de lecture signé V4 (gratuit, signé localement avec la clé du compte de service). */
export async function signedReadUrl(path: string, ttlSeconds: number, responseType?: string, responseDisposition?: string) {
  const expires = Date.now() + ttlSeconds * 1000;
  const [url] = await adminBucket()
    .file(path)
    .getSignedUrl({ version: "v4", action: "read", expires, responseType, responseDisposition });
  return { url, expiresAt: new Date(expires).toISOString() };
}

/**
 * Lance la génération d'un format chez fal (un appel facturé, environ 0,115 $ par seconde de vidéo).
 * Ne fait qu'inscrire le travail dans la file : le résultat se récupère ensuite avec refreshAvatar.
 * Le propriétaire du projet doit avoir été vérifié par getProject ; l'appelant enregistre le résultat avec saveAvatar.
 */
export async function startAvatar(project: Project, format: VideoFormat): Promise<AvatarVideo> {
  const voice = project.voice;
  if (!voice) throw new AvatarGenerationError("voice_missing", "pas de voix");
  if (!project.formats.includes(format)) throw new AvatarGenerationError("format_invalid", `format ${format} non choisi`);
  const current = project.avatars[format];
  if (current && isAvatarPending(current) && !isAvatarStalled(current)) {
    throw new AvatarGenerationError("already_running", "génération déjà en cours");
  }

  const appearance = project.appearance;
  const imagePath = referencePath(appearance, format);
  const [exists] = await adminBucket().file(imagePath).exists();
  if (!exists) throw new AvatarGenerationError("reference_missing", "image absente du bucket");

  // Liens signés localement avec la clé du compte de service (gratuit) ; fal les lit sans autre accès au bucket.
  const [image, audio] = await Promise.all([
    signedReadUrl(imagePath, INPUT_URL_TTL_SECONDS),
    signedReadUrl(voice.storagePath, INPUT_URL_TTL_SECONDS),
  ]);

  let requestId: string;
  try {
    const queued = await falClient().queue.submit(AVATAR_ENDPOINT, {
      input: { image_url: image.url, audio_url: audio.url },
      startTimeout: START_TIMEOUT_SECONDS,
      headers: { "X-Fal-Object-Lifecycle-Preference": OUTPUT_LIFECYCLE },
    });
    requestId = queued.request_id;
  } catch (error) {
    // Le corps d'erreur fal peut citer les URL signées : on ne garde que le statut.
    const status = error instanceof ApiError ? error.status : 0;
    if (status === 429) throw new AvatarGenerationError("provider_busy", "fal 429");
    throw new AvatarGenerationError("provider_error", `fal submit ${status || "réseau"}`);
  }

  const estimatedCostUsd = Math.round(estimateAvatarCostUsd(voice.durationSeconds) * 1000) / 1000;
  console.info("[video] submitted", { format, ...appearance, requestId, voiceSeconds: voice.durationSeconds, estimatedCostUsd });
  return {
    format,
    state: "queued",
    requestId,
    voiceGeneratedAt: voice.generatedAt,
    voiceSeconds: voice.durationSeconds,
    estimatedCostUsd,
    submittedAt: new Date().toISOString(),
    completedAt: null,
    storagePath: null,
    durationSeconds: null,
    costUsd: null,
    error: null,
    outfit: appearance.outfit,
    pose: appearance.pose,
  };
}

const failed = (video: AvatarVideo, error: string): AvatarVideo => ({
  ...video,
  state: "failed",
  error,
  completedAt: new Date().toISOString(),
});

/** Accepte seulement une URL https du CDN de fal, pour ne jamais télécharger autre chose côté serveur. */
function isFalMediaUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "fal.media" || url.hostname.endsWith(".fal.media"));
  } catch {
    return false;
  }
}

/** Copie le MP4 de fal vers Storage en flux (pas tout en mémoire), en privé, avec une limite de taille. */
async function copyToStorage(sourceUrl: string, storagePath: string): Promise<number> {
  const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(240_000) });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error(`téléchargement ${response.status}`);
  }
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_VIDEO_BYTES) {
    await response.body.cancel();
    throw new Error("vidéo trop lourde");
  }

  let bytes = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      callback(bytes > MAX_VIDEO_BYTES ? new Error("vidéo trop lourde") : null, chunk);
    },
  });
  const file = adminBucket().file(storagePath);
  // Aucun jeton de téléchargement Firebase : lecture uniquement par URL signée côté serveur.
  await pipeline(
    Readable.fromWeb(response.body as WebReadableStream<Uint8Array>),
    limiter,
    file.createWriteStream({ resumable: false, contentType: "video/mp4", metadata: { cacheControl: "private, no-store" } }),
  );
  if (bytes === 0) throw new Error("vidéo vide");
  return bytes;
}

/**
 * Met à jour un format en cours à partir de la file fal (gratuit) et, quand c'est fini, copie la vidéo dans Storage.
 * Renvoie null si rien n'a changé. Le propriétaire du projet doit avoir été vérifié par getProject.
 */
export async function refreshAvatar(projectId: string, video: AvatarVideo): Promise<AvatarVideo | null> {
  if (!isAvatarPending(video)) return null;
  if (isAvatarStalled(video)) return failed(video, "La génération n'a pas abouti dans le délai prévu.");

  const fal = falClient();
  let status;
  try {
    status = await fal.queue.status(AVATAR_ENDPOINT, { requestId: video.requestId, abortSignal: AbortSignal.timeout(20_000) });
  } catch (error) {
    // 404 : fal ne connaît plus ce travail (résultat expiré). Sinon on réessaiera au prochain suivi.
    if (error instanceof ApiError && error.status === 404) return failed(video, "fal ne retrouve plus cette génération.");
    console.warn("[video] status failed", error instanceof ApiError ? error.status : "réseau");
    return null;
  }

  if (status.status === "IN_QUEUE") return null;
  if (status.status === "IN_PROGRESS") return video.state === "running" ? null : { ...video, state: "running" };

  let output: { video?: { url?: unknown }; duration?: unknown };
  try {
    const result = await fal.queue.result(AVATAR_ENDPOINT, { requestId: video.requestId, abortSignal: AbortSignal.timeout(30_000) });
    output = result.data;
  } catch (error) {
    if (error instanceof ApiError) {
      console.warn("[video] generation failed", { requestId: video.requestId, status: error.status });
      // Le travail est terminé : une erreur ici est un échec de génération (entrée refusée, contrôle de sécurité…),
      // sauf surcharge passagère de fal, où l'on réessaiera au prochain suivi.
      if (![429, 502, 503, 504].includes(error.status)) return failed(video, `fal n'a pas pu générer la vidéo (${error.status}).`);
    }
    return null;
  }

  if (!isFalMediaUrl(output.video?.url)) return failed(video, "fal n'a pas renvoyé de vidéo exploitable.");
  const durationSeconds = typeof output.duration === "number" && output.duration > 0 ? Math.round(output.duration * 1000) / 1000 : null;
  const storagePath = avatarStoragePath(projectId, video.format);
  try {
    const bytes = await copyToStorage(output.video.url, storagePath);
    const costUsd = durationSeconds === null ? null : Math.round(avatarCostUsd(durationSeconds) * 1000) / 1000;
    console.info("[video] usage", { format: video.format, requestId: video.requestId, seconds: durationSeconds, costUsd, bytes });
    return { ...video, state: "done", storagePath, durationSeconds, costUsd, error: null, completedAt: new Date().toISOString() };
  } catch (error) {
    // La vidéo reste chez fal 24 h : on réessaiera la copie au prochain suivi.
    console.warn("[video] copy failed", error instanceof Error ? error.message : "inconnu");
    return null;
  }
}

/** Lien de lecture temporaire du MP4 (URL signée V4, gratuite). Le propriétaire doit avoir été vérifié par getProject. */
export async function avatarUrl(video: AvatarVideo): Promise<{ url: string; expiresAt: string } | null> {
  if (video.state !== "done" || !video.storagePath) return null;
  return signedReadUrl(video.storagePath, AVATAR_URL_TTL_SECONDS, "video/mp4");
}
