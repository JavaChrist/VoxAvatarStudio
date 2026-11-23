import { validateAppearanceInput } from "@/features/projects/appearance";
import { hasActiveAvatar } from "@/features/projects/video";
import { errorCode } from "@/server/firebase-admin";
import { getProject, saveAppearance } from "@/server/projects";
import { isVideoBusy } from "@/server/script-lock";
import { getSessionUser } from "@/server/session";

// Tenue et pose de Chris dans ce projet. Gratuit : les vidéos de Chris faites avec une autre apparence deviennent périmées.
type Context = { params: Promise<{ id: string }> };

const NO_STORE = { "Cache-Control": "private, no-store" };

/** Corps : { outfit: string, pose: "standing" | "seated" }. La tenue doit exister dans cette pose. */
export async function PUT(request: Request, { params }: Context) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const body = await request.json().catch(() => null);
  const result = validateAppearanceInput(body);
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 });

  let project;
  try {
    project = await getProject(user.uid, id);
  } catch (error) {
    console.error("[appearance] project read failed", errorCode(error));
    return Response.json({ error: "server_error" }, { status: 500 });
  }
  if (!project) return Response.json({ error: "not_found" }, { status: 404 });
  // Une vidéo en cours garde l'apparence de son lancement : on ne change pas l'apparence sous elle.
  if (isVideoBusy(id) || hasActiveAvatar(project.avatars)) return Response.json({ error: "video_in_progress" }, { status: 409 });

  try {
    return Response.json({ project: await saveAppearance(id, result.value) }, { headers: NO_STORE });
  } catch (error) {
    console.error("[appearance] update failed", errorCode(error));
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
