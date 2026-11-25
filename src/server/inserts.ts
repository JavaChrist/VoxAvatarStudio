import "server-only";
import { FieldPath, FieldValue } from "firebase-admin/firestore";
import {
  detectInsertType,
  INSERT_EXTENSIONS,
  INSERT_MAX_BYTES,
  INSERT_SNIFF_BYTES,
  type InsertType,
  type InsertView,
  type ProjectInsert,
  type ProjectInserts,
} from "@/features/projects/inserts";
import type { Project } from "@/features/projects/schema";
import { adminBucket, adminDb } from "./firebase-admin";
import { generateImage } from "./image-generation";
import { getProject } from "./projects";
import { stagedUpload } from "./uploads";
import { signedReadUrl } from "./video";

// Images insérées d'un projet, uniquement côté serveur (firebase-admin). Le propriétaire doit avoir été vérifié par getProject.
// Fichiers privés sous projects/{id}/inserts/ : ils disparaissent avec le projet ; le navigateur ne les voit que par URL signée.
const projectRef = (id: string) => adminDb().collection("projects").doc(id);

/** Durée de validité du lien d'aperçu dans l'app. */
const IMAGE_URL_TTL_SECONDS = 15 * 60;

/** Erreur métier à l'enregistrement d'une image : `code` est renvoyé au navigateur. */
export class InsertError extends Error {
  constructor(readonly code: "upload_missing" | "image_too_large" | "image_invalid" | "scene_not_found") {
    super(code);
  }
}

export const INSERT_ERROR_STATUS: Record<InsertError["code"], number> = {
  upload_missing: 404,
  image_too_large: 413,
  image_invalid: 415,
  scene_not_found: 422,
};

/** Images du projet par ordre de scène, avec leur lien temporaire d'aperçu (gratuit). */
export async function toInsertViews(inserts: ProjectInserts): Promise<InsertView[]> {
  const entries = Object.entries(inserts).sort(([a], [b]) => Number(a) - Number(b));
  return Promise.all(
    entries.map(async ([scene, insert]) => {
      const { url } = await signedReadUrl(insert.storagePath, IMAGE_URL_TTL_SECONDS, insert.contentType);
      return { ...insert, scene: Number(scene), imageUrl: url };
    }),
  );
}

/** Relit le projet après écriture (le propriétaire a déjà été vérifié). */
async function reload(uid: string, id: string): Promise<Project> {
  const project = await getProject(uid, id);
  if (!project) throw new Error("project vanished");
  return project;
}

const removeFile = (path: string) =>
  adminBucket()
    .file(path)
    .delete({ ignoreNotFound: true })
    .catch(() => undefined);

/** La scène doit exister dans le script actuel. */
function requireScene(project: Project, scene: number) {
  if (!project.script || scene >= project.script.scenes.length) throw new InsertError("scene_not_found");
}

/** Nom horodaté : un lien signé encore ouvert ne montre jamais un mélange de l'ancienne et de la nouvelle image. */
const insertPath = (projectId: string, scene: number, contentType: InsertType) =>
  `projects/${projectId}/inserts/scene-${scene}-${Date.now()}.${INSERT_EXTENSIONS[contentType]}`;

/** Finit d'écrire le fichier de l'image (`prepare`), l'inscrit sur la scène, puis supprime l'image qu'elle remplace. */
async function attachInsert(
  uid: string,
  project: Project,
  scene: number,
  image: Omit<ProjectInsert, "uploadedAt">,
  prepare: () => Promise<unknown>,
): Promise<Project> {
  const previous = project.inserts[String(scene)] ?? null;
  try {
    await prepare();
    const insert: ProjectInsert = { ...image, uploadedAt: new Date().toISOString() };
    await projectRef(project.id).update(new FieldPath("inserts", String(scene)), insert, "updatedAt", FieldValue.serverTimestamp());
  } catch (error) {
    // Pas d'image orpheline si le projet n'a pas pu être mis à jour.
    await removeFile(image.storagePath);
    throw error;
  }
  if (previous) await removeFile(previous.storagePath);
  return reload(uid, project.id);
}

/**
 * Pose sur la scène l'image envoyée directement dans Storage (URL signée), à la place de l'éventuelle précédente.
 * Vérifie la taille réelle et les premiers octets ; un fichier refusé est supprimé aussitôt.
 */
export async function saveInsertFromUpload(uid: string, project: Project, scene: number, uploadId: unknown): Promise<Project> {
  requireScene(project, scene);

  const staged = stagedUpload(uid, uploadId);
  if (!staged) throw new InsertError("upload_missing");
  const [exists] = await staged.exists();
  if (!exists) throw new InsertError("upload_missing");

  const reject = async (code: InsertError["code"]) => {
    await staged.delete({ ignoreNotFound: true }).catch(() => undefined);
    return new InsertError(code);
  };

  const [metadata] = await staged.getMetadata();
  const sizeBytes = Number(metadata.size ?? 0);
  if (!(sizeBytes > 0)) throw await reject("image_invalid");
  if (sizeBytes > INSERT_MAX_BYTES) throw await reject("image_too_large");
  const [head] = await staged.download({ start: 0, end: INSERT_SNIFF_BYTES - 1 });
  const contentType = detectInsertType(new Uint8Array(head));
  if (!contentType) throw await reject("image_invalid");

  const storagePath = insertPath(project.id, scene, contentType);
  await staged.move(storagePath);
  // Le type enregistré est celui reconnu dans le fichier, pas celui annoncé par le navigateur.
  return attachInsert(uid, project, scene, { storagePath, contentType, sizeBytes }, () =>
    adminBucket().file(storagePath).setMetadata({ contentType, cacheControl: "private, max-age=0" }),
  );
}

/**
 * Génère l'image de la scène chez fal (un appel facturé) et la pose comme une image envoyée à la main.
 * La scène est vérifiée avant l'appel, pour ne rien payer en vain.
 */
export async function generateInsert(uid: string, project: Project, scene: number, description: string): Promise<Project> {
  requireScene(project, scene);
  const { bytes, contentType } = await generateImage(description);
  const storagePath = insertPath(project.id, scene, contentType);
  return attachInsert(uid, project, scene, { storagePath, contentType, sizeBytes: bytes.length }, () =>
    adminBucket()
      .file(storagePath)
      .save(bytes, { resumable: false, contentType, metadata: { cacheControl: "private, max-age=0" } }),
  );
}

/** Retire l'image de la scène. Null si la scène n'avait pas d'image. */
export async function deleteInsert(uid: string, project: Project, scene: number): Promise<Project | null> {
  const previous = project.inserts[String(scene)];
  if (!previous) return null;
  // Document d'abord : l'image disparaît du montage même si la suppression du fichier échoue.
  await projectRef(project.id).update(new FieldPath("inserts", String(scene)), FieldValue.delete(), "updatedAt", FieldValue.serverTimestamp());
  await removeFile(previous.storagePath);
  return reload(uid, project.id);
}
