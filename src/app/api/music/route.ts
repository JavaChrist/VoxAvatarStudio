import { validateMusicName } from "@/features/music/schema";
import { errorCode } from "@/server/firebase-admin";
import { createMusicFromUpload, listMusic, MUSIC_UPLOAD_ERROR_STATUS, MusicUploadError, toMusicView } from "@/server/music";
import { getSessionUser } from "@/server/session";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    const music = await Promise.all((await listMusic(user.uid)).map(toMusicView));
    return Response.json({ music });
  } catch (error) {
    console.error("[music] list failed", errorCode(error));
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}

/**
 * Finalise l'import d'une piste déjà envoyée dans Storage par URL signée.
 * Corps : { uploadId, name }. Le serveur vérifie la taille et le format réels, puis crée la musique.
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { uploadId?: unknown; name?: unknown } | null;
  const name = validateMusicName(body?.name);
  if (!name.ok) return Response.json({ error: "invalid_input", fields: { name: name.error } }, { status: 400 });

  try {
    const music = await toMusicView(await createMusicFromUpload(user, body?.uploadId, name.value));
    return Response.json({ music }, { status: 201 });
  } catch (error) {
    if (error instanceof MusicUploadError) return Response.json({ error: error.code }, { status: MUSIC_UPLOAD_ERROR_STATUS[error.code] });
    console.error("[music] create failed", errorCode(error));
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
