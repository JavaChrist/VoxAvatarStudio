import "server-only";
import { randomBytes } from "node:crypto";
import {
  isRenderPending,
  isRenderStalled,
  renderStoragePath,
  type ProjectRender,
} from "@/features/projects/render";
import type { Project, VideoFormat } from "@/features/projects/schema";
import { applyOverride, isEmptyOverride } from "@/features/projects/signature-override";
import { INSERT_EXTENSIONS } from "@/features/projects/inserts";
import { isVoiceStale, type Voice } from "@/features/projects/voice";
import type { Background } from "@/features/backgrounds/schema";
import { MUSIC_EXTENSIONS, type Music } from "@/features/music/schema";
import type { Signature } from "@/features/signatures/schema";
import { requireEnv } from "./env";
import { adminBucket } from "./firebase-admin";
import { signedReadUrl } from "./video";

// Rendu final sur GitHub Actions (.github/workflows/render.yml, script remotion/scripts/render-job.mjs).
// Doc vérifiée le 2026-11-23 : docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event
// docs.github.com/en/rest/actions/workflow-runs#get-a-workflow-run et #list-workflow-runs-for-a-workflow
//
// Le dépôt est public : seul l'identifiant aléatoire du rendu part vers GitHub. Le détail du travail
// (projet, format, titre, durée, signature de fin, fond, musique, images insérées) est écrit dans le fichier privé render-jobs/{renderId}.json du bucket.

const REPOSITORY = "JavaChrist/VoxAvatarStudio";
const WORKFLOW_FILE = "render.yml";
const WORKFLOW_REF = "main";
const GITHUB_API = "https://api.github.com";

/** Limite du titre dans le fichier de travail (contrôlée aussi par render-job.mjs). */
const TITLE_MAX = 200;
/** Limite de durée acceptée par render-job.mjs. */
const MAX_SECONDS = 120;

/** Durée de validité d'un lien de lecture ou de téléchargement dans l'app. */
export const RENDER_URL_TTL_SECONDS = 15 * 60;

/** Erreur métier : `code` est renvoyé au navigateur, jamais le détail du fournisseur. */
export class RenderError extends Error {
  constructor(
    readonly code: "format_invalid" | "avatar_missing" | "avatar_stale" | "voice_stale" | "too_long" | "already_running" | "provider_error",
    detail: string,
  ) {
    super(detail);
  }
}

/** Statut HTTP renvoyé pour chaque erreur métier. */
export const RENDER_ERROR_STATUS: Record<RenderError["code"], number> = {
  format_invalid: 422,
  avatar_missing: 409,
  avatar_stale: 409,
  voice_stale: 409,
  too_long: 422,
  already_running: 409,
  provider_error: 502,
};

const jobPath = (renderId: string) => `render-jobs/${renderId}.json`;
/** Copie du logo pour ce rendu : la signature peut changer ou être supprimée pendant que le workflow tourne. */
const jobLogoPath = (renderId: string, storagePath: string) =>
  `render-jobs/${renderId}.logo.${storagePath.split(".").pop() ?? "png"}`;

/** Instantané de la signature écrit dans le fichier de travail (lu par render-job.mjs). */
type JobSignature = {
  displayName: string;
  tagline: string;
  website: string;
  handle: string;
  qrUrl: string;
  /** Copie privée du logo dans render-jobs/, ou null. */
  logoPath: string | null;
  logoType: string | null;
};

/** Copie la signature et son logo pour ce rendu ; les fichiers render-jobs/{renderId}.* sont supprimés à la fin. */
async function snapshotSignature(renderId: string, signature: Signature): Promise<JobSignature> {
  let logoPath: string | null = null;
  if (signature.logo) {
    logoPath = jobLogoPath(renderId, signature.logo.storagePath);
    await adminBucket().file(signature.logo.storagePath).copy(adminBucket().file(logoPath));
  }
  return {
    displayName: signature.displayName,
    tagline: signature.tagline,
    website: signature.website,
    handle: signature.handle,
    qrUrl: signature.qrUrl,
    logoPath,
    logoType: signature.logo?.contentType ?? null,
  };
}
/** Copie du fond pour ce rendu : il peut être supprimé pendant que le workflow tourne. */
async function snapshotBackground(renderId: string, background: Background): Promise<{ path: string; type: string }> {
  const path = `render-jobs/${renderId}.background.${background.image.storagePath.split(".").pop() ?? "png"}`;
  await adminBucket().file(background.image.storagePath).copy(adminBucket().file(path));
  return { path, type: background.image.contentType };
}

