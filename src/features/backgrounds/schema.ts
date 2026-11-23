// Fond de vidéo : image importée, posée derrière Chris détouré. Bibliothèque réutilisable d'un projet à l'autre.
// Partagé entre le serveur et le navigateur : aucun secret ici.
import { detectLogoType, line, LOGO_EXTENSIONS, LOGO_TYPES, type LogoType } from "@/features/signatures/schema";

/** Mêmes types que le logo des signatures (PNG, JPEG, WebP), reconnus à leurs premiers octets. */
export const BACKGROUND_TYPES = LOGO_TYPES;
export type BackgroundType = LogoType;
export const BACKGROUND_EXTENSIONS = LOGO_EXTENSIONS;
export const detectBackgroundType = detectLogoType;

/** L'image passe par une fonction Vercel, dont le corps de requête est limité à 4,5 Mo. */
export const BACKGROUND_MAX_BYTES = 4 * 1024 * 1024;
export const BACKGROUND_NAME_MAX = 60;

export interface BackgroundImage {
  storagePath: string;
  contentType: BackgroundType;
  sizeBytes: number;
  uploadedAt: string;
}

export interface Background {
  id: string;
  name: string;
  image: BackgroundImage;
  createdAt: string;
  updatedAt: string;
}

/** Fond renvoyé au navigateur, avec un lien temporaire vers l'image. */
export interface BackgroundView extends Background {
  imageUrl: string | null;
}

/** Nom dans la bibliothèque : une ligne, obligatoire. Renvoie le nom nettoyé ou un message d'erreur. */
export function validateBackgroundName(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const value = line(raw);
  if (!value) return { ok: false, error: "Donne un nom à ce fond." };
  if (value.length > BACKGROUND_NAME_MAX) return { ok: false, error: `${BACKGROUND_NAME_MAX} caractères au maximum.` };
  return { ok: true, value };
}

/** Nom proposé à partir du nom de fichier : sans extension, tirets et soulignés remplacés par des espaces. */
export const nameFromFile = (fileName: string) =>
  line(fileName.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ")).slice(0, BACKGROUND_NAME_MAX) || "Fond";
