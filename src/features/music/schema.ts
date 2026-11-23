// Musique de fond : piste importée, jouée en boucle sous la voix de Chris. Bibliothèque réutilisable d'un projet à l'autre.
// Partagé entre le serveur et le navigateur : aucun secret ici.
import { line } from "@/features/signatures/schema";

export const MUSIC_TYPES = ["audio/mpeg", "audio/mp4", "audio/wav"] as const;
export type MusicType = (typeof MUSIC_TYPES)[number];

export const MUSIC_EXTENSIONS: Record<MusicType, string> = { "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/wav": "wav" };

/** Le fichier part directement du navigateur vers Storage (URL signée) : pas de limite Vercel, mais on garde un plafond raisonnable. */
export const MUSIC_MAX_BYTES = 20 * 1024 * 1024;
export const MUSIC_NAME_MAX = 60;

/** Volume de la musique sous la voix, en pourcentage. */
export const MUSIC_VOLUME_MIN = 5;
export const MUSIC_VOLUME_MAX = 100;
export const MUSIC_VOLUME_DEFAULT = 15;

/** Octets lus au début du fichier pour reconnaître son format. */
export const MUSIC_SNIFF_BYTES = 16;

/**
 * Format réel d'après les premiers octets (le type annoncé par le navigateur n'est pas fiable) :
 * MP3 (balise ID3 ou trame MPEG audio), M4A (boîte « ftyp » d'un conteneur MP4), WAV (RIFF … WAVE).
 */
export function detectMusicType(bytes: Uint8Array): MusicType | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length >= 3 && ascii(0, 3) === "ID3") return "audio/mpeg";
  // Synchro de trame MPEG (11 bits à 1) et couche non nulle : exclut l'AAC brut (ADTS), dont la couche vaut 0.
  const [b0 = 0, b1 = 0] = bytes;
  if (b0 === 0xff && (b1 & 0xe0) === 0xe0 && (b1 & 0x06) !== 0) return "audio/mpeg";
  if (bytes.length >= 8 && ascii(4, 8) === "ftyp") return "audio/mp4";
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return "audio/wav";
  return null;
}

export const isMusicType = (value: unknown): value is MusicType =>
  typeof value === "string" && (MUSIC_TYPES as readonly string[]).includes(value);

/** Volume valide : entier entre le minimum et le maximum, sinon null. */
export const parseMusicVolume = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= MUSIC_VOLUME_MIN && value <= MUSIC_VOLUME_MAX ? value : null;

export interface MusicTrack {
  storagePath: string;
  contentType: MusicType;
  sizeBytes: number;
  uploadedAt: string;
}

export interface Music {
  id: string;
  name: string;
  track: MusicTrack;
  createdAt: string;
  updatedAt: string;
}

/** Musique renvoyée au navigateur, avec un lien temporaire d'écoute. */
export interface MusicView extends Music {
  trackUrl: string | null;
}

/** Nom dans la bibliothèque : une ligne, obligatoire. Renvoie le nom nettoyé ou un message d'erreur. */
export function validateMusicName(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const value = line(raw);
  if (!value) return { ok: false, error: "Donne un nom à cette musique." };
  if (value.length > MUSIC_NAME_MAX) return { ok: false, error: `${MUSIC_NAME_MAX} caractères au maximum.` };
  return { ok: true, value };
}

/** Nom proposé à partir du nom de fichier : sans extension, tirets et soulignés remplacés par des espaces. */
export const musicNameFromFile = (fileName: string) =>
  line(fileName.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ")).slice(0, MUSIC_NAME_MAX) || "Musique";
