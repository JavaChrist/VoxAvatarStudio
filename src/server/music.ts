import "server-only";
import { FieldValue, Timestamp, type DocumentSnapshot } from "firebase-admin/firestore";
import {
  detectMusicType,
  MUSIC_EXTENSIONS,
  MUSIC_MAX_BYTES,
  MUSIC_SNIFF_BYTES,
  type Music,
  type MusicTrack,
  type MusicView,
} from "@/features/music/schema";
import { adminBucket, adminDb } from "./firebase-admin";
import type { SessionUser } from "./session";
import { stagedUpload } from "./uploads";
import { signedReadUrl } from "./video";

// Bibliothèque des musiques de fond, uniquement côté serveur (firebase-admin). Chaque accès vérifie le propriétaire.
// Piste privée dans Storage, sous music/{id}/ ; le navigateur ne l'écoute que par URL signée temporaire.
const musics = () => adminDb().collection("music");

/** Identifiant Firestore auto-généré ; on refuse tout le reste avant d'interroger la base. */
const isValidId = (id: string) => /^[A-Za-z0-9]{1,64}$/.test(id);

const toIso = (value: unknown) => (value instanceof Timestamp ? value.toDate().toISOString() : new Date(0).toISOString());

/** Durée de validité du lien d'écoute dans l'app. */
const TRACK_URL_TTL_SECONDS = 30 * 60;

/** Erreur métier à la finalisation d'un envoi : `code` est renvoyé au navigateur. */
export class MusicUploadError extends Error {
  constructor(readonly code: "upload_missing" | "track_too_large" | "track_invalid") {
    super(code);
  }
}

export const MUSIC_UPLOAD_ERROR_STATUS: Record<MusicUploadError["code"], number> = {
  upload_missing: 404,
  track_too_large: 413,
  track_invalid: 415,
};

function toMusic(snapshot: DocumentSnapshot): Music {
  const data = snapshot.data() ?? {};
  return {
    id: snapshot.id,
    name: data.name ?? "",
    track: data.track,
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
  };
}

/** Ajoute le lien temporaire d'écoute (gratuit). */
export async function toMusicView(music: Music): Promise<MusicView> {
  const { url } = await signedReadUrl(music.track.storagePath, TRACK_URL_TTL_SECONDS, music.track.contentType);
  return { ...music, trackUrl: url };
}

async function ownedSnapshot(uid: string, id: string): Promise<DocumentSnapshot | null> {
  if (!isValidId(id)) return null;
  const snapshot = await musics().doc(id).get();
  return snapshot.exists && snapshot.get("ownerUid") === uid ? snapshot : null;
}

/** Musiques de l'utilisateur, par nom. Tri en mémoire : pas d'index composite à créer. */
export async function listMusic(uid: string): Promise<Music[]> {
  const snapshot = await musics().where("ownerUid", "==", uid).get();
  return snapshot.docs.map(toMusic).sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

/** Renvoie null si la musique n'existe pas ou n'appartient pas à l'utilisateur. */
export async function getMusic(uid: string, id: string): Promise<Music | null> {
  const snapshot = await ownedSnapshot(uid, id);
  return snapshot ? toMusic(snapshot) : null;
}

/**
 * Crée la musique à partir d'un fichier envoyé directement dans Storage (URL signée).
 * Vérifie la taille réelle et les premiers octets ; un fichier refusé est supprimé aussitôt.
 */
export async function createMusicFromUpload(user: SessionUser, uploadId: unknown, name: string): Promise<Music> {
  const staged = stagedUpload(user.uid, uploadId);
  if (!staged) throw new MusicUploadError("upload_missing");
  const [exists] = await staged.exists();
  if (!exists) throw new MusicUploadError("upload_missing");

  const reject = async (code: MusicUploadError["code"]) => {
    await staged.delete({ ignoreNotFound: true }).catch(() => undefined);
    return new MusicUploadError(code);
  };

  const [metadata] = await staged.getMetadata();
  const sizeBytes = Number(metadata.size ?? 0);
  if (!(sizeBytes > 0)) throw await reject("track_invalid");
  if (sizeBytes > MUSIC_MAX_BYTES) throw await reject("track_too_large");
  const [head] = await staged.download({ start: 0, end: MUSIC_SNIFF_BYTES - 1 });
  const contentType = detectMusicType(new Uint8Array(head));
  if (!contentType) throw await reject("track_invalid");

  const ref = musics().doc();
  const storagePath = `music/${ref.id}/track-${Date.now()}.${MUSIC_EXTENSIONS[contentType]}`;
  await staged.move(storagePath);
  const file = adminBucket().file(storagePath);
  try {
    // Le type enregistré est celui reconnu dans le fichier, pas celui annoncé par le navigateur.
    await file.setMetadata({ contentType, cacheControl: "private, max-age=0" });
    const track: MusicTrack = { storagePath, contentType, sizeBytes, uploadedAt: new Date().toISOString() };
    await ref.set({
      name,
      track,
      ownerUid: user.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    // Pas de piste orpheline si le document n'a pas pu être créé.
    await file.delete({ ignoreNotFound: true }).catch(() => undefined);
    throw error;
  }
  return toMusic(await ref.get());
}

/** Renomme la musique. Null si absente ou d'un autre compte. */
export async function renameMusic(uid: string, id: string, name: string): Promise<Music | null> {
  const snapshot = await ownedSnapshot(uid, id);
  if (!snapshot) return null;
  await snapshot.ref.update({ name, updatedAt: FieldValue.serverTimestamp() });
  return toMusic(await snapshot.ref.get());
}

/** Supprime définitivement la musique : piste d'abord, puis le document. False si absente ou d'un autre compte. */
export async function deleteMusic(uid: string, id: string): Promise<boolean> {
  const snapshot = await ownedSnapshot(uid, id);
  if (!snapshot) return false;
  // Fichiers d'abord : si la suite échoue, la musique reste visible et la suppression peut être relancée.
  await adminBucket().deleteFiles({ prefix: `music/${id}/` });
  await snapshot.ref.delete();
  return true;
}
