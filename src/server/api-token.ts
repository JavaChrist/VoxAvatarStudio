import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { allowedEmails } from "./env";
import { adminAuth } from "./firebase-admin";

// Accès machine (connecteur MCP, scripts) : « Authorization: Bearer <VOX_API_TOKEN> » agit au nom du compte VOX_API_UID.
// Désactivé tant que VOX_API_TOKEN n'est pas défini. Le compte doit rester dans ALLOWED_EMAILS.

/** Longueur minimale du jeton : un secret court se devine. */
const MIN_TOKEN_LENGTH = 32;

const digest = (value: string) => createHash("sha256").update(value).digest();

/** Jeton du header Authorization, ou null. */
export function bearerToken(authorization: string | null): string | null {
  const match = authorization?.match(/^Bearer\s+(\S+)$/i);
  return match?.[1] ?? null;
}

/** Compare le jeton reçu à VOX_API_TOKEN en temps constant (sur leurs empreintes, de même longueur). */
export function isValidApiToken(token: string): boolean {
  const expected = process.env.VOX_API_TOKEN?.trim();
  if (!expected || expected.length < MIN_TOKEN_LENGTH) return false;
  return timingSafeEqual(digest(token), digest(expected));
}

/** Compte au nom duquel agit le jeton : VOX_API_UID, vérifié dans Firebase Auth et dans la liste blanche. */
export async function apiTokenUser(token: string): Promise<{ uid: string; email: string } | null> {
  if (!isValidApiToken(token)) return null;
  const uid = process.env.VOX_API_UID?.trim();
  if (!uid) return null;
  try {
    const user = await adminAuth().getUser(uid);
    const email = user.email?.toLowerCase();
    if (user.disabled || !email || !allowedEmails().has(email)) return null;
    return { uid, email };
  } catch {
    return null;
  }
}