/** Musique choisie pour un rendu, avec son volume sous la voix en pourcentage. */
export type RenderMusic = { music: Music; volume: number };

/** Copie de la musique pour ce rendu : elle peut être supprimée pendant que le workflow tourne. */
async function snapshotMusic(renderId: string, { music, volume }: RenderMusic): Promise<{ path: string; type: string; volume: number }> {
  const path = `render-jobs/${renderId}.music.${MUSIC_EXTENSIONS[music.track.contentType]}`;
  await adminBucket().file(music.track.storagePath).copy(adminBucket().file(path));
  return { path, type: music.track.contentType, volume };
}

/** Image insérée copiée pour un rendu, avec le minutage de sa scène dans la voix (secondes). */
type RenderInsert = { scene: number; path: string; type: string; start: number; end: number };

/**
 * Copie les images des scènes pour ce rendu : elles peuvent être remplacées pendant que le workflow tourne.
 * Le minutage vient de la voix (déjà vérifiée à jour) ; les images posées sur une scène disparue sont ignorées.
 */
async function snapshotInserts(renderId: string, project: Project, voice: Voice): Promise<RenderInsert[]> {
  const sceneCount = Math.min(project.script?.scenes.length ?? 0, voice.scenes.length);
  const entries = Object.entries(project.inserts)
    .map(([key, insert]) => ({ scene: Number(key), insert }))
    .filter(({ scene }) => Number.isInteger(scene) && scene >= 0 && scene < sceneCount)
    .sort((a, b) => a.scene - b.scene);
  return Promise.all(
    entries.map(async ({ scene, insert }) => {
      const path = `render-jobs/${renderId}.insert-${scene}.${INSERT_EXTENSIONS[insert.contentType]}`;
      await adminBucket().file(insert.storagePath).copy(adminBucket().file(path));
      // L'index est borné par sceneCount, donc le minutage existe.
      const { start, end } = voice.scenes[scene]!;
      return { scene, path, type: insert.contentType, start, end };
    }),
  );
}

const resultPath = (renderId: string) => `render-jobs/${renderId}.result.json`;

function githubHeaders(): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${requireEnv("GITHUB_RENDER_TOKEN")}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

/** Lance le workflow ; renvoie l'identifiant de l'exécution si l'API le fournit (réponse 200), sinon null (204). */
async function dispatchWorkflow(renderId: string): Promise<number | null> {
  const response = await fetch(`${GITHUB_API}/repos/${REPOSITORY}/actions/workflows/${WORKFLOW_FILE}/dispatches`, {
    method: "POST",
    headers: { ...githubHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ ref: WORKFLOW_REF, inputs: { render_id: renderId } }),
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 204) return null;
  if (!response.ok) {
    await response.body?.cancel();
    throw new RenderError("provider_error", `github dispatch ${response.status}`);
  }
  const data = (await response.json().catch(() => null)) as { workflow_run_id?: unknown } | null;
  return typeof data?.workflow_run_id === "number" ? data.workflow_run_id : null;
}

/**
 * Lance le rendu d'un format sur GitHub Actions (gratuit pour un dépôt public).
 * Le propriétaire du projet, de la signature, du fond et de la musique doit avoir été vérifié (getProject, getSignature, getBackground, getMusic) ;
 * l'appelant enregistre le résultat avec saveRender. Les réglages de signature du projet (accroche, QR code, logo)
 * sont posés sur la signature choisie ; sans signature choisie, ils sont ignorés.
 */
