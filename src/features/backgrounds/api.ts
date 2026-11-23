// Appels du navigateur vers l'API des fonds. Aucun secret : la session passe par le cookie httpOnly.
import { BACKGROUND_MAX_BYTES, BACKGROUND_TYPES, type BackgroundView } from "./schema";

export type ApiResult = { ok: true; background: BackgroundView } | { ok: false; error: string; field?: string };

/** Messages affichés pour chaque code d'erreur renvoyé par l'API. */
const BACKGROUND_ERRORS: Record<string, string> = {
  not_found: "Ce fond n'existe plus. Recharge la page.",
  image_too_large: "L'image dépasse 4 Mo. Choisis une image plus légère (un JPEG ou un WebP, par exemple).",
  image_invalid: "Le fond doit être une image PNG, JPEG ou WebP.",
  network: "La connexion au serveur a échoué. Vérifie ta connexion et réessaie.",
};

const FALLBACK_ERROR = "Le serveur n'a pas pu enregistrer le fond. Réessaie dans un instant.";

export const backgroundErrorMessage = (code: string) => BACKGROUND_ERRORS[code] ?? FALLBACK_ERROR;

async function call(url: string, init: RequestInit): Promise<ApiResult> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    return { ok: false, error: "network" };
  }
  // Session expirée : l'appelant renvoie vers la connexion.
  if (response.status === 401) return { ok: false, error: "unauthorized" };
  const data = await response.json().catch(() => null);
  if (response.ok && data?.background) return { ok: true, background: data.background };
  return { ok: false, error: typeof data?.error === "string" ? data.error : "server_error", field: data?.fields?.name };
}

export const importBackground = (name: string, file: File) =>
  call("/api/backgrounds", { method: "POST", headers: { "x-background-name": encodeURIComponent(name) }, body: file });

export const renameBackground = (id: string, name: string) =>
  call(`/api/backgrounds/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });

/** Renvoie "ok", "not_found", "unauthorized" ou un code d'erreur. */
export async function deleteBackground(id: string): Promise<string> {
  try {
    const response = await fetch(`/api/backgrounds/${id}`, { method: "DELETE" });
    if (response.status === 401) return "unauthorized";
    if (response.ok) return "ok";
    if (response.status === 404) return "not_found";
    return "server_error";
  } catch {
    return "network";
  }
}

/** Premier tri avant envoi, pour un message immédiat ; le serveur revérifie le contenu réel du fichier. */
export function checkBackgroundFile(file: File): string | null {
  if (!(BACKGROUND_TYPES as readonly string[]).includes(file.type)) return "image_invalid";
  if (file.size > BACKGROUND_MAX_BYTES) return "image_too_large";
  return null;
}
