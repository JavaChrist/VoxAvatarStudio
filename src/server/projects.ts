import "server-only";
import { FieldValue, Timestamp, type DocumentSnapshot } from "firebase-admin/firestore";
import type { Project, ProjectInput } from "@/features/projects/schema";
import { toScene, totals, type Script, type ScriptEdit } from "@/features/projects/script";
import type { Voice } from "@/features/projects/voice";
import { adminDb } from "./firebase-admin";
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
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
  };
}

export async function createProject(user: SessionUser, input: ProjectInput): Promise<Project> {
  const ref = projects().doc();
  await ref.set({
    ...input,
    status: "draft",
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

/** Applique une modification manuelle au script existant ; mots et durées sont recalculés ici. */
export async function updateScript(id: string, current: Script, edit: ScriptEdit): Promise<Project> {
  const scenes = edit.scenes.map((scene) => toScene(scene.spokenText, scene.visualIntent));
  const script: Script = { ...current, title: edit.title, scenes, ...totals(scenes), editedAt: new Date().toISOString() };
  return saveScript(id, script);
}
