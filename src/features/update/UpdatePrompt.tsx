"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { CURRENT_BUILD_ID, fetchLatestBuildId } from "@/services/app-version";
import { useModal } from "@/ui/modal/ModalProvider";

/** Vérification régulière, même sans aucune action. */
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
/** Au plus une vérification par période pour le focus, le retour en ligne et les changements de page. */
const MIN_GAP_MS = 30 * 1000;

/**
 * Détecte un nouveau déploiement et propose de recharger l'application.
 * Vérifie au lancement, au retour sur l'onglet ou la fenêtre, au retour du réseau, à chaque changement de page
 * et toutes les 5 minutes. /version.json est un petit fichier statique : ces appels ne coûtent rien.
 */
export function UpdatePrompt() {
  const modal = useModal();
  const pathname = usePathname();
  const [latest, setLatest] = useState<string | null>(null);
  // « Plus tard » vaut pour cette version jusqu'au prochain lancement ; une version plus récente est reproposée.
  const proposed = useRef<string | null>(null);
  const lastCheck = useRef(0);

  // Relancé à chaque changement de page : c'est aussi une occasion de vérifier.
  useEffect(() => {
    const check = async (force = false) => {
      const now = Date.now();
      if (!force && now - lastCheck.current < MIN_GAP_MS) return;
      lastCheck.current = now;
      const buildId = await fetchLatestBuildId();
      if (buildId && buildId !== CURRENT_BUILD_ID) setLatest(buildId);
    };
    void check();
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    const onFocus = () => void check();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onFocus);
    const timer = setInterval(() => void check(true), CHECK_INTERVAL_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onFocus);
      clearInterval(timer);
    };
  }, [pathname]);

  useEffect(() => {
    if (!latest || proposed.current === latest) return;
    proposed.current = latest;
    void modal
      .confirm({
        title: "Nouvelle version disponible",
        body: "Une mise à jour de VoxAvatar Studio vient d'être déployée. Recharger maintenant pour en profiter ?",
        confirmLabel: "Mettre à jour",
        cancelLabel: "Plus tard",
      })
      .then((confirmed) => {
        if (confirmed) window.location.reload();
      });
  }, [latest, modal]);

  return null;
}
