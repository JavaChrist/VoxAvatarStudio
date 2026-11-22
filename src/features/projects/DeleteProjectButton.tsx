"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Trash2 } from "lucide-react";
import { buttonDanger } from "@/ui/buttons";
import { useModal } from "@/ui/modal/ModalProvider";

/** Messages affichés pour chaque code d'erreur renvoyé par l'API. */
const DELETE_ERRORS: Record<string, string> = {
  in_progress: "Une génération (script ou voix) est en cours sur ce projet. Attends qu'elle se termine, puis réessaie.",
  not_found: "Ce projet n'existe plus.",
};

export function DeleteProjectButton({ projectId, topic, hasScript, hasVoice }: { projectId: string; topic: string; hasScript: boolean; hasVoice: boolean }) {
  const router = useRouter();
  const modal = useModal();
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    const content = [hasScript && "son script", hasVoice && "sa voix"].filter(Boolean).join(" et ");
    const ok = await modal.destructive({
      title: "Supprimer ce projet ?",
      body: [
        `« ${topic} » sera supprimé définitivement${content ? `, avec ${content}` : ""}.`,
        "Cette action est irréversible.",
      ].join(" "),
      confirmLabel: "Supprimer le projet",
      cancelLabel: "Annuler",
    });
    if (!ok) return;

    setBusy(true);
    try {
      const response = await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
      if (response.status === 401) return router.replace("/connexion");
      // 404 : déjà supprimé ailleurs, on revient simplement à la liste.
      if (response.ok || response.status === 404) {
        router.replace("/");
        router.refresh();
        return;
      }
      const data = await response.json().catch(() => null);
      await modal.error({
        title: "Suppression impossible",
        body: DELETE_ERRORS[data?.error] ?? "Le projet n'a pas pu être supprimé. Réessaie dans un instant.",
      });
    } catch {
      await modal.error({ title: "Suppression impossible", body: "La connexion au serveur a échoué. Vérifie ta connexion et réessaie." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-16 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-danger/40 px-4 py-4">
      <div>
        <h2 className="text-sm font-medium">Supprimer le projet</h2>
        <p className="mt-1 text-sm text-muted">Efface le projet et tous ses fichiers. Irréversible.</p>
      </div>
      <button type="button" onClick={remove} disabled={busy} className={buttonDanger}>
        {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Trash2 className="size-4" aria-hidden />}
        {busy ? "Suppression…" : "Supprimer"}
      </button>
    </section>
  );
}
