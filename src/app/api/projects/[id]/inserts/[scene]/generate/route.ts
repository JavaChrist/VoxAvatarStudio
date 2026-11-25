import { cleanImageDescription, parseSceneIndex } from "@/features/projects/inserts";
import { errorCode } from "@/server/firebase-admin";
import { IMAGE_GENERATION_ERROR_STATUS, ImageGenerationError } from "@/server/image-generation";
import { generateInsert, INSERT_ERROR_STATUS, InsertError, toInsertViews } from "@/server/inserts";
import { getProject } from "@/server/projects";
import { withRenderLock } from "@/server/script-lock";
import { getSessionUser } from "@/server/session";

// Génération de l'image d'une scène chez fal : un appel facturé par demande.
export const maxDuration = 120;

type Context = { params: Promise<{ id: string; scene: string }> };

/**
 * Génère l'image de la scène à partir de sa description, et remplace l'éventuelle précédente. Corps : { description }.
 * Le verrou du montage est tenu pendant toute la génération : pas de double facturation, ni de rendu ou de suppression
 * du projet pendant qu'une image arrive.
 */
export async function POST(request: Request, { params }: Context) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id, scene: rawScene } = await params;
  const scene = parseSceneIndex(rawScene);
  if (scene === null) return Response.json({ error: "scene_invalid" }, { status: 400 });
  const body = (await request.json().catch(() => null)) as { description?: unknown } | null;
  const description = cleanImageDescription(body?.description);
  if (!description) return Response.json({ error: "description_invalid" }, { status: 422 });

  try {
    const project = await getProject(user.uid, id);
    // 404 aussi pour le projet d'un autre compte : on ne révèle pas qu'il existe.
    if (!project) return Response.json({ error: "not_found" }, { status: 404 });
    const locked = await withRenderLock(project.id, () => generateInsert(user.uid, project, scene, description));
    if (!locked) return Response.json({ error: "image_busy" }, { status: 409 });
    return Response.json({ inserts: await toInsertViews(locked.value.inserts) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ImageGenerationError) {
      console.error("[inserts] generation failed", error.message);
      return Response.json({ error: error.code }, { status: IMAGE_GENERATION_ERROR_STATUS[error.code] });
    }
    if (error instanceof InsertError) return Response.json({ error: error.code }, { status: INSERT_ERROR_STATUS[error.code] });
    console.error("[inserts] generation failed", errorCode(error));
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
