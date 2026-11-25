import "server-only";
import { createHash, createPublicKey, verify, type KeyObject } from "node:crypto";

// Vérification des appels (« webhooks ») de fal : signature Ed25519 sur les en-têtes et le corps brut.
// Doc vérifiée le 2026-11-25 : fal.ai/docs/model-apis/model-endpoints/webhooks

const JWKS_URL = "https://rest.fal.ai/.well-known/jwks.json";
/** fal autorise de garder ses clés publiques 24 h au plus ; 1 h suit plus vite un changement de clé. */
const JWKS_TTL_MS = 60 * 60 * 1000;
/** Écart toléré entre l'horodatage signé et l'heure du serveur, contre le rejeu d'un ancien appel. */
const TOLERANCE_SECONDS = 5 * 60;

export interface SignedCall {
  message: Buffer;
  signature: Buffer;
}

/** Ce que fal a signé, reconstruit depuis les en-têtes et le corps. null si un en-tête manque ou si l'appel est trop vieux. */
export function readSignedCall(headers: Headers, body: Uint8Array, now = Date.now()): SignedCall | null {
  const requestId = headers.get("x-fal-webhook-request-id");
  const userId = headers.get("x-fal-webhook-user-id");
  const timestamp = headers.get("x-fal-webhook-timestamp");
  const signature = headers.get("x-fal-webhook-signature");
  if (!requestId || !userId || !timestamp || !signature) return null;
  if (!/^\d{1,12}$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > TOLERANCE_SECONDS) return null;
  // Une signature Ed25519 fait 64 octets, envoyés en hexadécimal.
  if (!/^[0-9a-f]{128}$/i.test(signature)) return null;
  const digest = createHash("sha256").update(body).digest("hex");
  return { message: Buffer.from([requestId, userId, timestamp, digest].join("\n"), "utf8"), signature: Buffer.from(signature, "hex") };
}

/** Clés publiques Ed25519 d'un document JWKS (champ `x` en base64url). */
export function toPublicKeys(jwks: unknown): KeyObject[] {
  const keys = (jwks as { keys?: unknown } | null)?.keys;
  if (!Array.isArray(keys)) return [];
  return keys.flatMap((entry) => {
    const x = (entry as { x?: unknown } | null)?.x;
    if (typeof x !== "string") return [];
    try {
      return [createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x }, format: "jwk" })];
    } catch {
      return [];
    }
  });
}

/** Valide si l'une des clés publiées correspond. */
export const isSignedBy = (call: SignedCall, keys: KeyObject[]) => keys.some((key) => verify(null, call.message, key, call.signature));

let cache: { keys: KeyObject[]; expiresAt: number } | null = null;

async function falPublicKeys(): Promise<KeyObject[]> {
  if (cache && Date.now() < cache.expiresAt) return cache.keys;
  const response = await fetch(JWKS_URL, { cache: "no-store", signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`clés fal ${response.status}`);
  const keys = toPublicKeys(await response.json());
  if (!keys.length) throw new Error("clés fal illisibles");
  cache = { keys, expiresAt: Date.now() + JWKS_TTL_MS };
  return keys;
}

/** Vrai si l'appel vient de fal. Lève une erreur si les clés publiques de fal sont injoignables. */
export async function isFromFal(headers: Headers, body: Uint8Array): Promise<boolean> {
  const call = readSignedCall(headers, body);
  // Les clés ne sont demandées que pour un appel qui a la bonne forme.
  return call !== null && isSignedBy(call, await falPublicKeys());
}
