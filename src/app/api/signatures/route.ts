import { validateSignatureInput } from "@/features/signatures/schema";
import { errorCode } from "@/server/firebase-admin";
import { getSessionUser } from "@/server/session";
import { createSignature, listSignatures, toView } from "@/server/signatures";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    const signatures = await Promise.all((await listSignatures(user.uid)).map(toView));
    return Response.json({ signatures });
  } catch (error) {
    console.error("[signatures] list failed", errorCode(error));
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const result = validateSignatureInput(body);
  if (!result.ok) return Response.json({ error: "invalid_input", fields: result.errors }, { status: 400 });

  try {
    const signature = await toView(await createSignature(user, result.value));
    return Response.json({ signature }, { status: 201 });
  } catch (error) {
    console.error("[signatures] create failed", errorCode(error));
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
