// Signature de fin : carte animée de 4 s ajoutée après la voix. Bibliothèque réutilisable d'un projet à l'autre.
// Partagé entre le serveur et le navigateur : aucun secret ici.

export const SIGNATURE_LIMITS = {
  nameMax: 60,
  displayNameMax: 60,
  taglineMax: 120,
  websiteMax: 80,
  handleMax: 40,
  qrUrlMax: 300,
} as const;

/** Durée de la carte de fin dans la vidéo. */
export const SIGNATURE_SECONDS = 4;

/** Logo : image importée, gardée privée dans Storage. Le type est déduit du contenu, pas de ce que dit le navigateur. */
export const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type LogoType = (typeof LOGO_TYPES)[number];
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;

export interface SignatureLogo {
  storagePath: string;
  contentType: LogoType;
  sizeBytes: number;
  uploadedAt: string;
}

/** Saisie du formulaire ; seul `name` (nom dans la bibliothèque) est obligatoire. Les champs vides ne s'affichent pas. */
export interface SignatureInput {
  name: string;
  displayName: string;
  tagline: string;
  website: string;
  handle: string;
  /** Lien encodé dans le QR code (https uniquement). Vide : pas de QR code. */
  qrUrl: string;
}

export interface Signature extends SignatureInput {
  id: string;
  logo: SignatureLogo | null;
  createdAt: string;
  updatedAt: string;
}

/** Signature renvoyée au navigateur, avec un lien temporaire vers le logo. */
export interface SignatureView extends Signature {
  logoUrl: string | null;
}

export type SignatureValidation =
  | { ok: true; value: SignatureInput }
  | { ok: false; errors: Partial<Record<keyof SignatureInput, string>> };

/** Extension des fichiers de logo dans Storage, selon le type détecté. */
export const LOGO_EXTENSIONS: Record<LogoType, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

/** Une ligne, espaces resserrés : ces textes s'affichent tels quels dans la vidéo. */
export const line = (value: unknown) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");

export const isHttpsUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
};

/** Valide et nettoie une saisie inconnue (corps JSON d'une requête). */
export function validateSignatureInput(raw: unknown): SignatureValidation {
  const data = (typeof raw === "object" && raw ? raw : {}) as Record<string, unknown>;
  const value: SignatureInput = {
    name: line(data.name),
    displayName: line(data.displayName),
    tagline: line(data.tagline),
    website: line(data.website),
    handle: line(data.handle),
    qrUrl: line(data.qrUrl),
  };
  const errors: Partial<Record<keyof SignatureInput, string>> = {};
  const L = SIGNATURE_LIMITS;

  if (!value.name) errors.name = "Donne un nom à cette signature.";
  else if (value.name.length > L.nameMax) errors.name = `Le nom ne doit pas dépasser ${L.nameMax} caractères.`;
  if (value.displayName.length > L.displayNameMax) errors.displayName = `${L.displayNameMax} caractères au maximum.`;
  if (value.tagline.length > L.taglineMax) errors.tagline = `${L.taglineMax} caractères au maximum.`;
  if (value.website.length > L.websiteMax) errors.website = `${L.websiteMax} caractères au maximum.`;
  if (value.handle.length > L.handleMax) errors.handle = `${L.handleMax} caractères au maximum.`;
  else if (value.handle && !/^@?[\p{L}\p{N}_.-]+$/u.test(value.handle)) {
    errors.handle = "Un pseudo sans espace, par exemple @javachrist.";
  }
  if (value.qrUrl.length > L.qrUrlMax) errors.qrUrl = `${L.qrUrlMax} caractères au maximum.`;
  else if (value.qrUrl && !isHttpsUrl(value.qrUrl)) errors.qrUrl = "Un lien complet en https://.";

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value };
}

/** Reconnaît PNG, JPEG et WebP à leurs premiers octets ; null pour tout le reste (SVG compris). */
export function detectLogoType(bytes: Uint8Array): LogoType | null {
  const starts = (...sig: number[]) => sig.every((byte, i) => bytes[i] === byte);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}
