import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { requireEnv } from "../env";

export const SCRIPT_MODEL = "claude-sonnet-5-5";

let client: Anthropic | null = null;

export function anthropic(): Anthropic {
  client ??= new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") });
  return client;
}
