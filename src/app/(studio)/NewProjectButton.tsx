"use client";

import { Plus } from "lucide-react";
import { buttonPrimary } from "@/ui/buttons";
import { useModal } from "@/ui/modal/ModalProvider";

export function NewProjectButton() {
  const modal = useModal();
  return (
    <button
      type="button"
      className={buttonPrimary}
      onClick={() =>
        void modal.info({
          title: "Bientôt disponible",
          body: "La création de projet arrive à l'étape suivante : script avec Claude et calage sur la durée.",
        })
      }
    >
      <Plus className="size-4" aria-hidden />
      Nouveau projet
    </button>
  );
}
