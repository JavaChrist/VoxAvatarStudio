import { validateMusicName } from "@/features/music/schema";
import { errorCode } from "@/server/firebase-admin";
import { deleteMusic, renameMusic, toMusicView } from "@/server/music";
import { getSessionUser } from "@/server/session";

type Context = { params: Promise<{ id: string }> };

/** Renomme la musique. Corps : { name }. */
export async function PATCH(request: Request, { params }: Context) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
  const name = validateMusicName(body?.name);
  if (!name.ok) return Response.json({ error: "invalid_input", fields: { name: name.error } }, { status: 400 });

  try {
    const music = await renameMusic(user.uid, id, name.value);
    // 404 aussi pour la musique d'un autre compte : on ne révèle pas qu'elle existe.
    if (!music) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ music: await toMusicView(music) });
  } catch (error) {
    console.error("[music] rename failed", errorCode(error));
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}

/** Supprime définitivement la musique et sa piste. Les rendus déjà lancés en gardent une copie. */
export async function DELETE(_request: Request, { params }: Context) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    if (!(await deleteMusic(user.uid, id))) return Response.json({ error: "not_found" }, { status: 404 });
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("[music] delete failed", errorCode(error));
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
