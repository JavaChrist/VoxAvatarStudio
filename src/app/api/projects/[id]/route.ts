import { hasActiveAvatar } from "@/features/projects/video";
import { errorCode } from "@/server/firebase-admin";
import { deleteProject, getProject } from "@/server/projects";
import { withScriptLock, withVideoLock, withVoiceLock } from "@/server/script-lock";
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

/** Supprime définitivement le projet et ses fichiers. Refusé pendant une génération de script, de voix ou de vidéo. */
export async function DELETE(_request: Request, { params }: Context) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    // Une vidéo payée est en cours chez fal : on attend qu'elle soit copiée (ou bloquée) avant de tout effacer.
    const project = await getProject(user.uid, id);
    if (project && hasActiveAvatar(project.avatars)) return Response.json({ error: "video_in_progress" }, { status: 409 });
    // Les trois verrous : aucune génération facturée ne peut démarrer pendant la suppression, ni être en cours.
    const result = await withScriptLock(id, () => withVoiceLock(id, () => withVideoLock(id, () => deleteProject(user.uid, id))));
    // undefined : l'un des verrous était déjà pris.
    const deleted = result?.value?.value?.value;
    if (deleted === undefined) return Response.json({ error: "in_progress" }, { status: 409 });
    if (!deleted) return Response.json({ error: "not_found" }, { status: 404 });
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("[projects] delete failed", errorCode(error));
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
