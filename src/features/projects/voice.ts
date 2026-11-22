// Voix off d'un projet. Partagé entre le serveur et le navigateur : aucun secret ici.
import type { Script } from "./script";

/** Début et fin d'une scène dans l'audio, en secondes. */
export interface SceneTiming {
  start: number;
  end: number;
}

/** Métadonnées de la voix enregistrées sur le projet. Le MP3 et l'alignement restent privés dans Storage. */
export interface Voice {
  /** Chemin du MP3 dans le bucket ; servi au navigateur uniquement par URL signée temporaire. */
  storagePath: string;
  /** Alignement caractère par caractère (JSON), utile plus tard pour les sous-titres. */
  alignmentPath: string;
  durationSeconds: number;
  /** Caractères envoyés à ElevenLabs : c'est l'unité facturée. */
  characters: number;
  model: string;
  scenes: SceneTiming[];
  /** Empreinte du texte parlé au moment de la génération : si le script change, la voix est périmée. */
  scriptHash: string;
  generatedAt: string;
}

/** Tarif API ElevenLabs d'eleven_v4 (USD pour 1 000 caractères), relevé sur elevenlabs.io/pricing/api. Sert d'estimation affichée. */
export const VOICE_PRICE_PER_1K_USD = 0.08;

export const estimateVoiceCostUsd = (characters: number) => (characters / 1000) * VOICE_PRICE_PER_1K_USD;

/** Séparateur entre deux scènes dans le texte envoyé à la synthèse vocale. */
export const SCENE_SEPARATOR = "\n\n";

/** Texte lu par la voix : le texte parlé des scènes, dans l'ordre. */
export const voiceText = (script: Script) => script.scenes.map((scene) => scene.spokenText).join(SCENE_SEPARATOR);

/** Empreinte FNV-1a 32 bits (pas cryptographique) : suffit pour détecter une modification du texte. */
export function textHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Vrai si la voix ne correspond plus au texte parlé actuel du script. */
export const isVoiceStale = (voice: Voice, script: Script | null) => !script || voice.scriptHash !== textHash(voiceText(script));
