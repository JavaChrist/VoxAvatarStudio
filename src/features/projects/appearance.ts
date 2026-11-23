// Apparence de Chris dans un projet : tenue et pose (debout ou assis derrière un bureau).
// Le catalogue est produit par scripts/prepare_outfits.py. Partagé entre le serveur et le navigateur : aucun secret ici.
import catalog from "../../../characters/chris/tenues.json";
import type { VideoFormat } from "./schema";

export const POSES = ["standing", "seated"] as const;
export type Pose = (typeof POSES)[number];

export const POSE_LABELS: Record<Pose, string> = { standing: "Debout", seated: "Assis" };

export interface Appearance {
  /** Identifiant de la tenue dans characters/chris/tenues.json. */
  outfit: string;
  pose: Pose;
}

export interface OutfitPose {
  /** Miniature publique (dossier public/), pour le choix de la tenue dans l'app. */
  thumbnail: string;
  /** Image de référence par format : même chemin dans le dépôt et dans le bucket (npm run upload:character). */
  referenceImages: Record<VideoFormat, string>;
}

export interface Outfit {
  id: string;
  name: string;
  poses: Partial<Record<Pose, OutfitPose>>;
}

type CatalogPose = { thumbnail: string; reference_images: Record<VideoFormat, string> };

export const OUTFITS: Outfit[] = catalog.outfits.map((outfit) => ({
  id: outfit.id,
  name: outfit.name,
  poses: Object.fromEntries(
    Object.entries(outfit.poses as Partial<Record<Pose, CatalogPose>>).map(([pose, spec]) => [
      pose,
      { thumbnail: spec!.thumbnail, referenceImages: spec!.reference_images },
    ]),
  ),
}));

/** Apparence des projets sans réglage, et des vidéos de Chris générées avant l'arrivée des tenues. */
export const DEFAULT_APPEARANCE: Appearance = { outfit: catalog.default_outfit, pose: catalog.default_pose as Pose };

export const outfitById = (id: string) => OUTFITS.find((outfit) => outfit.id === id);

/** Images de la tenue dans cette pose, ou undefined si la tenue n'existe pas dans cette pose. */
export const outfitPose = ({ outfit, pose }: Appearance) => outfitById(outfit)?.poses[pose];

export const sameAppearance = (a: Appearance, b: Appearance) => a.outfit === b.outfit && a.pose === b.pose;

const isPose = (value: unknown): value is Pose => typeof value === "string" && (POSES as readonly string[]).includes(value);

/** Lit une apparence enregistrée (Firestore) ; tout ce qui n'est pas valide revient à l'apparence par défaut. */
export function readAppearance(raw: unknown): Appearance {
  const data = (typeof raw === "object" && raw ? raw : {}) as Record<string, unknown>;
  const appearance = { outfit: data.outfit, pose: data.pose };
  if (typeof appearance.outfit !== "string" || !isPose(appearance.pose)) return DEFAULT_APPEARANCE;
  return outfitPose(appearance as Appearance) ? (appearance as Appearance) : DEFAULT_APPEARANCE;
}

/** Valide une saisie inconnue (corps JSON) : la tenue doit exister dans la pose demandée. */
export function validateAppearanceInput(raw: unknown): { ok: true; value: Appearance } | { ok: false; error: string } {
  const data = (typeof raw === "object" && raw ? raw : {}) as Record<string, unknown>;
  if (!isPose(data.pose)) return { ok: false, error: "pose_invalid" };
  if (typeof data.outfit !== "string" || !outfitById(data.outfit)) return { ok: false, error: "outfit_invalid" };
  const value: Appearance = { outfit: data.outfit, pose: data.pose };
  if (!outfitPose(value)) return { ok: false, error: "pose_unavailable" };
  return { ok: true, value };
}
