import "server-only";
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { requireEnv } from "./env";

function adminApp(): App {
  const existing = getApps()[0];
  if (existing) return existing;
  return initializeApp({
    credential: cert({
      projectId: requireEnv("FIREBASE_ADMIN_PROJECT_ID"),
      clientEmail: requireEnv("FIREBASE_ADMIN_CLIENT_EMAIL"),
      // La clé peut être collée sur une ligne avec des \n littéraux : on les remet en vrais retours à la ligne.
      privateKey: requireEnv("FIREBASE_ADMIN_PRIVATE_KEY").replace(/\\n/g, "\n"),
    }),
  });
}

export const adminAuth = () => getAuth(adminApp());
export const adminDb = () => getFirestore(adminApp());
/** Bucket Storage du projet. Son nom n'est pas un secret (il est aussi dans la config Firebase du navigateur). */
export function adminBucket() {
  const name = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim();
  if (!name) throw new Error("Variable manquante : NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET");
  return getStorage(adminApp()).bucket(name);
}

/** Code ou message d'une erreur, sans jamais inclure de clé : utilisable dans les logs serveur. */
export function errorCode(error: unknown): string {
  const message = (error instanceof Error ? error.message : String(error))
    .replace(/-----BEGIN[\s\S]*?-----END[^-]*-----/g, "[clé masquée]")
    .slice(0, 300);
  if (typeof error === "object" && error && "code" in error) {
    // Les erreurs gRPC de Firestore n'ont qu'un code numérique ; leur message commence par ce code et dit ce qui bloque.
    return typeof error.code === "number" ? message : String(error.code);
  }
  return message;
}
