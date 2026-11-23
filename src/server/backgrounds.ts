import "server-only";
import { FieldValue, Timestamp, type DocumentSnapshot } from "firebase-admin/firestore";
import {
  BACKGROUND_EXTENSIONS,
  type Background,
  type BackgroundImage,
  type BackgroundType,
  type BackgroundView,
} from "@/features/backgrounds/schema";
import { adminBucket, adminDb } from "./firebase-admin";
import type { SessionUser } from "./session";
import { signedReadUrl } from "./video";

// Bibliothèque des fonds de vidéo, uniquement côté serveur (firebase-admin). Chaque accès vérifie le propriétaire.
// Image privée dans Storage, sous backgrounds/{id}/ ; le navigateur ne la voit que par URL signée temporaire.
const backgrounds = () => adminDb().collection("backgrounds");

/** Identifiant Firestore auto-généré ; on refuse tout le reste avant d'interroger la base. */
const isValidId = (id: string) => /^[A-Za-z0-9]{1,64}$/.test(id);

const toIso = (value: unknown) => (value instanceof Timestamp ? value.toDate().toISOString() : new Date(0).toISOString());

/** Durée de validité du lien d'aperçu de l'image dans l'app. */
const IMAGE_URL_TTL_SECONDS = 15 * 60;

function toBackground(snapshot: DocumentSnapshot): Background {
  const data = snapshot.data() ?? {};
  return {
    id: snapshot.id,
    name: data.name ?? "",
    image: data.image,
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
  };
}

/** Ajoute le lien temporaire de l'image (gratuit). */
export async function toBackgroundView(background: Background): Promise<BackgroundView> {
  const { url } = await signedReadUrl(background.image.storagePath, IMAGE_URL_TTL_SECONDS, background.image.contentType);
  return { ...background, imageUrl: url };
}

async function ownedSnapshot(uid: string, id: string): Promise<DocumentSnapshot | null> {
  if (!isValidId(id)) return null;
  const snapshot = await backgrounds().doc(id).get();
  return snapshot.exists && snapshot.get("ownerUid") === uid ? snapshot : null;
}

/** Fonds de l'utilisateur, par nom. Tri en mémoire : pas d'index composite à créer. */
export async function listBackgrounds(uid: string): Promise<Background[]> {
  const snapshot = await backgrounds().where("ownerUid", "==", uid).get();
  return snapshot.docs.map(toBackground).sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

/** Renvoie null si le fond n'existe pas ou n'appartient pas à l'utilisateur. */
export async function getBackground(uid: string, id: string): Promise<Background | null> {
  const snapshot = await ownedSnapshot(uid, id);
  return snapshot ? toBackground(snapshot) : null;
}

/** Crée le fond avec son image (contenu déjà vérifié par l'appelant) : image d'abord, document ensuite. */
export async function createBackground(user: SessionUser, name: string, bytes: Buffer, contentType: BackgroundType): Promise<Background> {
  const ref = backgrounds().doc();
  const storagePath = `backgrounds/${ref.id}/image-${Date.now()}.${BACKGROUND_EXTENSIONS[contentType]}`;
  await adminBucket()
    .file(storagePath)
    .save(bytes, { contentType, resumable: false, metadata: { cacheControl: "private, max-age=0" } });
  const image: BackgroundImage = { storagePath, contentType, sizeBytes: bytes.length, uploadedAt: new Date().toISOString() };
  try {
    await ref.set({
      name,
      image,
      ownerUid: user.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    // Pas d'image orpheline si le document n'a pas pu être créé.
    await adminBucket().file(storagePath).delete({ ignoreNotFound: true }).catch(() => undefined);
    throw error;
  }
  return toBackground(await ref.get());
}

/** Renomme le fond. Null si absent ou d'un autre compte. */
export async function renameBackground(uid: string, id: string, name: string): Promise<Background | null> {
  const snapshot = await ownedSnapshot(uid, id);
  if (!snapshot) return null;
  await snapshot.ref.update({ name, updatedAt: FieldValue.serverTimestamp() });
  return toBackground(await snapshot.ref.get());
}

/** Supprime définitivement le fond : image d'abord, puis le document. False si absent ou d'un autre compte. */
export async function deleteBackground(uid: string, id: string): Promise<boolean> {
  const snapshot = await ownedSnapshot(uid, id);
  if (!snapshot) return false;
  // Fichiers d'abord : si la suite échoue, le fond reste visible et la suppression peut être relancée.
  await adminBucket().deleteFiles({ prefix: `backgrounds/${id}/` });
  await snapshot.ref.delete();
  return true;
}
