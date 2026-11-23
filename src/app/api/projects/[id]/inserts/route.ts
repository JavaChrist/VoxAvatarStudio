import { errorCode } from "@/server/firebase-admin";
import { toInsertViews } from "@/server/inserts";
import { getProject } from "@/server/projects";
import { getSessionUser } from "@/server/session";

type Context = { params: Promise<{ id: string }> };

/** Images insérées du projet, avec de nouveaux liens d'aperçu (15 min). Sert à renouveler un lien expiré. Gratuit. */
export async function GET(_request: Request, { params }: Context) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    const project = await getProject(user.uid, id);
    // 404 aussi pour le projet d'un autre compte : on ne révèle pas qu'il existe.
    if (!project) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ inserts: await toInsertViews(project.inserts) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[inserts] list failed", errorCode(error));
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
