import "server-only";

/** Variables secrètes lues côté serveur uniquement. Aucune ne porte le préfixe NEXT_PUBLIC_. */
export const SERVER_ENV_KEYS = [
  "FAL_KEY",
  "ELEVENLABS_API_KEY",
  "ELEVENLABS_VOICE_ID",
  "ANTHROPIC_API_KEY",
  "FIREBASE_ADMIN_PROJECT_ID",
  "FIREBASE_ADMIN_CLIENT_EMAIL",
  "FIREBASE_ADMIN_PRIVATE_KEY",
  "ALLOWED_EMAILS",
] as const;

export type ServerEnvKey = (typeof SERVER_ENV_KEYS)[number];

export function hasEnv(key: ServerEnvKey): boolean {
  return Boolean(process.env[key]?.trim());
}

export function requireEnv(key: ServerEnvKey): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`Variable serveur manquante : ${key}`);
  return value;
}

/** E-mails autorisés à se connecter, séparés par des virgules. */
export function allowedEmails(): Set<string> {
  return new Set(
    (process.env.ALLOWED_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}
