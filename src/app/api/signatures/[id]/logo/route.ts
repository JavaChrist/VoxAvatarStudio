import { detectLogoType, LOGO_MAX_BYTES } from "@/features/signatures/schema";
import { errorCode } from "@/server/firebase-admin";
import { getSessionUser } from "@/server/session";
import { deleteLogo, saveLogo, toView } from "@/server/signatures";

type Context = { params: Promise<{ id: string }> };

/**
 * Envoie le logo : le corps de la requête est l'image brute (PNG, JPEG ou WebP, 2 Mo au plus).
 * Le type est déduit des premiers octets ; l'en-tête Content-Type du navigateur est ignoré.
 */
export async function PUT(request: Request, { params }: Context) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  // Refus avant lecture quand la taille annoncée dépasse déjà la limite.
  const announced = Number(request.headers.get("content-length") ?? "0");
  if (announced > LOGO_MAX_BYTES) return Response.json({ error: "logo_too_large" }, { status: 413 });

  const bytes = new Uint8Array(await request.arrayBuffer().catch(() => new ArrayBuffer(0)));
  // L'en-tête peut mentir ou manquer : on revérifie la taille réelle.
  if (bytes.length > LOGO_MAX_BYTES) return Response.json({ error: "logo_too_large" }, { status: 413 });
  const contentType = bytes.length > 0 ? detectLogoType(bytes) : null;
  if (!contentType) return Response.json({ error: "logo_invalid" }, { status: 415 });

  try {
    const signature = await saveLogo(user.uid, id, Buffer.from(bytes), contentType);
    if (!signature) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ signature: await toView(signature) });
  } catch (error) {
    console.error("[signatures] logo upload failed", errorCode(error));
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    const signature = await deleteLogo(user.uid, id);
    if (!signature) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ signature: await toView(signature) });
  } catch (error) {
    console.error("[signatures] logo delete failed", errorCode(error));
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
