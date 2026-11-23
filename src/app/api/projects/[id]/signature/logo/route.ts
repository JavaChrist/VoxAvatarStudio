import { detectLogoType, LOGO_MAX_BYTES } from "@/features/signatures/schema";
import { errorCode } from "@/server/firebase-admin";
import { getSessionUser } from "@/server/session";
import { deleteOverrideLogo, ownedProject, saveOverrideLogo, toOverrideView } from "@/server/signature-override";

// Logo de la signature propre à ce projet. Mêmes règles que le logo d'une signature. Gratuit.
type Context = { params: Promise<{ id: string }> };

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * Envoie le logo de la vidéo : le corps est l'image brute (PNG, JPEG ou WebP, 2 Mo au plus).
 * Le type est déduit des premiers octets ; l'en-tête Content-Type du navigateur est ignoré.
 */
export async function PUT(request: Request, { params }: Context) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  // Refus avant lecture quand la taille annoncée dépasse déjà la limite.
  const announced = Number(request.headers.get("content-length") ?? "0");
  if (announced > LOGO_MAX_BYTES) return Response.json({ error: "logo_too_large" }, { status: 413 });

  const project = await ownedProject(user.uid, id, "logo upload");
  if (project instanceof Response) return project;

  const bytes = new Uint8Array(await request.arrayBuffer().catch(() => new ArrayBuffer(0)));
  // L'en-tête peut mentir ou manquer : on revérifie la taille réelle.
  if (bytes.length > LOGO_MAX_BYTES) return Response.json({ error: "logo_too_large" }, { status: 413 });
  const contentType = bytes.length > 0 ? detectLogoType(bytes) : null;
  if (!contentType) return Response.json({ error: "logo_invalid" }, { status: 415 });

  try {
    const saved = await saveOverrideLogo(user.uid, project, Buffer.from(bytes), contentType);
    return Response.json({ override: await toOverrideView(saved.signatureOverride) }, { headers: NO_STORE });
  } catch (error) {
    console.error("[signature-override] logo upload failed", errorCode(error));
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}

/** Retire le logo de la vidéo : la signature reprend son propre logo. */
export async function DELETE(_request: Request, { params }: Context) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const project = await ownedProject(user.uid, id, "logo delete");
  if (project instanceof Response) return project;
  try {
    const saved = await deleteOverrideLogo(user.uid, project);
    return Response.json({ override: await toOverrideView(saved.signatureOverride) }, { headers: NO_STORE });
  } catch (error) {
    console.error("[signature-override] logo delete failed", errorCode(error));
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
