import { validateSignatureInput } from "@/features/signatures/schema";
import { errorCode } from "@/server/firebase-admin";
import { getSessionUser } from "@/server/session";
import { deleteSignature, getSignature, toView, updateSignature } from "@/server/signatures";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    const signature = await getSignature(user.uid, id);
    // 404 aussi pour la signature d'un autre compte : on ne révèle pas qu'elle existe.
    if (!signature) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ signature: await toView(signature) });
  } catch (error) {
    console.error("[signatures] get failed", errorCode(error));
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}

/** Remplace tous les textes de la signature (formulaire complet). Le logo a sa propre route. */
export async function PUT(request: Request, { params }: Context) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const body = await request.json().catch(() => null);
  const result = validateSignatureInput(body);
  if (!result.ok) return Response.json({ error: "invalid_input", fields: result.errors }, { status: 400 });

  try {
    const signature = await updateSignature(user.uid, id, result.value);
    if (!signature) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ signature: await toView(signature) });
  } catch (error) {
    console.error("[signatures] update failed", errorCode(error));
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}

/** Supprime définitivement la signature et son logo. Les rendus déjà lancés en gardent une copie. */
export async function DELETE(_request: Request, { params }: Context) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    if (!(await deleteSignature(user.uid, id))) return Response.json({ error: "not_found" }, { status: 404 });
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("[signatures] delete failed", errorCode(error));
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
