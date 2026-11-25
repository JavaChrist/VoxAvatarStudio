// Script d'une vidéo : scènes parlées par Chris. Partagé entre le serveur et le navigateur : aucun secret ici.
import { WORDS_PER_SECOND } from "./schema";

/** Plans possibles d'une scène au montage. */
export const SHOTS = ["chris", "chris_close", "chris_image", "image_close"] as const;
export type Shot = (typeof SHOTS)[number];

export const SHOT_LABELS: Record<Shot, string> = {
  chris: "Chris",
  chris_close: "Gros plan sur Chris",
  chris_image: "Chris + image",
  image_close: "Gros plan sur l'image",
};

export const isShot = (value: unknown): value is Shot => (SHOTS as readonly unknown[]).includes(value);

/** Plans qui ne peuvent pas être montés sans image : sans elle, Chris reste en cadrage normal. */
export const shotNeedsImage = (shot: Shot | undefined) => shot === "chris_image" || shot === "image_close";

export interface Scene {
  /** Texte prononcé par Chris, tel quel (sans indication de mise en scène). */
  spokenText: string;
  /** Description de l'illustration de la scène (sert à générer l'image). */
  visualIntent: string;
  /** Plan choisi ; absent = automatique (image en carte au-dessus de Chris si la scène en a une). */
  shot?: Shot;
  words: number;
  /** Durée estimée à partir du nombre de mots (WORDS_PER_SECOND). */
  estimatedSeconds: number;
}

export interface Script {
  title: string;
  scenes: Scene[];
  totalWords: number;
  estimatedSeconds: number;
  targetSeconds: number;
  model: string;
  generatedAt: string;
  /** Date de la dernière modification manuelle, absente si le texte est celui de Claude. */
  editedAt?: string;
  /** Date du dernier ajustement automatique de la durée par Claude. */
  adjustedAt?: string;
}

/** Mots prononcés : on ignore la ponctuation isolée (« : », « — », « ! »). */
export function countWords(text: string): number {
  return text.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

export const estimateSeconds = (words: number) => Math.round((words / WORDS_PER_SECOND) * 10) / 10;

/** Construit une scène à partir du texte, en calculant mots et durée. */
export function toScene(spokenText: string, visualIntent: string, shot?: Shot): Scene {
  const words = countWords(spokenText);
  // Champ absent plutôt qu'undefined : Firestore refuse undefined.
  return { spokenText, visualIntent, ...(shot ? { shot } : {}), words, estimatedSeconds: estimateSeconds(words) };
}

export function totals(scenes: Scene[]) {
  const totalWords = scenes.reduce((sum, scene) => sum + scene.words, 0);
  return { totalWords, estimatedSeconds: estimateSeconds(totalWords) };
}

/** Écart toléré entre la durée estimée et la cible (±10 %). */
export const DURATION_TOLERANCE = 0.1;

export type DurationFit = "ok" | "short" | "long";

export function durationFit(estimatedSeconds: number, targetSeconds: number): DurationFit {
  if (estimatedSeconds < targetSeconds * (1 - DURATION_TOLERANCE)) return "short";
  if (estimatedSeconds > targetSeconds * (1 + DURATION_TOLERANCE)) return "long";
  return "ok";
}

export const SCRIPT_LIMITS = { titleMax: 120, scenesMax: 12, spokenMax: 1200, visualMax: 500 } as const;

/** Modification manuelle envoyée par l'éditeur : mots et durées sont recalculés par le serveur. */
export interface ScriptEdit {
  title: string;
  scenes: { spokenText: string; visualIntent: string; shot?: Shot }[];
}

export type ScriptEditResult = { ok: true; value: ScriptEdit } | { ok: false; errors: Record<string, string> };

/** Valide une modification. Clés d'erreur : title, scenes, scene-<index>. */
export function validateScriptEdit(raw: unknown): ScriptEditResult {
  const data = (typeof raw === "object" && raw ? raw : {}) as Record<string, unknown>;
  const errors: Record<string, string> = {};

  const title = typeof data.title === "string" ? data.title.trim().replace(/\s+/g, " ") : "";
  if (!title) errors.title = "Donne un titre à la vidéo.";
  else if (title.length > SCRIPT_LIMITS.titleMax) errors.title = `Le titre ne doit pas dépasser ${SCRIPT_LIMITS.titleMax} caractères.`;

  const rawScenes = Array.isArray(data.scenes) ? data.scenes : [];
  if (rawScenes.length === 0) errors.scenes = "Le script doit contenir au moins une scène.";
  else if (rawScenes.length > SCRIPT_LIMITS.scenesMax) errors.scenes = `${SCRIPT_LIMITS.scenesMax} scènes au maximum.`;

  const scenes = rawScenes.slice(0, SCRIPT_LIMITS.scenesMax).map((scene: unknown, index) => {
    const item = (typeof scene === "object" && scene ? scene : {}) as Record<string, unknown>;
    const spokenText = typeof item.spokenText === "string" ? item.spokenText.trim().replace(/\s+/g, " ") : "";
    const visualIntent = typeof item.visualIntent === "string" ? item.visualIntent.trim() : "";
    // Plan absent ou vide = automatique.
    const shot = isShot(item.shot) ? item.shot : undefined;
    const unknownShot = !shot && item.shot != null && item.shot !== "";
    if (!spokenText) errors[`scene-${index}`] = "Le texte parlé est vide.";
    else if (spokenText.length > SCRIPT_LIMITS.spokenMax) errors[`scene-${index}`] = `Texte trop long (${SCRIPT_LIMITS.spokenMax} caractères au maximum).`;
    else if (visualIntent.length > SCRIPT_LIMITS.visualMax) errors[`scene-${index}`] = `Idée visuelle trop longue (${SCRIPT_LIMITS.visualMax} caractères au maximum).`;
    else if (unknownShot) errors[`scene-${index}`] = "Plan inconnu : choisis-en un dans la liste.";
    return { spokenText, visualIntent, ...(shot ? { shot } : {}) };
  });

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { title, scenes } };
}
