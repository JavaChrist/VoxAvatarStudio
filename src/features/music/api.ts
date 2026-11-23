// Appels du navigateur vers l'API des musiques. Aucun secret : la session passe par le cookie httpOnly,
// et l'envoi du fichier utilise une URL signée temporaire fournie par le serveur.
import { detectMusicType, MUSIC_MAX_BYTES, MUSIC_SNIFF_BYTES, type MusicType, type MusicView } from "./schema";

export type ApiResult = { ok: true; music: MusicView } | { ok: false; error: string; field?: string };

/** Messages affichés pour chaque code d'erreur. */
const MUSIC_ERRORS: Record<string, string> = {
  not_found: "Cette musique n'existe plus. Recharge la page.",
  track_too_large: "Le fichier dépasse 20 Mo. Choisis une piste plus légère (un MP3, par exemple).",
  track_invalid: "La musique doit être un fichier MP3, M4A ou WAV.",
  upload_missing: "Le fichier n'est pas arrivé dans le stockage. Réessaie l'import.",
  upload_failed:
    "L'envoi du fichier vers le stockage a échoué. Vérifie ta connexion ; si le problème continue, la configuration CORS du bucket est peut-être manquante.",
  network: "La connexion au serveur a échoué. Vérifie ta connexion et réessaie.",
};

const FALLBACK_ERROR = "Le serveur n'a pas pu enregistrer la musique. Réessaie dans un instant.";

export const musicErrorMessage = (code: string) => MUSIC_ERRORS[code] ?? FALLBACK_ERROR;

async function readJson(url: string, init: RequestInit): Promise<{ status: number; data: Record<string, unknown> | null } | null> {
  try {
    const response = await fetch(url, init);
    return { status: response.status, data: await response.json().catch(() => null) };
  } catch {
    return null;
  }
}

function toResult(reply: Awaited<ReturnType<typeof readJson>>, ok: number[]): ApiResult {
  if (!reply) return { ok: false, error: "network" };
  // Session expirée : l'appelant renvoie vers la connexion.
  if (reply.status === 401) return { ok: false, error: "unauthorized" };
  const data = reply.data;
  if (ok.includes(reply.status) && data?.music) return { ok: true, music: data.music as MusicView };
  const fields = data?.fields as { name?: string } | undefined;
  return { ok: false, error: typeof data?.error === "string" ? data.error : "server_error", field: fields?.name };
}

/** Format réel du fichier, lu dans ses premiers octets (même contrôle que le serveur). */
async function sniff(file: File): Promise<MusicType | null> {
  const head = new Uint8Array(await file.slice(0, MUSIC_SNIFF_BYTES).arrayBuffer());
  return detectMusicType(head);
}

/** Premier tri avant envoi, pour un message immédiat. Renvoie le type reconnu ou un code d'erreur. */
export async function checkMusicFile(file: File): Promise<{ ok: true; type: MusicType } | { ok: false; error: string }> {
  if (file.size > MUSIC_MAX_BYTES) return { ok: false, error: "track_too_large" };
  const type = await sniff(file).catch(() => null);
  return type ? { ok: true, type } : { ok: false, error: "track_invalid" };
}

/**
 * Import en trois temps : URL signée demandée au serveur, envoi direct du fichier vers Storage,
 * puis finalisation (le serveur revérifie la taille et le format réels).
 */
export async function importMusic(name: string, file: File, type: MusicType): Promise<ApiResult> {
  const prepared = await readJson("/api/music/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contentType: type, size: file.size }),
  });
  if (!prepared) return { ok: false, error: "network" };
  if (prepared.status === 401) return { ok: false, error: "unauthorized" };
  const uploadId = prepared.data?.uploadId;
  const url = prepared.data?.url;
  if (prepared.status !== 200 || typeof uploadId !== "string" || typeof url !== "string") {
    return { ok: false, error: typeof prepared.data?.error === "string" ? prepared.data.error : "server_error" };
  }

  // Le Content-Type doit être exactement celui signé, sinon Storage refuse l'envoi.
  try {
    const put = await fetch(url, { method: "PUT", headers: { "Content-Type": type }, body: file });
    if (!put.ok) return { ok: false, error: "upload_failed" };
  } catch {
    return { ok: false, error: "upload_failed" };
  }

  return toResult(
    await readJson("/api/music", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uploadId, name }) }),
    [201],
  );
}

export const renameMusic = async (id: string, name: string) =>
  toResult(
    await readJson(`/api/music/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }),
    [200],
  );

/** Renvoie "ok", "not_found", "unauthorized" ou un code d'erreur. */
export async function deleteMusic(id: string): Promise<string> {
  try {
    const response = await fetch(`/api/music/${id}`, { method: "DELETE" });
    if (response.status === 401) return "unauthorized";
    if (response.ok) return "ok";
    if (response.status === 404) return "not_found";
    return "server_error";
  } catch {
    return "network";
  }
}
