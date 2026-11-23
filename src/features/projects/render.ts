// Rendu final d'un format (détourage + montage Remotion), exécuté sur GitHub Actions.
// Partagé entre le serveur et le navigateur : aucun secret ici.
import type { VideoFormat } from "./schema";
import { isAvatarStale, type AvatarVideo } from "./video";
import type { Voice } from "./voice";

/**
 * Au-delà, un rendu resté « en cours » est considéré comme bloqué : le workflow s'arrête de lui-même
 * après 30 min (timeout-minutes), plus l'attente d'un runner. Il peut alors être relancé.
 */
export const RENDER_STALL_AFTER_MS = 50 * 60 * 1000;

/** Durée observée au test local du 2026-11-23 : environ 2 min pour 35 s de vidéo. Sert seulement à l'affichage. */
export const RENDER_ESTIMATED_MINUTES = 5;

/** Identifiant de rendu accepté par le workflow (même motif que .github/workflows/render.yml). */
export const isValidRenderId = (id: string) => /^[A-Za-z0-9_-]{8,64}$/.test(id);

/** queued : workflow demandé ; running : runner au travail ; done : MP4 dans Storage ; failed : échec du workflow. */
export type RenderState = "queued" | "running" | "done" | "failed";

/** Métadonnées enregistrées sur le projet. Le MP4 reste privé dans Storage. */
export interface ProjectRender {
  format: VideoFormat;
  state: RenderState;
  /** Seule donnée transmise au workflow public ; le détail du travail est dans render-jobs/{renderId}.json. */
  renderId: string;
  /** Exécution GitHub Actions correspondante, si l'API l'a renvoyée. */
  runId: number | null;
  /** Date de fin de la vidéo de Chris utilisée : si elle est régénérée, le rendu est périmé. */
  avatarCompletedAt: string;
  submittedAt: string;
  completedAt: string | null;
  /** Chemin du MP4 dans le bucket ; servi au navigateur uniquement par URL signée temporaire. */
  storagePath: string | null;
  sizeBytes: number | null;
  renderSeconds: number | null;
  /** Message d'erreur lisible, sans détail technique sensible. */
  error: string | null;
}

/** Un rendu par format déjà lancé. */
export type ProjectRenders = Partial<Record<VideoFormat, ProjectRender>>;

export const isRenderPending = (render: ProjectRender) => render.state === "queued" || render.state === "running";

export const isRenderStalled = (render: ProjectRender, now = Date.now()) =>
  isRenderPending(render) && now - Date.parse(render.submittedAt) > RENDER_STALL_AFTER_MS;

/** Vrai si le rendu ne correspond plus à la vidéo de Chris (ou à la voix) actuelle du format. */
export const isRenderStale = (render: ProjectRender, avatar: AvatarVideo | undefined, voice: Voice | null) =>
  !avatar || avatar.state !== "done" || avatar.completedAt !== render.avatarCompletedAt || isAvatarStale(avatar, voice);

/** Chemin privé du MP4 final : `9:16` devient `render-9x16.mp4` (même règle que remotion/scripts/render-job.mjs). */
export const renderStoragePath = (projectId: string, format: VideoFormat) =>
  `projects/${projectId}/render-${format.replace(":", "x")}.mp4`;

/** Vrai si un rendu tourne (hors rendu bloqué) : il écrit encore dans les fichiers du projet. */
export const hasActiveRender = (renders: ProjectRenders, now = Date.now()) =>
  Object.values(renders).some((render) => isRenderPending(render) && !isRenderStalled(render, now));
