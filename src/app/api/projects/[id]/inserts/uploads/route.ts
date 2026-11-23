import { INSERT_MAX_BYTES, isInsertType } from "@/features/projects/inserts";
import { errorCode } from "@/server/firebase-admin";
import { getProject } from "@/server/projects";
import { getSessionUser } from "@/server/session";
import { cleanupStaleUploads, createSignedUpload } from "@/server/uploads";

type Context = { params: Promise<{ id: string }> };

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * Prépare l'envoi d'une image insérée : renvoie une URL signée valable 10 min pour un seul PUT direct vers Storage.
 * Corps : { contentType: "image/png" | "image/jpeg" | "image/webp", size: nombre d'octets }.
 * Le contenu réel est revérifié par PUT /api/projects/{id}/inserts/{scene} avant toute utilisation. Gratuit.
 */
export async function POST(request: Request, { params }: Context) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const body = (await request.json().catch(() => null)) as { contentType?: unknown; size?: unknown } | null;
  if (!isInsertType(body?.contentType)) return Response.json({ error: "image_invalid" }, { status: 415 });
  const size = body.size;
  if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) return Response.json({ error: "invalid_input" }, { status: 400 });
  if (size > INSERT_MAX_BYTES) return Response.json({ error: "image_too_large" }, { status: 413 });

  try {
    // 404 aussi pour le projet d'un autre compte : on ne révèle pas qu'il existe.
    if (!(await getProject(user.uid, id))) return Response.json({ error: "not_found" }, { status: 404 });
    await cleanupStaleUploads(user.uid);
    return Response.json(await createSignedUpload(user.uid, body.contentType), { headers: NO_STORE });
  } catch (error) {
    console.error("[inserts] upload url failed", errorCode(error));
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
