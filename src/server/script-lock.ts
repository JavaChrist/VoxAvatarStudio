import "server-only";

/**
 * Verrou en mémoire par projet, sur cette instance : évite deux appels facturés après un double clic.
 * `run` exécute la tâche en réservant le projet et renvoie null s'il est déjà réservé.
 */
function createProjectLock() {
  const inFlight = new Set<string>();
  return {
    isBusy: (id: string) => inFlight.has(id),
    async run<T>(id: string, task: () => Promise<T>): Promise<{ value: T } | null> {
      if (inFlight.has(id)) return null;
      inFlight.add(id);
      try {
        return { value: await task() };
      } finally {
        inFlight.delete(id);
      }
    },
  };
}

/** Script en cours de génération ou d'ajustement ; bloque aussi l'enregistrement manuel pendant ce temps. */
const scriptLock = createProjectLock();
export const isScriptBusy = scriptLock.isBusy;
export const withScriptLock = scriptLock.run;

/** Voix en cours de génération. */
const voiceLock = createProjectLock();
export const isVoiceBusy = voiceLock.isBusy;
export const withVoiceLock = voiceLock.run;

/** Vidéo en cours de lancement ou de récupération chez fal : un seul appel à la fois par projet sur cette instance. */
const videoLock = createProjectLock();
export const isVideoBusy = videoLock.isBusy;
export const withVideoLock = videoLock.run;
