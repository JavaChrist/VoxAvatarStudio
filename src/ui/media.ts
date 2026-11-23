/** Volume de départ des lecteurs du studio : la vidéo et la voix démarrent bas, le son des fichiers ne change pas. */
export const DEFAULT_PLAYER_VOLUME = 0.2;

/** À passer en `ref` d'un <video> ou <audio> : règle le volume à l'affichage du lecteur. */
export function quietPlayer(element: HTMLMediaElement | null) {
  if (element) element.volume = DEFAULT_PLAYER_VOLUME;
}
