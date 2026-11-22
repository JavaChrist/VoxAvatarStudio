// Service worker minimal : il rend l'application installable, sans rien mettre en cache.
// Les mises à jour sont détectées par /version.json (UpdatePrompt).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
