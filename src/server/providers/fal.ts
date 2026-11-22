import "server-only";
import { fal } from "@fal-ai/client";
import { requireEnv } from "../env";

export const AVATAR_ENDPOINT = "fal-ai/kling-video/ai-avatar/v2/pro";

let configured = false;

export function falClient(): typeof fal {
  if (!configured) {
    fal.config({ credentials: requireEnv("FAL_KEY") });
    configured = true;
  }
  return fal;
}
