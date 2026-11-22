import "server-only";
import { cookies } from "next/headers";
import { allowedEmails } from "./env";
import { adminAuth } from "./firebase-admin";

export const SESSION_COOKIE = "__session";
export const SESSION_MAX_AGE_S = 7 * 24 * 60 * 60;

export interface SessionUser {
  uid: string;
  email: string;
}

/** Vérifie le jeton de connexion Firebase et crée le cookie de session, réservé aux e-mails autorisés. */
export async function createSession(idToken: string): Promise<SessionUser | null> {
  const auth = adminAuth();
  const decoded = await auth.verifyIdToken(idToken, true);
  const email = decoded.email?.toLowerCase();
  if (!email || !allowedEmails().has(email)) return null;
  // Un jeton trop ancien ne permet pas d'ouvrir une session : il faut s'être connecté à l'instant.
  if (Date.now() / 1000 - decoded.auth_time > 5 * 60) return null;

  const sessionCookie = await auth.createSessionCookie(idToken, { expiresIn: SESSION_MAX_AGE_S * 1000 });
  const store = await cookies();
  store.set(SESSION_COOKIE, sessionCookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  });
  return { uid: decoded.uid, email };
}

/** Déconnecte cet appareil seulement : les autres sessions restent ouvertes. */
export async function clearSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Utilisateur connecté, ou null. Vérifie la signature, la révocation et la liste blanche. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!value) return null;
  try {
    const decoded = await adminAuth().verifySessionCookie(value, true);
    const email = decoded.email?.toLowerCase();
    if (!email || !allowedEmails().has(email)) return null;
    return { uid: decoded.uid, email };
  } catch {
    return null;
  }
}
