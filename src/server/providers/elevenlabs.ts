import "server-only";
import { requireEnv } from "../env";

const API = "https://api.elevenlabs.io/v1";

/** Appel authentifié à l'API ElevenLabs. La clé reste côté serveur. */
export function elevenLabsFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("xi-api-key", requireEnv("ELEVENLABS_API_KEY"));
  return fetch(`${API}${path}`, { ...init, headers });
}

export const voiceId = () => requireEnv("ELEVENLABS_VOICE_ID");
