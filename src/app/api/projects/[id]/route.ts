import { errorCode } from "@/server/firebase-admin";
import { deleteProject, getProject } from "@/server/projects";
import { withScriptLock, withVoiceLock } from "@/server/script-lock";
import { getSessionUser } from "@/server/session";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    const project = await getProject(user.uid, id);
    // 404 aussi pour le projet d'un autre compte : on ne révèle pas qu'il existe.
    if (!project) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ project });
  } catch (error) {
    console.error("[projects] get failed", errorCode(error));
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}

/** Supprime définitivement le projet et ses fichiers. Refusé pendant une génération de script ou de voix. */
export async function DELETE(_request: Request, { params }: Context) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    // Les deux verrous : aucune génération facturée ne peut démarrer pendant la suppression, ni être en cours.
    const result = await withScriptLock(id, () => withVoiceLock(id, () => deleteProject(user.uid, id)));
    // undefined : l'un des deux verrous était déjà pris.
    const deleted = result?.value?.value;
    if (deleted === undefined) return Response.json({ error: "in_progress" }, { status: 409 });
    if (!deleted) return Response.json({ error: "not_found" }, { status: 404 });
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("[projects] delete failed", errorCode(error));
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
