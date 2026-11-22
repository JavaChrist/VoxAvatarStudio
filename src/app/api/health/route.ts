import { hasEnv, SERVER_ENV_KEYS } from "@/server/env";
import { getSessionUser } from "@/server/session";

export const dynamic = "force-dynamic";

/** Indique quelles variables serveur sont présentes. Ne renvoie jamais leur valeur. */
export async function GET() {
  if (!(await getSessionUser())) return Response.json({ error: "unauthorized" }, { status: 401 });
  const env = Object.fromEntries(SERVER_ENV_KEYS.map((key) => [key, hasEnv(key)]));
  const firebaseWeb = Boolean(process.env.NEXT_PUBLIC_FIREBASE_API_KEY && process.env.NEXT_PUBLIC_FIREBASE_APP_ID);
  return Response.json({ ok: Object.values(env).every(Boolean) && firebaseWeb, env, firebaseWeb, buildId: process.env.NEXT_PUBLIC_BUILD_ID });
}
