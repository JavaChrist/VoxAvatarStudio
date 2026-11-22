import { clearSession, createSession } from "@/server/session";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { idToken?: unknown } | null;
  if (typeof body?.idToken !== "string") return Response.json({ error: "bad_request" }, { status: 400 });
  try {
    const user = await createSession(body.idToken);
    if (!user) return Response.json({ error: "forbidden" }, { status: 403 });
    return Response.json({ email: user.email });
  } catch {
    return Response.json({ error: "invalid_token" }, { status: 401 });
  }
}

export async function DELETE() {
  await clearSession();
  return Response.json({ ok: true });
}
