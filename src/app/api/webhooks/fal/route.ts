import { after } from "next/server";
import { isAvatarPending, type AvatarVideo } from "@/features/projects/video";
import { isFromFal } from "@/server/fal-webhook";
import { errorCode } from "@/server/firebase-admin";
import { getAvatar, updateAvatar } from "@/server/projects";
import { applyFalCall, refreshAvatar, type FalCall } from "@/server/video";

// Appelée par fal quand une vidéo est terminée. Publique (hors proxy, sans session) : seuls les appels signés par fal
// sont acceptés, et seulement pour le travail que le projet attend. fal répète l'appel tant que la réponse n'est pas
// un succès, et n'attend que 15 s la première fois : on enregistre, on répond, puis on copie la vidéo.

// La copie d'une vidéo de 90 s (environ 90 Mo) de fal vers Storage continue après la réponse.
export const maxDuration = 300;

const reply = (status: number, body: Record<string, unknown>) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Copie la vidéo dans Storage. En cas d'échec, le suivi de la page réessaiera. */
async function collect(projectId: string, video: AvatarVideo) {
  try {
    const updated = await refreshAvatar(projectId, video);
    if (updated) await updateAvatar(projectId, updated);
  } catch (error) {
    console.error("[fal-webhook] collect failed", errorCode(error));
  }
}

export async function POST(request: Request) {
  const body = Buffer.from(await request.arrayBuffer());
  let call: FalCall;
  try {
    if (!(await isFromFal(request.headers, body))) return reply(401, { error: "signature_invalid" });
    call = JSON.parse(body.toString("utf8")) as FalCall;
  } catch (error) {
    console.error("[fal-webhook] check failed", error instanceof Error ? error.message : "inconnu");
    return reply(503, { error: "unavailable" });
  }

  // Les paramètres d'adresse ne sont pas signés : ils servent à trouver le projet, le numéro du travail fait foi.
  const search = new URL(request.url).searchParams;
  const projectId = search.get("project") ?? "";
  try {
    const video = await getAvatar(projectId, search.get("format") ?? "");
    const next = video && applyFalCall(video, call);
    if (!next) return reply(200, { ignored: true });
    const saved = next === video ? video : await updateAvatar(projectId, next);
    console.info("[fal-webhook] received", { requestId: next.requestId, status: call.status, saved: saved !== null });
    if (saved && isAvatarPending(saved)) after(() => collect(projectId, saved));
    return reply(200, { received: true });
  } catch (error) {
    console.error("[fal-webhook] save failed", errorCode(error));
    return reply(500, { error: "server_error" });
  }
}
