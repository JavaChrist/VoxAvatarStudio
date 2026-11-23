import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import type { Project } from "@/features/projects/schema";
import {
  EMPTY_OVERRIDE,
  type SignatureOverride,
  type SignatureOverrideInput,
  type SignatureOverrideView,
} from "@/features/projects/signature-override";
import { LOGO_EXTENSIONS, type LogoType, type SignatureLogo } from "@/features/signatures/schema";
import { adminBucket, adminDb, errorCode } from "./firebase-admin";
import { getProject } from "./projects";
import { signedReadUrl } from "./video";

// Réglages de la signature propres à un projet (accroche, QR code, logo), uniquement côté serveur.
// Le logo est privé sous projects/{id}/ : il disparaît avec le projet. Le propriétaire doit avoir été vérifié par getProject.
const projectRef = (id: string) => adminDb().collection("projects").doc(id);

/** Durée de validité du lien d'aperçu du logo dans l'app. */
const LOGO_URL_TTL_SECONDS = 15 * 60;

/** Ajoute le lien temporaire du logo de la vidéo (gratuit). */
export async function toOverrideView(override: SignatureOverride | null): Promise<SignatureOverrideView> {
  const current = override ?? EMPTY_OVERRIDE;
  const logoUrl = current.logo
    ? (await signedReadUrl(current.logo.storagePath, LOGO_URL_TTL_SECONDS, current.logo.contentType)).url
    : null;
  return { ...current, logoUrl };
}

/** Projet de l'utilisateur, ou la réponse d'erreur à renvoyer (404 aussi pour le projet d'un autre compte). */
export async function ownedProject(uid: string, id: string, scope: string): Promise<Project | Response> {
  try {
    const project = await getProject(uid, id);
    return project ?? Response.json({ error: "not_found" }, { status: 404 });
  } catch (error) {
    console.error(`[signature-override] ${scope} project read failed`, errorCode(error));
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}

/** Relit le projet après écriture (le propriétaire a déjà été vérifié). */
async function reload(uid: string, id: string): Promise<Project> {
  const project = await getProject(uid, id);
  if (!project) throw new Error("project vanished");
  return project;
}

/** Enregistre l'accroche, le lien du QR code et le choix « sans logo » ; le logo de la vidéo n'est pas touché. */
export async function saveOverrideTexts(uid: string, id: string, input: SignatureOverrideInput): Promise<Project> {
  await projectRef(id).update(
    "signatureOverride.tagline", input.tagline,
    "signatureOverride.qrUrl", input.qrUrl,
    "signatureOverride.hideLogo", input.hideLogo,
    "updatedAt", FieldValue.serverTimestamp(),
  );
  return reload(uid, id);
}

/**
 * Enregistre le logo de la vidéo (contenu déjà vérifié par l'appelant), puis supprime l'ancien.
 * Choisir un logo annule « sans logo ». Nom horodaté : un lien signé encore ouvert ne montre jamais un mélange.
 */
export async function saveOverrideLogo(uid: string, project: Project, bytes: Buffer, contentType: LogoType): Promise<Project> {
  const previous = project.signatureOverride?.logo ?? null;
  const storagePath = `projects/${project.id}/signature-logo-${Date.now()}.${LOGO_EXTENSIONS[contentType]}`;
  await adminBucket()
    .file(storagePath)
    .save(bytes, { contentType, resumable: false, metadata: { cacheControl: "private, max-age=0" } });
  const logo: SignatureLogo = { storagePath, contentType, sizeBytes: bytes.length, uploadedAt: new Date().toISOString() };
  await projectRef(project.id).update(
    "signatureOverride.logo", logo,
    "signatureOverride.hideLogo", false,
    "updatedAt", FieldValue.serverTimestamp(),
  );
  if (previous) await removeFile(previous.storagePath);
  return reload(uid, project.id);
}

/** Retire le logo de la vidéo : la signature reprend son propre logo. */
export async function deleteOverrideLogo(uid: string, project: Project): Promise<Project> {
  const previous = project.signatureOverride?.logo ?? null;
  await projectRef(project.id).update("signatureOverride.logo", null, "updatedAt", FieldValue.serverTimestamp());
  if (previous) await removeFile(previous.storagePath);
  return reload(uid, project.id);
}

/** Efface tous les réglages de la vidéo, logo compris : la signature choisie s'applique telle quelle. */
export async function clearOverride(uid: string, project: Project): Promise<Project> {
  const previous = project.signatureOverride?.logo ?? null;
  await projectRef(project.id).update("signatureOverride", FieldValue.delete(), "updatedAt", FieldValue.serverTimestamp());
  if (previous) await removeFile(previous.storagePath);
  return reload(uid, project.id);
}

/** Un ancien logo resté dans Storage n'empêche rien : il est effacé avec le projet. */
async function removeFile(path: string) {
  await adminBucket()
    .file(path)
    .delete({ ignoreNotFound: true })
    .catch(() => console.warn("[signature-override] old logo cleanup failed"));
}
