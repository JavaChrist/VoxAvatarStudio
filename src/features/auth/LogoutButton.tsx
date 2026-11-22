"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { buttonSecondary } from "@/ui/buttons";
import { useModal } from "@/ui/modal/ModalProvider";

export function LogoutButton() {
  const router = useRouter();
  const modal = useModal();

  const handleClick = async () => {
    const confirmed = await modal.confirm({
      title: "Se déconnecter",
      body: "Tu devras saisir à nouveau ton mot de passe sur cet appareil.",
      confirmLabel: "Se déconnecter",
    });
    if (!confirmed) return;
    await fetch("/api/session", { method: "DELETE" });
    router.replace("/connexion");
    router.refresh();
  };

  return (
    <button type="button" onClick={handleClick} className={buttonSecondary}>
      <LogOut className="size-4" aria-hidden />
      <span className="hidden sm:inline">Déconnexion</span>
    </button>
  );
}
