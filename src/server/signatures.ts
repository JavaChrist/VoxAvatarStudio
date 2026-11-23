import "server-only";
import { FieldValue, Timestamp, type DocumentSnapshot } from "firebase-admin/firestore";
import type { LogoType, Signature, SignatureInput, SignatureLogo, SignatureView } from "@/features/signatures/schema";
import { adminBucket, adminDb } from "./firebase-admin";
import type { SessionUser } from "./session";
import { signedReadUrl } from "./video";

// Bibliothèque des signatures de fin, uniquement côté serveur (firebase-admin). Chaque accès vérifie le propriétaire.
// Logo privé dans Storage, sous signatures/{id}/ ; le navigateur ne le voit que par URL signée temporaire.
const signatures = () => adminDb().collection("signatures");

/** Identifiant Firestore auto-généré ; on refuse tout le reste avant d'interroger la base. */
const isValidId = (id: string) => /^[A-Za-z0-9]{1,64}$/.test(id);

const toIso = (value: unknown) => (value instanceof Timestamp ? value.toDate().toISOString() : new Date(0).toISOString());

/** Durée de validité du lien d'aperçu du logo dans l'app. */
const LOGO_URL_TTL_SECONDS = 15 * 60;

const LOGO_EXTENSIONS: Record<LogoType, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

function toSignature(snapshot: DocumentSnapshot): Signature {
  const data = snapshot.data() ?? {};
  return {
    id: snapshot.id,
    name: data.name ?? "",
    displayName: data.displayName ?? "",
    tagline: data.tagline ?? "",
    website: data.website ?? "",
    handle: data.handle ?? "",
    qrUrl: data.qrUrl ?? "",
    logo: data.logo ?? null,
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
  };
}

/** Ajoute le lien temporaire du logo (gratuit). */
export async function toView(signature: Signature): Promise<SignatureView> {
  const logoUrl = signature.logo
    ? (await signedReadUrl(signature.logo.storagePath, LOGO_URL_TTL_SECONDS, signature.logo.contentType)).url
    : null;
  return { ...signature, logoUrl };
}

/** Renvoie le document si la signature existe et appartient à l'utilisateur, sinon null. */
async function ownedSnapshot(uid: string, id: string): Promise<DocumentSnapshot | null> {
  if (!isValidId(id)) return null;
  const snapshot = await signatures().doc(id).get();
  return snapshot.exists && snapshot.get("ownerUid") === uid ? snapshot : null;
}

/** Signatures de l'utilisateur, par nom. Tri en mémoire : pas d'index composite à créer. */
export async function listSignatures(uid: string): Promise<Signature[]> {
  const snapshot = await signatures().where("ownerUid", "==", uid).get();
  return snapshot.docs.map(toSignature).sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

/** Renvoie null si la signature n'existe pas ou n'appartient pas à l'utilisateur. */
export async function getSignature(uid: string, id: string): Promise<Signature | null> {
  const snapshot = await ownedSnapshot(uid, id);
  return snapshot ? toSignature(snapshot) : null;
}

export async function createSignature(user: SessionUser, input: SignatureInput): Promise<Signature> {
  const ref = signatures().doc();
  await ref.set({
    ...input,
    logo: null,
    ownerUid: user.uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return toSignature(await ref.get());
}

/** Remplace les textes de la signature ; le logo n'est pas touché. Null si absente ou d'un autre compte. */
export async function updateSignature(uid: string, id: string, input: SignatureInput): Promise<Signature | null> {
  const snapshot = await ownedSnapshot(uid, id);
  if (!snapshot) return null;
  await snapshot.ref.update({ ...input, updatedAt: FieldValue.serverTimestamp() });
  return toSignature(await snapshot.ref.get());
}

/**
 * Enregistre un nouveau logo (contenu déjà vérifié par l'appelant), puis supprime l'ancien.
 * Nom de fichier horodaté : un lien signé encore ouvert ne montre jamais un mélange des deux. Null si absente.
 */
export async function saveLogo(uid: string, id: string, bytes: Buffer, contentType: LogoType): Promise<Signature | null> {
  const snapshot = await ownedSnapshot(uid, id);
  if (!snapshot) return null;
  const previous = toSignature(snapshot).logo;
  const storagePath = `signatures/${id}/logo-${Date.now()}.${LOGO_EXTENSIONS[contentType]}`;
  await adminBucket()
    .file(storagePath)
    .save(bytes, { contentType, resumable: false, metadata: { cacheControl: "private, max-age=0" } });
  const logo: SignatureLogo = { storagePath, contentType, sizeBytes: bytes.length, uploadedAt: new Date().toISOString() };
  await snapshot.ref.update({ logo, updatedAt: FieldValue.serverTimestamp() });
  if (previous) await removeFile(previous.storagePath);
  return toSignature(await snapshot.ref.get());
}

/** Retire le logo de la signature. Null si absente ou d'un autre compte. */
export async function deleteLogo(uid: string, id: string): Promise<Signature | null> {
  const snapshot = await ownedSnapshot(uid, id);
  if (!snapshot) return null;
  const previous = toSignature(snapshot).logo;
  await snapshot.ref.update({ logo: null, updatedAt: FieldValue.serverTimestamp() });
  if (previous) await removeFile(previous.storagePath);
  return toSignature(await snapshot.ref.get());
}

/** Supprime définitivement la signature : fichiers d'abord, puis le document. False si absente ou d'un autre compte. */
export async function deleteSignature(uid: string, id: string): Promise<boolean> {
  const snapshot = await ownedSnapshot(uid, id);
  if (!snapshot) return false;
  // Fichiers d'abord : si la suite échoue, la signature reste visible et la suppression peut être relancée.
  await adminBucket().deleteFiles({ prefix: `signatures/${id}/` });
  await snapshot.ref.delete();
  return true;
}

/** Un ancien logo resté dans Storage n'empêche rien : il est effacé avec la signature. */
async function removeFile(path: string) {
  await adminBucket()
    .file(path)
    .delete({ ignoreNotFound: true })
    .catch(() => console.warn("[signatures] old logo cleanup failed"));
}
