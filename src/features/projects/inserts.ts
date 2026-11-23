// Images insérées : une image par scène du script, affichée en carte flottante animée pendant la scène.
// Partagé entre le serveur et le navigateur : aucun secret ici.
import { detectLogoType, LOGO_EXTENSIONS, LOGO_TYPES, type LogoType } from "@/features/signatures/schema";
import { SCRIPT_LIMITS } from "./script";

/** Mêmes types que les logos et les fonds (PNG, JPEG, WebP), reconnus à leurs premiers octets. */
export const INSERT_TYPES = LOGO_TYPES;
export type InsertType = LogoType;
export const INSERT_EXTENSIONS = LOGO_EXTENSIONS;
export const detectInsertType = detectLogoType;

/** Envoi direct du navigateur vers Storage (URL signée) : pas de limite Vercel, mais un plafond raisonnable. */
export const INSERT_MAX_BYTES = 10 * 1024 * 1024;

/** Octets lus au début du fichier pour reconnaître son format (WebP : 12). */
export const INSERT_SNIFF_BYTES = 16;

export const isInsertType = (value: unknown): value is InsertType =>
  typeof value === "string" && (INSERT_TYPES as readonly string[]).includes(value);

/** Image enregistrée sur le projet. Le fichier reste privé dans Storage, sous projects/{id}/inserts/. */
export interface ProjectInsert {
  storagePath: string;
  contentType: InsertType;
  sizeBytes: number;
  uploadedAt: string;
}

/** Images du projet, par numéro de scène (« 0 », « 1 »… : clés de map Firestore). */
export type ProjectInserts = Record<string, ProjectInsert>;

/** Image renvoyée au navigateur, avec son numéro de scène et un lien temporaire d'aperçu. */
export interface InsertView extends ProjectInsert {
  scene: number;
  imageUrl: string | null;
}

/** Numéro de scène reçu dans l'URL : entier de 0 à scenesMax - 1, sans zéro inutile. Null sinon. */
export function parseSceneIndex(raw: unknown): number | null {
  if (typeof raw !== "string" || !/^(0|[1-9]\d?)$/.test(raw)) return null;
  const scene = Number(raw);
  return scene < SCRIPT_LIMITS.scenesMax ? scene : null;
}
