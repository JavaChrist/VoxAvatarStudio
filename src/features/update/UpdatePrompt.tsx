"use client";

import { useEffect, useRef, useState } from "react";
import { CURRENT_BUILD_ID, fetchLatestBuildId } from "@/services/app-version";
import { useModal } from "@/ui/modal/ModalProvider";

const CHECK_INTERVAL_MS = 30 * 60 * 1000;

/** Détecte un nouveau déploiement et propose de recharger l'application. */
export function UpdatePrompt() {
  const modal = useModal();
  const [latest, setLatest] = useState<string | null>(null);
  // « Plus tard » vaut pour cette version jusqu'au prochain lancement ; une version plus récente est reproposée.
  const proposed = useRef<string | null>(null);

  useEffect(() => {
    const check = async () => {
      const buildId = await fetchLatestBuildId();
      if (buildId && buildId !== CURRENT_BUILD_ID) setLatest(buildId);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    void check();
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(() => void check(), CHECK_INTERVAL_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, []);

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
