import { parseSceneIndex } from "@/features/projects/inserts";
import type { Project } from "@/features/projects/schema";
import { errorCode } from "@/server/firebase-admin";
import { deleteInsert, INSERT_ERROR_STATUS, InsertError, saveInsertFromUpload, toInsertViews } from "@/server/inserts";
import { getProject } from "@/server/projects";
import { withRenderLock } from "@/server/script-lock";
import { getSessionUser } from "@/server/session";

// Image insérée d'une scène du script : pose, remplacement et retrait. Gratuit.
type Context = { params: Promise<{ id: string; scene: string }> };

const NO_STORE = { "Cache-Control": "private, no-store" };

/** Projet de l'utilisateur et numéro de scène, ou la réponse d'erreur à renvoyer. */
async function target(uid: string, { params }: Context, scope: string): Promise<{ project: Project; scene: number } | Response> {
  const { id, scene: rawScene } = await params;
  const scene = parseSceneIndex(rawScene);
  if (scene === null) return Response.json({ error: "scene_invalid" }, { status: 400 });
  try {
    const project = await getProject(uid, id);
    // 404 aussi pour le projet d'un autre compte : on ne révèle pas qu'il existe.
    return project ? { project, scene } : Response.json({ error: "not_found" }, { status: 404 });
  } catch (error) {
    console.error(`[inserts] ${scope} project read failed`, errorCode(error));
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}

/** Réponse commune : la liste à jour des images du projet. */
const insertsResponse = async (project: Project) => Response.json({ inserts: await toInsertViews(project.inserts) }, { headers: NO_STORE });

/**
 * Pose (ou remplace) l'image de la scène à partir d'un fichier déjà envoyé dans Storage par URL signée.
 * Corps : { uploadId }. Le serveur vérifie la taille et le format réels. Refusé pendant le lancement d'un rendu,
 * qui copie les images à ce moment-là.
 */
export async function PUT(request: Request, context: Context) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const found = await target(user.uid, context, "save");
  if (found instanceof Response) return found;
  const body = (await request.json().catch(() => null)) as { uploadId?: unknown } | null;

  try {
    const locked = await withRenderLock(found.project.id, () => saveInsertFromUpload(user.uid, found.project, found.scene, body?.uploadId));
    if (!locked) return Response.json({ error: "render_starting" }, { status: 409 });
    return await insertsResponse(locked.value);
  } catch (error) {
    if (error instanceof InsertError) return Response.json({ error: error.code }, { status: INSERT_ERROR_STATUS[error.code] });
    console.error("[inserts] save failed", errorCode(error));
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}

/** Retire l'image de la scène. Les vidéos déjà montées ne changent pas. */
export async function DELETE(_request: Request, context: Context) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const found = await target(user.uid, context, "delete");
  if (found instanceof Response) return found;

  try {
    const locked = await withRenderLock(found.project.id, () => deleteInsert(user.uid, found.project, found.scene));
    if (!locked) return Response.json({ error: "render_starting" }, { status: 409 });
    if (!locked.value) return Response.json({ error: "not_found" }, { status: 404 });
    return await insertsResponse(locked.value);
  } catch (error) {
    console.error("[inserts] delete failed", errorCode(error));
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
