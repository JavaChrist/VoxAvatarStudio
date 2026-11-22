import { adminAuth, errorCode } from "@/server/firebase-admin";
import { clearSession, createSession } from "@/server/session";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { idToken?: unknown } | null;
  if (typeof body?.idToken !== "string") return Response.json({ error: "bad_request" }, { status: 400 });

  // 1. Configuration serveur : clé Firebase Admin absente ou illisible.
  try {
    adminAuth();
  } catch (error) {
    console.error("[session] Firebase Admin non configuré :", errorCode(error));
    return Response.json({ error: "server_config" }, { status: 500 });
  }

  // 2. Jeton de connexion et liste blanche.
  try {
    const user = await createSession(body.idToken);
    if (!user) {
      console.warn("[session] accès refusé (e-mail hors ALLOWED_EMAILS ou connexion trop ancienne)");
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
    return Response.json({ email: user.email });
  } catch (error) {
    console.error("[session] jeton refusé :", errorCode(error));
    return Response.json({ error: "invalid_token" }, { status: 401 });
  }
}

export async function DELETE() {
  await clearSession();
  return Response.json({ ok: true });
}