export async function startRender(
  project: Project,
  format: VideoFormat,
  signature: Signature | null,
  background: Background | null,
  music: RenderMusic | null = null,
): Promise<ProjectRender> {
  if (!project.formats.includes(format)) throw new RenderError("format_invalid", `format ${format} non choisi`);
  const avatar = project.avatars[format];
  const voice = project.voice;
  if (!avatar || avatar.state !== "done" || !avatar.completedAt || !voice) {
    throw new RenderError("avatar_missing", "vidéo de Chris absente");
  }
  if (isVoiceStale(voice, project.script)) throw new RenderError("voice_stale", "voix périmée");
  if (avatar.voiceGeneratedAt !== voice.generatedAt) throw new RenderError("avatar_stale", "vidéo de Chris périmée");
  if (!(voice.durationSeconds > 0 && voice.durationSeconds <= MAX_SECONDS)) throw new RenderError("too_long", "durée hors limite");
  const current = project.renders[format];
  if (current && isRenderPending(current) && !isRenderStalled(current)) {
    throw new RenderError("already_running", "rendu déjà en cours");
  }

  // 128 bits aléatoires en base64url (22 caractères) : imprévisible, et accepté par le motif du workflow.
  const renderId = randomBytes(16).toString("base64url");
  const title = (project.script?.title ?? project.topic).trim().slice(0, TITLE_MAX);
  const customized = signature !== null && !isEmptyOverride(project.signatureOverride);
  const mounted = signature ? applyOverride(signature, project.signatureOverride) : null;
  try {
    const job = {
      version: 1,
      projectId: project.id,
      format,
      title,
      durationSeconds: voice.durationSeconds,
      signature: mounted ? await snapshotSignature(renderId, mounted) : null,
      background: background ? await snapshotBackground(renderId, background) : null,
      music: music ? await snapshotMusic(renderId, music) : null,
      inserts: await snapshotInserts(renderId, project, voice),
    };
    await adminBucket()
      .file(jobPath(renderId))
      .save(JSON.stringify(job), { contentType: "application/json", resumable: false });
  } catch (error) {
    // Erreur Storage : remontée telle quelle (erreur serveur), sans laisser de fichier orphelin.
    await cleanupJob(renderId);
    throw error;
  }

  let runId: number | null;
  try {
    runId = await dispatchWorkflow(renderId);
  } catch (error) {
    await cleanupJob(renderId);
    if (error instanceof RenderError) throw error;
    throw new RenderError("provider_error", "github dispatch réseau");
  }

  console.info("[render] dispatched", { format, renderId, runId });
  return {
    format,
    state: "queued",
    renderId,
    runId,
    avatarCompletedAt: avatar.completedAt,
    submittedAt: new Date().toISOString(),
    completedAt: null,
    storagePath: null,
    sizeBytes: null,
    renderSeconds: null,
    error: null,
    signatureId: signature?.id ?? null,
    signatureName: signature?.name ?? null,
    signatureCustomized: customized,
    backgroundId: background?.id ?? null,
    backgroundName: background?.name ?? null,
    musicId: music?.music.id ?? null,
    musicName: music?.music.name ?? null,
    musicVolume: music?.volume ?? null,
  };
}

const failed = (render: ProjectRender, error: string): ProjectRender => ({
  ...render,
  state: "failed",
  error,
  completedAt: new Date().toISOString(),
});

type RunStatus = { status: string | null; conclusion: string | null };

