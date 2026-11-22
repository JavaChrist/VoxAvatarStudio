import { errorCode } from "@/server/firebase-admin";
import { getProject } from "@/server/projects";
import { getSessionUser } from "@/server/session";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
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
