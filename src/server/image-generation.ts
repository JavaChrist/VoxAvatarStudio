import "server-only";
import { ApiError } from "@fal-ai/client";
import { detectInsertType, INSERT_MAX_BYTES, type InsertType } from "@/features/projects/inserts";
import { falClient, IMAGE_ENDPOINT } from "./providers/fal";

// Image d'une scène générée par Nano Banana chez fal (un appel facturé par image).
// Doc vérifiée le 2026-11-25 : fal.ai/models/fal-ai/nano-banana/llms.txt

/** Attente maximale de l'image, puis de son téléchargement : l'ensemble tient dans le maxDuration de la route (120 s). */
const GENERATION_TIMEOUT_MS = 80_000;
const DOWNLOAD_TIMEOUT_MS = 20_000;
/** Si le travail n'a pas démarré avant ce délai, fal l'abandonne. */
const START_TIMEOUT_SECONDS = 60;
/** L'image est copiée aussitôt dans Storage : inutile que fal la garde plus d'une heure. */
const OUTPUT_LIFECYCLE = JSON.stringify({ expiration_duration_seconds: 60 * 60 });

/** Erreur métier : `code` est renvoyé au navigateur, jamais le détail du fournisseur. */
export class ImageGenerationError extends Error {
  constructor(
    readonly code: "image_refused" | "provider_busy" | "provider_error",
    detail: string,
  ) {
    super(detail);
  }
}

export const IMAGE_GENERATION_ERROR_STATUS: Record<ImageGenerationError["code"], number> = {
  image_refused: 422,
  provider_busy: 503,
  provider_error: 502,
};

/** Style commun à toutes les images, assorti à Chris. La description, en français, vient de l'utilisateur. */
const imagePrompt = (description: string) =>
  [
    "Stylized 3D cartoon illustration in the look of an animated film: soft lighting, rounded shapes, vivid colors.",
    "One clear subject, readable at small size, filling a landscape frame.",
    "No text, no letters, no numbers, no logo, no watermark. No presenter and nobody talking to the camera.",
    `Illustrate this description, written in French: ${description}`,
  ].join("\n");

/** Génère une image 4:3 et la rapporte. Son format est reconnu à ses premiers octets, pas à ce que fal annonce. */
export async function generateImage(description: string): Promise<{ bytes: Buffer; contentType: InsertType }> {
  let url: string | undefined;
  try {
    const result = await falClient().subscribe(IMAGE_ENDPOINT, {
      input: { prompt: imagePrompt(description), num_images: 1, aspect_ratio: "4:3", output_format: "png" },
      timeout: GENERATION_TIMEOUT_MS,
      startTimeout: START_TIMEOUT_SECONDS,
      headers: { "X-Fal-Object-Lifecycle-Preference": OUTPUT_LIFECYCLE },
    });
    url = result.data.images?.[0]?.url;
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 0;
    if (status === 422) throw new ImageGenerationError("image_refused", "fal 422");
    if (status === 429) throw new ImageGenerationError("provider_busy", "fal 429");
    throw new ImageGenerationError("provider_error", `fal image ${status || "réseau ou délai"}`);
  }
  // Le modèle peut répondre par du texte, sans image.
  if (!url) throw new ImageGenerationError("image_refused", "aucune image renvoyée");

  const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) }).catch(() => null);
  if (!response?.ok) throw new ImageGenerationError("provider_error", `téléchargement ${response?.status ?? "réseau"}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const contentType = detectInsertType(bytes);
  if (!contentType || bytes.length > INSERT_MAX_BYTES) {
    throw new ImageGenerationError("provider_error", `image inutilisable (${bytes.length} octets)`);
  }
  return { bytes, contentType };
}
