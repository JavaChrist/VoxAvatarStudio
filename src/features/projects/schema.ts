// Modèle d'un projet vidéo et validation des saisies. Partagé entre le serveur et le navigateur : aucun secret ici.
import type { ProjectInserts } from "./inserts";
import type { ProjectRenders } from "./render";
import type { Script } from "./script";
import type { SignatureOverride } from "./signature-override";
import type { AvatarVideos } from "./video";
import type { Voice } from "./voice";

export const VIDEO_FORMATS = ["9:16", "4:5", "1:1"] as const;
export type VideoFormat = (typeof VIDEO_FORMATS)[number];

export const TONES = [
  { id: "pedagogique", label: "Pédagogique" },
  { id: "dynamique", label: "Dynamique" },
  { id: "humoristique", label: "Humoristique" },
  { id: "serieux", label: "Sérieux" },
  { id: "inspirant", label: "Inspirant" },
] as const;
export type Tone = (typeof TONES)[number]["id"];

/** Tranches de durée. targetSeconds sert de cible au script ; le texte est ensuite calé à ±10 %. */
export const DURATION_PRESETS = [
  { id: "0-15", label: "0–15 s", minSeconds: 0, maxSeconds: 15, targetSeconds: 12 },
  { id: "15-30", label: "15–30 s", minSeconds: 15, maxSeconds: 30, targetSeconds: 25 },
  { id: "30-60", label: "30–60 s", minSeconds: 30, maxSeconds: 60, targetSeconds: 45 },
  { id: "60-90", label: "Jusqu'à 90 s", minSeconds: 60, maxSeconds: 90, targetSeconds: 75 },
] as const;
export type DurationPreset = (typeof DURATION_PRESETS)[number]["id"];

/** Débit moyen de parole en français, utilisé pour estimer la durée d'un texte. */
export const WORDS_PER_SECOND = 2.5;

export const PROJECT_STATUSES = ["draft", "script_ready", "voice_ready", "video_ready", "rendered"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const STATUS_LABELS: Record<ProjectStatus, string> = {
  draft: "Brouillon",
  script_ready: "Script prêt",
  voice_ready: "Voix prête",
  video_ready: "Vidéo prête",
  rendered: "Rendu terminé",
};

export const toneLabel = (id: Tone) => TONES.find((tone) => tone.id === id)?.label ?? id;
export const durationLabel = (id: DurationPreset) => DURATION_PRESETS.find((preset) => preset.id === id)?.label ?? id;

export const LIMITS = { topicMin: 3, topicMax: 200, notesMax: 4000 } as const;

/** Saisie du formulaire « Nouveau projet ». */
export interface ProjectInput {
  topic: string;
  notes: string;
  tone: Tone;
  formats: VideoFormat[];
  duration: DurationPreset;
}

/** Projet tel que renvoyé par l'API (dates en ISO 8601). */
export interface Project extends ProjectInput {
  id: string;
  status: ProjectStatus;
  /** Absent tant que Claude n'a pas écrit le script. */
  script: Script | null;
  /** Absente tant que la voix n'a pas été générée ; peut être périmée si le script a changé depuis. */
  voice: Voice | null;
  /** Vidéos de Chris sur fond vert, une par format lancé ; vide au départ. */
  avatars: AvatarVideos;
  /** Vidéos finales montées, une par format lancé ; vide au départ. */
  renders: ProjectRenders;
  /** Accroche, QR code et logo propres à cette vidéo, posés sur la signature choisie ; null : aucun réglage. */
  signatureOverride: SignatureOverride | null;
  /** Images insérées, une au plus par scène du script ; vide au départ. */
  inserts: ProjectInserts;
  createdAt: string;
  updatedAt: string;
}

export type ValidationResult = { ok: true; value: ProjectInput } | { ok: false; errors: Record<string, string> };

const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === "string" && (list as readonly string[]).includes(value);

/** Valide et nettoie une saisie inconnue (corps JSON d'une requête). */
export function validateProjectInput(raw: unknown): ValidationResult {
  const data = (typeof raw === "object" && raw ? raw : {}) as Record<string, unknown>;
  const errors: Record<string, string> = {};

  const topic = typeof data.topic === "string" ? data.topic.trim().replace(/\s+/g, " ") : "";
  if (topic.length < LIMITS.topicMin) errors.topic = `Le sujet doit faire au moins ${LIMITS.topicMin} caractères.`;
  else if (topic.length > LIMITS.topicMax) errors.topic = `Le sujet ne doit pas dépasser ${LIMITS.topicMax} caractères.`;

  const notes = typeof data.notes === "string" ? data.notes.trim() : "";
  if (notes.length > LIMITS.notesMax) errors.notes = `Les notes ne doivent pas dépasser ${LIMITS.notesMax} caractères.`;

  const toneIds = TONES.map((tone) => tone.id);
  if (!isOneOf(toneIds, data.tone)) errors.tone = "Choisis un ton.";

  const formats = Array.isArray(data.formats) ? [...new Set(data.formats)] : [];
  if (formats.length === 0 || !formats.every((format) => isOneOf(VIDEO_FORMATS, format))) {
    errors.formats = "Choisis au moins un format valide.";
  }

  const durationIds = DURATION_PRESETS.map((preset) => preset.id);
  if (!isOneOf(durationIds, data.duration)) errors.duration = "Choisis une durée.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      topic,
      notes,
      tone: data.tone as Tone,
      // Ordre fixe, quel que soit l'ordre des cases cochées.
      formats: VIDEO_FORMATS.filter((format) => formats.includes(format)),
      duration: data.duration as DurationPreset,
    },
  };
}
