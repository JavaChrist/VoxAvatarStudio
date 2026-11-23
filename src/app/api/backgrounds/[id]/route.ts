import { validateBackgroundName } from "@/features/backgrounds/schema";
import { deleteBackground, renameBackground, toBackgroundView } from "@/server/backgrounds";
import { errorCode } from "@/server/firebase-admin";
import { getSessionUser } from "@/server/session";

type Context = { params: Promise<{ id: string }> };

/** Renomme le fond. Corps : { name }. */
export async function PATCH(request: Request, { params }: Context) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
  const name = validateBackgroundName(body?.name);
  if (!name.ok) return Response.json({ error: "invalid_input", fields: { name: name.error } }, { status: 400 });

  try {
    const background = await renameBackground(user.uid, id, name.value);
    // 404 aussi pour le fond d'un autre compte : on ne révèle pas qu'il existe.
    if (!background) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ background: await toBackgroundView(background) });
  } catch (error) {
    console.error("[backgrounds] rename failed", errorCode(error));
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}

/** Supprime définitivement le fond et son image. Les rendus déjà lancés en gardent une copie. */
export async function DELETE(_request: Request, { params }: Context) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    if (!(await deleteBackground(user.uid, id))) return Response.json({ error: "not_found" }, { status: 404 });
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("[backgrounds] delete failed", errorCode(error));
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
