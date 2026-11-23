import "server-only";
import { randomBytes } from "node:crypto";
import { adminBucket } from "./firebase-admin";

// Envoi direct navigateur → Storage par URL signée V4 (action « write »), pour les fichiers trop gros pour Vercel (4,5 Mo).
// Doc vérifiée le 2026-11-23 : docs.cloud.google.com/storage/docs/access-control/signing-urls-with-helpers
// et docs.cloud.google.com/storage/docs/cors-configurations (le bucket doit autoriser le PUT depuis l'origine de l'app).
//
// Le fichier atterrit dans une zone d'attente propre à l'utilisateur : uploads/{uid}/{uploadId}.
// Rien n'est utilisé tant que le serveur n'a pas vérifié son contenu réel puis déplacé le fichier.

/** Validité de l'URL d'envoi : le temps de téléverser 20 Mo sur une connexion lente. */
const UPLOAD_URL_TTL_SECONDS = 10 * 60;

/** Un fichier en attente plus vieux que ça a été abandonné : on le supprime au prochain envoi. */
const STALE_UPLOAD_MS = 60 * 60 * 1000;

const isValidUploadId = (id: string) => /^[a-f0-9]{32}$/.test(id);
const prefix = (uid: string) => `uploads/${uid}/`;

/**
 * URL signée pour un seul PUT, limitée à un chemin et à un type de contenu : le navigateur doit envoyer
 * exactement cet en-tête Content-Type, sinon la signature est refusée par Storage.
 */
export async function createSignedUpload(uid: string, contentType: string) {
  const uploadId = randomBytes(16).toString("hex");
  const expires = Date.now() + UPLOAD_URL_TTL_SECONDS * 1000;
  const [url] = await adminBucket()
    .file(`${prefix(uid)}${uploadId}`)
    .getSignedUrl({ version: "v4", action: "write", expires, contentType });
  return { uploadId, url, expiresAt: new Date(expires).toISOString() };
}

/** Fichier en attente de l'utilisateur. Null si l'identifiant est mal formé : on ne sort jamais de son dossier. */
export function stagedUpload(uid: string, uploadId: unknown) {
  if (typeof uploadId !== "string" || !isValidUploadId(uploadId)) return null;
  return adminBucket().file(`${prefix(uid)}${uploadId}`);
}

/** Supprime les envois abandonnés de l'utilisateur (jamais finalisés). Échec silencieux : simple ménage. */
export async function cleanupStaleUploads(uid: string) {
  try {
    const [files] = await adminBucket().getFiles({ prefix: prefix(uid) });
    const limit = Date.now() - STALE_UPLOAD_MS;
    await Promise.all(
      files
        .filter((file) => Date.parse(String(file.metadata.timeCreated ?? "")) < limit)
        .map((file) => file.delete({ ignoreNotFound: true }).catch(() => undefined)),
    );
  } catch {
    // Le ménage sera retenté au prochain envoi.
  }
}
