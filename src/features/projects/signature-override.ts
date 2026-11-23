// Réglages de la signature de fin propres à une vidéo : nom affiché, accroche, site, pseudo, lien du QR code et logo.
// Posés par-dessus la signature choisie au montage, sans jamais la modifier. Partagé navigateur/serveur : aucun secret ici.
import {
  HANDLE_ERROR,
  SIGNATURE_LIMITS,
  isHandle,
  isHttpsUrl,
  line,
  type Signature,
  type SignatureLogo,
} from "@/features/signatures/schema";

/** Textes réglables par vidéo, dans l'ordre de l'éditeur de signature. */
export const OVERRIDE_TEXT_FIELDS = ["displayName", "tagline", "website", "handle", "qrUrl"] as const;
export type OverrideTextField = (typeof OVERRIDE_TEXT_FIELDS)[number];

/** Pour chaque texte : null reprend la valeur de la signature ; "" le retire de cette vidéo. */
type OverrideTexts = Record<OverrideTextField, string | null>;

export interface SignatureOverride extends OverrideTexts {
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
export type SignatureOverrideInput = OverrideTexts & Pick<SignatureOverride, "hideLogo">;

const NO_TEXTS: OverrideTexts = { displayName: null, tagline: null, website: null, handle: null, qrUrl: null };

export const EMPTY_OVERRIDE: SignatureOverride = { ...NO_TEXTS, logo: null, hideLogo: false };
export const EMPTY_OVERRIDE_VIEW: SignatureOverrideView = { ...EMPTY_OVERRIDE, logoUrl: null };

/** true quand aucun réglage ne change la signature de base. */
export const isEmptyOverride = (override: SignatureOverride | null) =>
  !override ||
  (OVERRIDE_TEXT_FIELDS.every((field) => override[field] === null) && override.logo === null && !override.hideLogo);

type OverrideErrors = Partial<Record<OverrideTextField | "hideLogo", string>>;

export type OverrideValidation = { ok: true; value: SignatureOverrideInput } | { ok: false; errors: OverrideErrors };

/** null ou absent : on garde la valeur de la signature ; une chaîne (même vide) : la valeur de cette vidéo. */
const optionalLine = (value: unknown) => (value === null || value === undefined ? null : line(value));

const MAX: Record<OverrideTextField, number> = {
  displayName: SIGNATURE_LIMITS.displayNameMax,
  tagline: SIGNATURE_LIMITS.taglineMax,
  website: SIGNATURE_LIMITS.websiteMax,
  handle: SIGNATURE_LIMITS.handleMax,
  qrUrl: SIGNATURE_LIMITS.qrUrlMax,
};

/** Valide et nettoie une saisie inconnue (corps JSON d'une requête). Mêmes règles que les signatures. */
export function validateOverrideInput(raw: unknown): OverrideValidation {
  const data = (typeof raw === "object" && raw ? raw : {}) as Record<string, unknown>;
  const errors: OverrideErrors = {};
  const value: SignatureOverrideInput = { ...NO_TEXTS, hideLogo: data.hideLogo === true };

  for (const field of OVERRIDE_TEXT_FIELDS) {
    const rawValue = data[field];
    if (rawValue !== null && rawValue !== undefined && typeof rawValue !== "string") {
      errors[field] = field === "qrUrl" ? "Lien attendu." : "Texte attendu.";
      continue;
    }
    const text = optionalLine(rawValue);
    value[field] = text;
    if (!text) continue;
    if (text.length > MAX[field]) errors[field] = `${MAX[field]} caractères au maximum.`;
    else if (field === "handle" && !isHandle(text)) errors.handle = HANDLE_ERROR;
    else if (field === "qrUrl" && !isHttpsUrl(text)) errors.qrUrl = "Un lien complet en https://.";
  }
  if (data.hideLogo !== undefined && typeof data.hideLogo !== "boolean") errors.hideLogo = "Valeur oui/non attendue.";

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value };
}

/** Signature réellement montée dans cette vidéo : la signature de base, avec les réglages de la vidéo par-dessus. */
export function applyOverride(signature: Signature, override: SignatureOverride | null): Signature {
  if (!override) return signature;
  const mounted: Signature = { ...signature, logo: override.hideLogo ? null : (override.logo ?? signature.logo) };
  for (const field of OVERRIDE_TEXT_FIELDS) mounted[field] = override[field] ?? signature[field];
  return mounted;
}
