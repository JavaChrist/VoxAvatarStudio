import { isMusicType, MUSIC_MAX_BYTES } from "@/features/music/schema";
import { errorCode } from "@/server/firebase-admin";
import { getSessionUser } from "@/server/session";
import { cleanupStaleUploads, createSignedUpload } from "@/server/uploads";

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * Prépare l'envoi d'une piste : renvoie une URL signée valable 10 min pour un seul PUT direct vers Storage.
 * Corps : { contentType: "audio/mpeg" | "audio/mp4" | "audio/wav", size: nombre d'octets }.
 * Le contenu réel est revérifié par POST /api/music avant toute utilisation.
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { contentType?: unknown; size?: unknown } | null;
  if (!isMusicType(body?.contentType)) return Response.json({ error: "track_invalid" }, { status: 415 });
  const size = body.size;
  if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) return Response.json({ error: "invalid_input" }, { status: 400 });
  if (size > MUSIC_MAX_BYTES) return Response.json({ error: "track_too_large" }, { status: 413 });

  try {
    await cleanupStaleUploads(user.uid);
    return Response.json(await createSignedUpload(user.uid, body.contentType), { headers: NO_STORE });
  } catch (error) {
    console.error("[music] upload url failed", errorCode(error));
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