/** État de l'exécution GitHub ; null si inconnu (pas d'identifiant, erreur passagère). */
async function runStatus(runId: number | null): Promise<RunStatus | null> {
  if (runId === null) return null;
  try {
    const response = await fetch(`${GITHUB_API}/repos/${REPOSITORY}/actions/runs/${runId}`, {
      headers: githubHeaders(),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (!response.ok) {
      await response.body?.cancel();
      console.warn("[render] run status failed", response.status);
      return null;
    }
    const data = (await response.json()) as { status?: unknown; conclusion?: unknown };
    return {
      status: typeof data.status === "string" ? data.status : null,
      conclusion: typeof data.conclusion === "string" ? data.conclusion : null,
    };
  } catch {
    console.warn("[render] run status failed", "réseau");
    return null;
  }
}

/** Marge avant `submittedAt` pour la recherche : l'exécution est créée par GitHub juste après la demande. */
const RUN_LOOKUP_MARGIN_MS = 2 * 60 * 1000;

/**
 * Retrouve l'exécution d'un rendu par son titre (`run-name: Rendu {render_id}` dans render.yml),
 * quand l'API de lancement n'a pas renvoyé son identifiant (réponse 204). Null si pas encore visible.
 * Doc : docs.github.com/en/rest/actions/workflow-runs#list-workflow-runs-for-a-workflow
 */
async function findRunId(render: ProjectRender): Promise<number | null> {
  const since = new Date(Date.parse(render.submittedAt) - RUN_LOOKUP_MARGIN_MS).toISOString();
  const query = new URLSearchParams({ event: "workflow_dispatch", created: `>=${since}`, per_page: "50" });
  try {
    const response = await fetch(
      `${GITHUB_API}/repos/${REPOSITORY}/actions/workflows/${WORKFLOW_FILE}/runs?${query}`,
      { headers: githubHeaders(), signal: AbortSignal.timeout(15_000), cache: "no-store" },
    );
    if (!response.ok) {
      await response.body?.cancel();
      console.warn("[render] run lookup failed", response.status);
      return null;
    }
    const data = (await response.json()) as { workflow_runs?: { id?: unknown; display_title?: unknown }[] };
    const title = `Rendu ${render.renderId}`;
    const run = data.workflow_runs?.find((item) => item.display_title === title);
    return typeof run?.id === "number" ? run.id : null;
  } catch {
    console.warn("[render] run lookup failed", "réseau");
    return null;
  }
}

/** Fichier de résultat écrit par render-job.mjs ; null s'il n'existe pas encore. */
async function readResult(renderId: string): Promise<Record<string, unknown> | null> {
  const file = adminBucket().file(resultPath(renderId));
  const [exists] = await file.exists();
  if (!exists) return null;
  const [content] = await file.download();
  try {
    const data = JSON.parse(content.toString("utf8"));
    return typeof data === "object" && data ? data : {};
  } catch {
    return {};
  }
}

/** Supprime les fichiers de travail d'un rendu terminé ; un échec ici n'empêche rien (nettoyés aussi avec le projet). */
async function cleanupJob(renderId: string) {
  await adminBucket()
    .deleteFiles({ prefix: `render-jobs/${renderId}.` })
    .catch(() => console.warn("[render] cleanup failed"));
}

/**
 * Met à jour un rendu en cours à partir de son fichier de résultat et de l'exécution GitHub (gratuit).
 * Renvoie null si rien n'a changé. Le propriétaire du projet doit avoir été vérifié par getProject.
 */
export async function refreshRender(projectId: string, render: ProjectRender): Promise<ProjectRender | null> {
  if (!isRenderPending(render)) return null;

  // L'exécution d'abord, le résultat ensuite : le script écrit son résultat avant la fin de l'exécution,
  // donc une exécution terminée sans résultat signifie vraiment que le script n'a pas pu l'écrire.
  // Sans identifiant (lancement en 204), on le cherche par le titre de l'exécution, puis on l'enregistre.
  const foundRunId = render.runId === null ? await findRunId(render) : null;
  if (foundRunId !== null) render = { ...render, runId: foundRunId };
  const run = await runStatus(render.runId);
  const result = await readResult(render.renderId);

  if (result?.state === "done") {
    const expected = renderStoragePath(projectId, render.format);
    // Le chemin vient d'un fichier écrit par le workflow : on n'accepte que celui attendu pour ce projet et ce format.
    if (result.outputPath !== expected) return failed(render, "Le rendu a renvoyé un fichier inattendu.");
    await cleanupJob(render.renderId);
    console.info("[render] done", { format: render.format, renderId: render.renderId, seconds: result.renderSeconds });
    return {
      ...render,
      state: "done",
      storagePath: expected,
      sizeBytes: typeof result.sizeBytes === "number" ? result.sizeBytes : null,
      renderSeconds: typeof result.renderSeconds === "number" ? result.renderSeconds : null,
      error: null,
      completedAt: new Date().toISOString(),
    };
  }
  if (result) {
    await cleanupJob(render.renderId);
    const step = typeof result.step === "string" ? result.step.slice(0, 120) : "étape inconnue";
    return failed(render, `Le rendu a échoué (${step}).`);
  }

  if (run?.status === "completed") {
    await cleanupJob(render.renderId);
    return failed(render, `Le workflow s'est terminé sans résultat (${run.conclusion ?? "inconnu"}).`);
  }
  if (isRenderStalled(render)) {
    await cleanupJob(render.renderId);
    return failed(render, "Le rendu n'a pas abouti dans le délai prévu.");
  }
  if (run?.status === "in_progress" && render.state !== "running") return { ...render, state: "running" };
  // Rien d'autre n'a changé, mais l'identifiant retrouvé doit être enregistré pour ne plus le chercher.
  return foundRunId !== null ? render : null;
}

/** Nom du fichier proposé au téléchargement : `voxavatar-9x16.mp4`. */
const downloadName = (format: VideoFormat) => `voxavatar-${format.replace(":", "x")}.mp4`;

/** Liens temporaires de lecture et de téléchargement du MP4 final (URL signées V4, gratuites). */
export async function renderUrls(
  render: ProjectRender,
): Promise<{ url: string; downloadUrl: string; expiresAt: string } | null> {
  if (render.state !== "done" || !render.storagePath) return null;
  const [play, download] = await Promise.all([
    signedReadUrl(render.storagePath, RENDER_URL_TTL_SECONDS, "video/mp4"),
    signedReadUrl(render.storagePath, RENDER_URL_TTL_SECONDS, "video/mp4", `attachment; filename="${downloadName(render.format)}"`),
  ]);
  return { url: play.url, downloadUrl: download.url, expiresAt: play.expiresAt };
}

