import { validateOverrideInput } from "@/features/projects/signature-override";
import { errorCode } from "@/server/firebase-admin";
import { getSessionUser } from "@/server/session";
import { clearOverride, ownedProject, saveOverrideTexts, toOverrideView } from "@/server/signature-override";

// Réglages de la signature de fin propres à ce projet : accroche, lien du QR code, « sans logo ». Gratuit.
type Context = { params: Promise<{ id: string }> };

const NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET(_request: Request, { params }: Context) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const project = await ownedProject(user.uid, id, "get");
  if (project instanceof Response) return project;
  try {
    return Response.json({ override: await toOverrideView(project.signatureOverride) }, { headers: NO_STORE });
  } catch (error) {
    console.error("[signature-override] get failed", errorCode(error));
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}

/**
 * Corps : { tagline: string | null, qrUrl: string | null, hideLogo: boolean }.
 * null : la valeur de la signature choisie ; "" : rien pour cette vidéo. Le logo a sa propre route.
 */
export async function PUT(request: Request, { params }: Context) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const body = await request.json().catch(() => null);
  const result = validateOverrideInput(body);
  if (!result.ok) return Response.json({ error: "invalid_input", fields: result.errors }, { status: 400 });

  const project = await ownedProject(user.uid, id, "update");
  if (project instanceof Response) return project;
  try {
    const saved = await saveOverrideTexts(user.uid, id, result.value);
    return Response.json({ override: await toOverrideView(saved.signatureOverride) }, { headers: NO_STORE });
  } catch (error) {
    console.error("[signature-override] update failed", errorCode(error));
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}

/** Efface tous les réglages de la vidéo, logo compris. */
export async function DELETE(_request: Request, { params }: Context) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const project = await ownedProject(user.uid, id, "clear");
  if (project instanceof Response) return project;
  try {
    const saved = await clearOverride(user.uid, project);
    return Response.json({ override: await toOverrideView(saved.signatureOverride) }, { headers: NO_STORE });
  } catch (error) {
    console.error("[signature-override] clear failed", errorCode(error));
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
