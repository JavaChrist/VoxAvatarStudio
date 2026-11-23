// Réglages de la signature de fin propres à une vidéo : accroche, lien du QR code et logo.
// Posés par-dessus la signature choisie au montage, sans jamais la modifier. Partagé navigateur/serveur : aucun secret ici.
import {
  SIGNATURE_LIMITS,
  isHttpsUrl,
  line,
  type Signature,
  type SignatureLogo,
} from "@/features/signatures/schema";

export interface SignatureOverride {
  /** null : l'accroche de la signature ; "" : pas d'accroche dans cette vidéo. */
  tagline: string | null;
  /** null : le lien de la signature ; "" : pas de QR code dans cette vidéo. */
  qrUrl: string | null;
  /** Logo propre à cette vidéo, gardé privé sous projects/{id}/ ; null : celui de la signature. */
  logo: SignatureLogo | null;
  /** true : pas de logo dans cette vidéo (prime sur `logo`). */
  hideLogo: boolean;
}

/** Réglages renvoyés au navigateur, avec un lien temporaire vers le logo de la vidéo. */
export interface SignatureOverrideView extends SignatureOverride {
  logoUrl: string | null;
}

/** Partie texte, envoyée par le formulaire ; le logo a sa propre route. */
export type SignatureOverrideInput = Pick<SignatureOverride, "tagline" | "qrUrl" | "hideLogo">;

export const EMPTY_OVERRIDE: SignatureOverride = { tagline: null, qrUrl: null, logo: null, hideLogo: false };
export const EMPTY_OVERRIDE_VIEW: SignatureOverrideView = { ...EMPTY_OVERRIDE, logoUrl: null };

/** true quand aucun réglage ne change la signature de base. */
export const isEmptyOverride = (override: SignatureOverride | null) =>
  !override || (override.tagline === null && override.qrUrl === null && override.logo === null && !override.hideLogo);

export type OverrideValidation =
  | { ok: true; value: SignatureOverrideInput }
  | { ok: false; errors: Partial<Record<"tagline" | "qrUrl" | "hideLogo", string>> };

/** null ou absent : on garde la valeur de la signature ; une chaîne (même vide) : la valeur de cette vidéo. */
const optionalLine = (value: unknown) => (value === null || value === undefined ? null : line(value));

/** Valide et nettoie une saisie inconnue (corps JSON d'une requête). Mêmes règles que les signatures. */
export function validateOverrideInput(raw: unknown): OverrideValidation {
  const data = (typeof raw === "object" && raw ? raw : {}) as Record<string, unknown>;
  const errors: Partial<Record<"tagline" | "qrUrl" | "hideLogo", string>> = {};
  const L = SIGNATURE_LIMITS;

  const typeOk = (value: unknown) => value === null || value === undefined || typeof value === "string";
  if (!typeOk(data.tagline)) errors.tagline = "Texte attendu.";
  if (!typeOk(data.qrUrl)) errors.qrUrl = "Lien attendu.";
  if (data.hideLogo !== undefined && typeof data.hideLogo !== "boolean") errors.hideLogo = "Valeur oui/non attendue.";

  const value: SignatureOverrideInput = {
    tagline: optionalLine(data.tagline),
    qrUrl: optionalLine(data.qrUrl),
    hideLogo: data.hideLogo === true,
  };
  if (!errors.tagline && value.tagline && value.tagline.length > L.taglineMax) {
    errors.tagline = `${L.taglineMax} caractères au maximum.`;
  }
  if (!errors.qrUrl && value.qrUrl) {
    if (value.qrUrl.length > L.qrUrlMax) errors.qrUrl = `${L.qrUrlMax} caractères au maximum.`;
    else if (!isHttpsUrl(value.qrUrl)) errors.qrUrl = "Un lien complet en https://.";
  }

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value };
}

/** Signature réellement montée dans cette vidéo : la signature de base, avec les réglages de la vidéo par-dessus. */
export function applyOverride(signature: Signature, override: SignatureOverride | null): Signature {
  if (!override) return signature;
  return {
    ...signature,
    tagline: override.tagline ?? signature.tagline,
    qrUrl: override.qrUrl ?? signature.qrUrl,
    logo: override.hideLogo ? null : (override.logo ?? signature.logo),
  };
}
