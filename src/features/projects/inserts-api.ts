// Appels du navigateur vers l'API des images insérées. Aucun secret : la session passe par le cookie httpOnly,
// et l'envoi du fichier utilise une URL signée temporaire fournie par le serveur.
import { detectInsertType, INSERT_MAX_BYTES, INSERT_SNIFF_BYTES, type InsertType, type InsertView } from "./inserts";

export type InsertsResult = { ok: true; inserts: InsertView[] } | { ok: false; error: string };

/** Messages affichés pour chaque code d'erreur. */
const INSERT_ERRORS: Record<string, string> = {
  not_found: "Cette image ou ce projet n'existe plus. Recharge la page.",
  image_too_large: "L'image dépasse 10 Mo. Choisis une image plus légère (un JPEG ou un WebP, par exemple).",
  image_invalid: "L'image doit être un fichier PNG, JPEG ou WebP.",
  scene_not_found: "Cette scène n'existe plus dans le script. Recharge la page.",
  scene_invalid: "Cette scène n'existe pas. Recharge la page.",
  upload_missing: "Le fichier n'est pas arrivé dans le stockage. Réessaie l'envoi.",
  upload_failed:
    "L'envoi du fichier vers le stockage a échoué. Vérifie ta connexion ; si le problème continue, la configuration CORS du bucket est peut-être manquante.",
  render_starting: "Un rendu est en train de démarrer ou d'être suivi pour ce projet. Réessaie dans quelques secondes.",
  image_busy: "Une autre action est en cours sur les images ou le montage de ce projet. Réessaie dans quelques instants.",
  description_invalid: "La description de l'image est trop courte ou trop longue.",
  image_refused: "Le modèle n'a pas produit d'image pour cette description. Reformule-la, puis réessaie.",
  provider_busy: "Le service de génération d'images est saturé. Réessaie dans quelques minutes.",
  provider_error: "La génération de l'image a échoué chez fal. Réessaie ; si le problème continue, vérifie ton crédit fal.",
  network: "La connexion au serveur a échoué. Vérifie ta connexion et réessaie.",
};

const FALLBACK_ERROR = "Le serveur n'a pas pu enregistrer l'image. Réessaie dans un instant.";

export const insertErrorMessage = (code: string) => INSERT_ERRORS[code] ?? FALLBACK_ERROR;

async function readJson(url: string, init?: RequestInit): Promise<{ status: number; data: Record<string, unknown> | null } | null> {
  try {
    const response = await fetch(url, { cache: "no-store", ...init });
    return { status: response.status, data: await response.json().catch(() => null) };
  } catch {
    return null;
  }
}

function toResult(reply: Awaited<ReturnType<typeof readJson>>): InsertsResult {
  if (!reply) return { ok: false, error: "network" };
  // Session expirée : l'appelant renvoie vers la connexion.
  if (reply.status === 401) return { ok: false, error: "unauthorized" };
  const data = reply.data;
  if (reply.status === 200 && Array.isArray(data?.inserts)) return { ok: true, inserts: data.inserts as InsertView[] };
  return { ok: false, error: typeof data?.error === "string" ? data.error : "server_error" };
}

/** Premier tri avant envoi, pour un message immédiat. Renvoie le type reconnu ou un code d'erreur. */
export async function checkInsertFile(file: File): Promise<{ ok: true; type: InsertType } | { ok: false; error: string }> {
  if (file.size > INSERT_MAX_BYTES) return { ok: false, error: "image_too_large" };
  const head = await file
    .slice(0, INSERT_SNIFF_BYTES)
    .arrayBuffer()
    .then((buffer) => new Uint8Array(buffer))
    .catch(() => null);
  const type = head ? detectInsertType(head) : null;
  return type ? { ok: true, type } : { ok: false, error: "image_invalid" };
}

/**
 * Envoi en trois temps : URL signée demandée au serveur, envoi direct du fichier vers Storage,
 * puis pose sur la scène (le serveur revérifie la taille et le format réels).
 */
export async function uploadInsert(projectId: string, scene: number, file: File, type: InsertType): Promise<InsertsResult> {
  const prepared = await readJson(`/api/projects/${projectId}/inserts/uploads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contentType: type, size: file.size }),
  });
  if (!prepared) return { ok: false, error: "network" };
  if (prepared.status === 401) return { ok: false, error: "unauthorized" };
  const uploadId = prepared.data?.uploadId;
  const url = prepared.data?.url;
  if (prepared.status !== 200 || typeof uploadId !== "string" || typeof url !== "string") {
    return { ok: false, error: typeof prepared.data?.error === "string" ? prepared.data.error : "server_error" };
  }

  // Le Content-Type doit être exactement celui signé, sinon Storage refuse l'envoi.
  try {
    const put = await fetch(url, { method: "PUT", headers: { "Content-Type": type }, body: file });
    if (!put.ok) return { ok: false, error: "upload_failed" };
  } catch {
    return { ok: false, error: "upload_failed" };
  }

  return toResult(
    await readJson(`/api/projects/${projectId}/inserts/${scene}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uploadId }),
    }),
  );
}

/** Fait générer l'image de la scène par le serveur (appel facturé), qui la pose à la place de l'éventuelle précédente. */
export const generateInsert = async (projectId: string, scene: number, description: string) =>
  toResult(
    await readJson(`/api/projects/${projectId}/inserts/${scene}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description }),
    }),
  );

export const removeInsert =async (projectId: string, scene: number) =>
  toResult(await readJson(`/api/projects/${projectId}/inserts/${scene}`, { method: "DELETE" }));

/** Liste à jour, avec de nouveaux liens d'aperçu (valables 15 min). */
export const fetchInserts = async (projectId: string) => toResult(await readJson(`/api/projects/${projectId}/inserts`));
