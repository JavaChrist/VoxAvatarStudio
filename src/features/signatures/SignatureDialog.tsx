"use client";

import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { SignatureEditor } from "./SignatureEditor";
import type { SignatureView } from "./schema";

/**
 * Création d'une signature dans une fenêtre, sans quitter la page en cours (le montage, par exemple).
 * Échap ou « Annuler » ferment la fenêtre, sauf pendant l'enregistrement ; un clic sur le fond ne ferme rien,
 * pour ne pas perdre une saisie par mégarde.
 */
export function SignatureDialog({ onCreated, onClose }: { onCreated: (signature: SignatureView) => void; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    document.getElementById("signature-name")?.focus();
  }, []);

  // Échap déclenche « cancel » : on le bloque pendant l'enregistrement.
  const handleCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    if (busy) event.preventDefault();
  };

  // Tout passe par close() : le navigateur rend le focus au bouton d'origine, puis onClose démonte la fenêtre.
  const close = () => dialogRef.current?.close();

  const created = (signature: SignatureView) => {
    onCreated(signature);
    close();
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="signature-editor-title"
      onCancel={handleCancel}
      onClose={onClose}
      className="modal m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto rounded-xl border border-line bg-surface p-4 text-ink sm:p-6"
    >
      <SignatureEditor signature={null} onSaved={created} onCancel={close} onBusyChange={setBusy} bare />
    </dialog>
  );
}
