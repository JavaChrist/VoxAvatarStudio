// Vidéo « Chris qui parle » d'un projet (Kling AI Avatar v2 Pro sur fal.ai), une par format, sur fond vert.
// Partagé entre le serveur et le navigateur : aucun secret ici.
import { DEFAULT_APPEARANCE, sameAppearance, type Appearance, type Pose } from "./appearance";
import type { VideoFormat } from "./schema";
import type { Voice } from "./voice";

/** Tarif relevé le 2026-11-23 sur fal.ai/models/fal-ai/kling-video/ai-avatar/v2/pro : facturé à la seconde de vidéo produite. */
export const AVATAR_PRICE_PER_SECOND_USD = 0.115;

/** Silence que Kling ajoute en fin de vidéo (mesuré au spike du 2026-11-22) : il est facturé aussi. */
export const AVATAR_BILLED_TAIL_SECONDS = 1.6;

/** Temps de génération observé au spike : environ 40 s par seconde de vidéo. Sert seulement à l'affichage. */
export const AVATAR_GENERATION_SECONDS_PER_SECOND = 40;

/**
 * Au-delà, un travail resté « en cours » est considéré comme bloqué : fal ne garde le résultat qu'environ 1 h
 * après la fin, donc il ne sera plus récupérable. Le projet peut alors être relancé ou supprimé.
 */
export const AVATAR_STALL_AFTER_MS = 3 * 60 * 60 * 1000;

/** queued et running : travail chez fal ; done : MP4 copié dans Storage ; failed : erreur renvoyée par fal ou par la copie. */
export type AvatarState = "queued" | "running" | "done" | "failed";

/** Métadonnées enregistrées sur le projet. Le MP4 reste privé dans Storage. */
export interface AvatarVideo {
  format: VideoFormat;
  state: AvatarState;
  /** Identifiant de la file fal, pour suivre le travail depuis n'importe quelle requête. */
  requestId: string;
  /** Date de génération de la voix utilisée : si la voix est régénérée, la vidéo est périmée. */
  voiceGeneratedAt: string;
  /** Durée de la voix envoyée, base de l'estimation. */
  voiceSeconds: number;
  estimatedCostUsd: number;
  submittedAt: string;
  completedAt: string | null;
  /** Chemin du MP4 dans le bucket ; servi au navigateur uniquement par URL signée temporaire. */
  storagePath: string | null;
  /** Durée réelle renvoyée par fal, qui sert au coût réel. */
  durationSeconds: number | null;
  costUsd: number | null;
  /** Message d'erreur lisible, sans détail technique sensible. */
  error: string | null;
  /** Tenue et pose de Chris utilisées ; absentes sur les vidéos d'avant les tenues (T-shirt gris, debout). */
  outfit?: string;
  pose?: Pose;
}

/** Une entrée par format déjà lancé. */
export type AvatarVideos = Partial<Record<VideoFormat, AvatarVideo>>;

export const avatarCostUsd = (videoSeconds: number) => videoSeconds * AVATAR_PRICE_PER_SECOND_USD;

/** Estimation avant génération : durée de la voix plus la fin silencieuse facturée. */
export const estimateAvatarSeconds = (voiceSeconds: number) => voiceSeconds + AVATAR_BILLED_TAIL_SECONDS;
export const estimateAvatarCostUsd = (voiceSeconds: number) => avatarCostUsd(estimateAvatarSeconds(voiceSeconds));
export const estimateAvatarMinutes = (voiceSeconds: number) =>
  Math.max(1, Math.ceil((estimateAvatarSeconds(voiceSeconds) * AVATAR_GENERATION_SECONDS_PER_SECOND) / 60));

export const isAvatarPending = (video: AvatarVideo) => video.state === "queued" || video.state === "running";

/** Vrai si un travail en cours dépasse le délai au-delà duquel son résultat n'est plus récupérable. */
export const isAvatarStalled = (video: AvatarVideo, now = Date.now()) =>
  isAvatarPending(video) && now - Date.parse(video.submittedAt) > AVATAR_STALL_AFTER_MS;

/** Tenue et pose avec lesquelles la vidéo a été générée. */
export const avatarAppearance = (video: AvatarVideo): Appearance =>
  video.outfit && video.pose ? { outfit: video.outfit, pose: video.pose } : DEFAULT_APPEARANCE;

/** Vrai si la vidéo a été générée avec une autre tenue ou une autre pose que celles du projet. */
export const isAvatarOtherAppearance = (video: AvatarVideo, appearance: Appearance) =>
  !sameAppearance(avatarAppearance(video), appearance);

/** Vrai si la vidéo ne correspond plus à la voix actuelle du projet, ou à sa tenue et sa pose. */
export const isAvatarStale = (video: AvatarVideo, voice: Voice | null, appearance: Appearance) =>
  !voice || video.voiceGeneratedAt !== voice.generatedAt || isAvatarOtherAppearance(video, appearance);

/** Chemin privé du MP4 d'un format : `9:16` devient `avatar-9x16.mp4`. */
export const avatarStoragePath = (projectId: string, format: VideoFormat) =>
  `projects/${projectId}/avatar-${format.replace(":", "x")}.mp4`;

/** Vrai si une vidéo est en cours chez fal (hors travail bloqué) : la voix et le projet ne doivent pas changer pendant ce temps. */
export const hasActiveAvatar = (avatars: AvatarVideos, now = Date.now()) =>
  Object.values(avatars).some((video) => isAvatarPending(video) && !isAvatarStalled(video, now));
