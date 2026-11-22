import "server-only";

/**
 * Projets dont le script est en cours de génération ou d'ajustement sur cette instance.
 * Évite deux appels facturés après un double clic et bloque l'enregistrement manuel pendant ce temps.
 */
const inFlight = new Set<string>();

export const isScriptBusy = (id: string) => inFlight.has(id);

/** Exécute `task` en réservant le projet ; renvoie null s'il est déjà réservé. */
export async function withScriptLock<T>(id: string, task: () => Promise<T>): Promise<{ value: T } | null> {
  if (inFlight.has(id)) return null;
  inFlight.add(id);
  try {
    return { value: await task() };
  } finally {
    inFlight.delete(id);
  }
}
