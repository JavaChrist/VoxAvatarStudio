// Appels du navigateur vers l'API des signatures. Aucun secret : la session passe par le cookie httpOnly.
import { LOGO_MAX_BYTES, LOGO_TYPES, type SignatureInput, type SignatureView } from "./schema";

export type ApiResult =
  | { ok: true; signature: SignatureView }
  | { ok: false; error: string; fields?: Partial<Record<keyof SignatureInput, string>> };

/** Messages affichés pour chaque code d'erreur renvoyé par l'API. */
export const SIGNATURE_ERRORS: Record<string, string> = {
  not_found: "Cette signature n'existe plus. Recharge la page.",
  logo_too_large: "Le logo dépasse 2 Mo. Choisis une image plus légère.",
  logo_invalid: "Le logo doit être une image PNG, JPEG ou WebP.",
  network: "La connexion au serveur a échoué. Vérifie ta connexion et réessaie.",
};

const FALLBACK_ERROR = "Le serveur n'a pas pu enregistrer la signature. Réessaie dans un instant.";

export const signatureErrorMessage = (code: string) => SIGNATURE_ERRORS[code] ?? FALLBACK_ERROR;

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
  if (response.ok && data?.signature) return { ok: true, signature: data.signature };
  return { ok: false, error: typeof data?.error === "string" ? data.error : "server_error", fields: data?.fields };
}

const json = (method: string, body: SignatureInput): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const createSignature = (input: SignatureInput) => call("/api/signatures", json("POST", input));

export const updateSignature = (id: string, input: SignatureInput) => call(`/api/signatures/${id}`, json("PUT", input));

export const uploadLogo = (id: string, file: File) => call(`/api/signatures/${id}/logo`, { method: "PUT", body: file });

export const removeLogo = (id: string) => call(`/api/signatures/${id}/logo`, { method: "DELETE" });

/** Renvoie "ok", "not_found", "unauthorized" ou un code d'erreur. */
export async function deleteSignature(id: string): Promise<string> {
  try {
    const response = await fetch(`/api/signatures/${id}`, { method: "DELETE" });
    if (response.status === 401) return "unauthorized";
    if (response.ok) return "ok";
    if (response.status === 404) return "not_found";
    return "server_error";
  } catch {
    return "network";
  }
}

/** Premier tri avant envoi, pour un message immédiat ; le serveur revérifie le contenu réel du fichier. */
export function checkLogoFile(file: File): string | null {
  if (!(LOGO_TYPES as readonly string[]).includes(file.type)) return "logo_invalid";
  if (file.size > LOGO_MAX_BYTES) return "logo_too_large";
  return null;
}
