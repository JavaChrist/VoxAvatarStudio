import { BACKGROUND_MAX_BYTES, detectBackgroundType, validateBackgroundName } from "@/features/backgrounds/schema";
import { createBackground, listBackgrounds, toBackgroundView } from "@/server/backgrounds";
import { errorCode } from "@/server/firebase-admin";
import { getSessionUser } from "@/server/session";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    const backgrounds = await Promise.all((await listBackgrounds(user.uid)).map(toBackgroundView));
    return Response.json({ backgrounds });
  } catch (error) {
    console.error("[backgrounds] list failed", errorCode(error));
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}

/** Nom du fond, encodé (encodeURIComponent) : un en-tête HTTP n'accepte pas tous les caractères. */
const NAME_HEADER = "x-background-name";

/**
 * Importe un fond : le corps de la requête est l'image brute (PNG, JPEG ou WebP, 4 Mo au plus),
 * le nom passe dans l'en-tête x-background-name. Le type est déduit des premiers octets.
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  let rawName = "";
  try {
    rawName = decodeURIComponent(request.headers.get(NAME_HEADER) ?? "");
  } catch {
    // Encodage invalide : traité comme un nom vide.
  }
  const name = validateBackgroundName(rawName);
  if (!name.ok) return Response.json({ error: "invalid_input", fields: { name: name.error } }, { status: 400 });

  // Refus avant lecture quand la taille annoncée dépasse déjà la limite.
  const announced = Number(request.headers.get("content-length") ?? "0");
  if (announced > BACKGROUND_MAX_BYTES) return Response.json({ error: "image_too_large" }, { status: 413 });
  const bytes = new Uint8Array(await request.arrayBuffer().catch(() => new ArrayBuffer(0)));
  if (bytes.length > BACKGROUND_MAX_BYTES) return Response.json({ error: "image_too_large" }, { status: 413 });
  const contentType = bytes.length > 0 ? detectBackgroundType(bytes) : null;
  if (!contentType) return Response.json({ error: "image_invalid" }, { status: 415 });

  try {
    const background = await toBackgroundView(await createBackground(user, name.value, Buffer.from(bytes), contentType));
    return Response.json({ background }, { status: 201 });
  } catch (error) {
    console.error("[backgrounds] create failed", errorCode(error));
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
