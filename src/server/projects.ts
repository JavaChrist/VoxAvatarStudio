import "server-only";
import { FieldPath, FieldValue, Timestamp, type DocumentSnapshot } from "firebase-admin/firestore";
import { DEFAULT_APPEARANCE, readAppearance, type Appearance } from "@/features/projects/appearance";
import { VIDEO_FORMATS, type Project, type ProjectInput } from "@/features/projects/schema";
import { toScene, totals, type Script, type ScriptEdit } from "@/features/projects/script";
import { isValidRenderId, type ProjectRender } from "@/features/projects/render";
import { EMPTY_OVERRIDE } from "@/features/projects/signature-override";
import type { AvatarVideo } from "@/features/projects/video";
import type { Voice } from "@/features/projects/voice";
import { adminBucket, adminDb } from "./firebase-admin";
import type { SessionUser } from "./session";

// Accès Firestore aux projets, uniquement côté serveur (firebase-admin). Chaque lecture vérifie le propriétaire.
const projects = () => adminDb().collection("projects");

/** Identifiant Firestore auto-généré (20 caractères) ; on refuse tout le reste avant d'interroger la base. */
const isValidId = (id: string) => /^[A-Za-z0-9]{1,64}$/.test(id);

const toIso = (value: unknown) => (value instanceof Timestamp ? value.toDate().toISOString() : new Date(0).toISOString());

function toProject(snapshot: DocumentSnapshot): Project {
  const data = snapshot.data() ?? {};
  return {
    id: snapshot.id,
    topic: data.topic,
    notes: data.notes ?? "",
    tone: data.tone,
    formats: data.formats ?? [],
    duration: data.duration,
    status: data.status ?? "draft",
    script: data.script ?? null,
    voice: data.voice ?? null,
    avatars: data.avatars ?? {},
    renders: data.renders ?? {},
    // Champs écrits un à un : on complète ceux qui manquent.
    signatureOverride: data.signatureOverride ? { ...EMPTY_OVERRIDE, ...data.signatureOverride } : null,
    inserts: data.inserts ?? {},
    appearance: readAppearance(data.appearance),
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
  };
}

