export const CURRENT_BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID;

/** Identifiant de la version en ligne, ou `null` si elle est injoignable. */
export async function fetchLatestBuildId(): Promise<string | null> {
  try {
    const response = await fetch("/version.json", { cache: "no-store" });
    if (!response.ok) return null;
    const { buildId } = (await response.json()) as { buildId?: unknown };
    return typeof buildId === "string" ? buildId : null;
  } catch {
    return null;
  }
}