export async function createProject(user: SessionUser, input: ProjectInput): Promise<Project> {
  const ref = projects().doc();
  await ref.set({
    ...input,
    status: "draft",
    appearance: DEFAULT_APPEARANCE,
    ownerUid: user.uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return toProject(await ref.get());
}

/** Projets de l'utilisateur, du plus récent au plus ancien. Tri en mémoire : pas d'index composite à créer. */
export async function listProjects(uid: string): Promise<Project[]> {
  const snapshot = await projects().where("ownerUid", "==", uid).get();
  return snapshot.docs.map(toProject).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Renvoie null si le projet n'existe pas ou n'appartient pas à l'utilisateur. */
export async function getProject(uid: string, id: string): Promise<Project | null> {
  if (!isValidId(id)) return null;
  const snapshot = await projects().doc(id).get();
  if (!snapshot.exists || snapshot.get("ownerUid") !== uid) return null;
  return toProject(snapshot);
}

/** Enregistre le script et passe le projet en « Script prêt ». Le propriétaire doit avoir été vérifié par getProject. */
export async function saveScript(id: string, script: Script): Promise<Project> {
  const ref = projects().doc(id);
  await ref.update({ script, status: "script_ready", updatedAt: FieldValue.serverTimestamp() });
  return toProject(await ref.get());
}

/** Enregistre la voix et passe le projet en « Voix prête ». Le propriétaire doit avoir été vérifié par getProject. */
export async function saveVoice(id: string, voice: Voice): Promise<Project> {
  const ref = projects().doc(id);
  await ref.update({ voice, status: "voice_ready", updatedAt: FieldValue.serverTimestamp() });
  return toProject(await ref.get());
}

/**
 * Enregistre la tenue et la pose de Chris. Les vidéos de Chris déjà faites restent, mais deviennent périmées
 * si elles ont été générées avec une autre apparence. Le propriétaire doit avoir été vérifié par getProject.
 */
export async function saveAppearance(id: string, appearance: Appearance): Promise<Project> {
  const ref = projects().doc(id);
  await ref.update({ appearance, updatedAt: FieldValue.serverTimestamp() });
  return toProject(await ref.get());
}

// FieldPath : le format contient « : », qu'on ne met pas dans un chemin pointé.
const avatarField = (format: string) => new FieldPath("avatars", format);

/**
 * Enregistre un travail qui vient d'être lancé, à la place de la vidéo précédente du format, sans toucher aux autres
 * formats. Le propriétaire doit avoir été vérifié par getProject.
 */
export async function saveAvatar(id: string, video: AvatarVideo): Promise<Project> {
  const ref = projects().doc(id);
  await ref.update(avatarField(video.format), video, "updatedAt", FieldValue.serverTimestamp());
  return toProject(await ref.get());
}

/** Vidéo d'un format, lue sans utilisateur connecté : réservé au webhook fal, une fois sa signature vérifiée. */
export async function getAvatar(id: string, format: string): Promise<AvatarVideo | null> {
  if (!isValidId(id) || !(VIDEO_FORMATS as readonly string[]).includes(format)) return null;
  const snapshot = await projects().doc(id).get();
  return (snapshot.get(avatarField(format)) as AvatarVideo | undefined) ?? null;
}

/**
 * Enregistre l'avancement d'un travail. Le webhook et le suivi de la page peuvent écrire en même temps : la
 * transaction n'écrit que si le format suit toujours le même travail et n'est pas déjà terminé, et ne laisse pas un
 * état plus ancien effacer la vidéo annoncée par fal. Le projet passe en « Vidéo prête » dès qu'une vidéo est
 * terminée. Renvoie la vidéo enregistrée, ou null si rien n'a été écrit.
 */
export async function updateAvatar(id: string, video: AvatarVideo): Promise<AvatarVideo | null> {
  const ref = projects().doc(id);
  const field = avatarField(video.format);
  return adminDb().runTransaction(async (transaction) => {
    const current = (await transaction.get(ref)).get(field) as AvatarVideo | undefined;
    if (!current || current.requestId !== video.requestId || current.state === "done") return null;
    // État calculé sans connaître la vidéo produite.
    const blind = video.state !== "done" && !video.falOutput;
    if (blind && (current.state === "failed" || (video.state === "failed" && current.falOutput))) return null;
    const next = blind && current.falOutput ? { ...video, falOutput: current.falOutput } : video;
    const extra: unknown[] = next.state === "done" ? ["status", "video_ready"] : [];
    transaction.update(ref, field, next, "updatedAt", FieldValue.serverTimestamp(), ...extra);
    return next;
  });
}

/**
 * Enregistre l'état du rendu final d'un format, sans toucher aux autres formats. Le projet passe en « Rendu terminé »
 * dès qu'un rendu est terminé. Le propriétaire du projet doit avoir été vérifié par getProject.
 */
export async function saveRender(id: string, render: ProjectRender): Promise<Project> {
  const ref = projects().doc(id);
  const extra: unknown[] = render.state === "done" ? ["status", "rendered"] : [];
  await ref.update(new FieldPath("renders", render.format), render, "updatedAt", FieldValue.serverTimestamp(), ...extra);
  return toProject(await ref.get());
}

/**
 * Supprime définitivement le projet : d'abord ses fichiers dans Storage (voix, alignement…), puis le document.
 * Renvoie false si le projet n'existe pas ou n'appartient pas à l'utilisateur.
 */
export async function deleteProject(uid: string, id: string): Promise<boolean> {
  if (!isValidId(id)) return false;
  const ref = projects().doc(id);
  const snapshot = await ref.get();
  if (!snapshot.exists || snapshot.get("ownerUid") !== uid) return false;
  // Fichiers d'abord : si la suite échoue, le projet reste visible et la suppression peut être relancée.
  const bucket = adminBucket();
  await bucket.deleteFiles({ prefix: `projects/${id}/` });
  // Fichiers de travail des rendus (render-jobs/{renderId}.json et .result.json) : nommés par rendu, pas par projet.
  const renders = Object.values((snapshot.get("renders") ?? {}) as Record<string, { renderId?: unknown }>);
  for (const { renderId } of renders) {
    if (typeof renderId === "string" && isValidRenderId(renderId)) await bucket.deleteFiles({ prefix: `render-jobs/${renderId}.` });
  }
  await adminDb().recursiveDelete(ref);
  return true;
}

/** Applique une modification manuelle au script existant ; mots et durées sont recalculés ici. */
export async function updateScript(id: string, current: Script, edit: ScriptEdit): Promise<Project> {
  const scenes = edit.scenes.map((scene) => toScene(scene.spokenText, scene.visualIntent));
  const script: Script = { ...current, title: edit.title, scenes, ...totals(scenes), editedAt: new Date().toISOString() };
  return saveScript(id, script);
}
