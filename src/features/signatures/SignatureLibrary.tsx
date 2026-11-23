"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Pencil, Plus, Signature as SignatureIcon, Trash2 } from "lucide-react";
import { buttonPrimary, buttonSecondary } from "@/ui/buttons";
import { useModal } from "@/ui/modal/ModalProvider";
import { deleteSignature, signatureErrorMessage } from "./api";
import { SignatureEditor } from "./SignatureEditor";
import { SignaturePreview } from "./SignaturePreview";
import type { SignatureView } from "./schema";

const byName = (a: SignatureView, b: SignatureView) => a.name.localeCompare(b.name, "fr");

/** Bibliothèque des signatures : liste, création, modification et suppression, sur une seule page. */
export function SignatureLibrary({ initial }: { initial: SignatureView[] }) {
  const router = useRouter();
  const modal = useModal();
  const [signatures, setSignatures] = useState(initial);
  /** "new" : formulaire de création ouvert ; un identifiant : cette signature est en cours de modification. */
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const saved = (signature: SignatureView) => {
    setSignatures((current) => [...current.filter((s) => s.id !== signature.id), signature].sort(byName));
    setEditing(null);
  };

  const remove = async (signature: SignatureView) => {
    const ok = await modal.destructive({
      title: "Supprimer cette signature ?",
      body: `« ${signature.name} » et son logo seront supprimés définitivement. Les vidéos déjà montées ne changent pas. Cette action est irréversible.`,
      confirmLabel: "Supprimer la signature",
      cancelLabel: "Annuler",
    });
    if (!ok) return;
    setDeleting(signature.id);
    const result = await deleteSignature(signature.id);
    setDeleting(null);
    // not_found : déjà supprimée ailleurs, on la retire aussi de la liste.
    if (result === "ok" || result === "not_found") {
      setSignatures((current) => current.filter((s) => s.id !== signature.id));
      return;
    }
    if (result === "unauthorized") return router.replace("/connexion");
    await modal.error({ title: "Suppression impossible", body: signatureErrorMessage(result) });
  };

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-normal tracking-[-0.04em] md:text-5xl">Signatures</h1>
          <p className="mt-2 max-w-xl text-sm text-muted">
            Carte de fin de 4 s ajoutée après la voix : logo, nom, accroche, site et QR code. Tu la choisis au moment du montage.
          </p>
        </div>
        {editing === null && (
          <button type="button" onClick={() => setEditing("new")} className={buttonPrimary}>
            <Plus className="size-4" aria-hidden />
            Nouvelle signature
          </button>
        )}
      </div>

      {editing === "new" && (
        <div className="mt-10">
          <SignatureEditor signature={null} onSaved={saved} onCancel={() => setEditing(null)} />
        </div>
      )}

      {signatures.length === 0 && editing !== "new" ? (
        <section className="mt-10 flex flex-col items-center gap-3 rounded-lg border border-line px-6 py-16 text-center">
          <SignatureIcon className="size-6 text-quiet" aria-hidden />
          <p className="text-sm font-medium">Aucune signature pour l&apos;instant</p>
          <p className="max-w-sm text-sm text-muted">Crée une signature une fois, puis réutilise-la à la fin de chaque vidéo.</p>
        </section>
      ) : (
        <ul className="mt-10 flex flex-col gap-4">
          {signatures.map((signature) =>
            editing === signature.id ? (
              <li key={signature.id}>
                <SignatureEditor signature={signature} onSaved={saved} onCancel={() => setEditing(null)} />
              </li>
            ) : (
              <li key={signature.id} className="flex gap-4 rounded-lg border border-line p-4 sm:gap-6">
                <SignaturePreview content={signature} className="w-24 shrink-0 sm:w-32" />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <p className="truncate text-sm font-medium">{signature.name}</p>
                  {[signature.displayName, signature.tagline, signature.website, signature.handle]
                    .filter(Boolean)
                    .map((text, index) => (
                      <p key={index} className="truncate text-sm text-muted">
                        {text}
                      </p>
                    ))}
                  <p className="text-xs text-quiet">
                    {signature.logo ? "Logo" : "Sans logo"} · {signature.qrUrl ? "QR code" : "Sans QR code"}
                  </p>
                  <div className="mt-auto flex flex-wrap gap-2 pt-3">
                    <button
                      type="button"
                      onClick={() => setEditing(signature.id)}
                      disabled={editing !== null || deleting !== null}
                      className={buttonSecondary}
                    >
                      <Pencil className="size-4" aria-hidden />
                      Modifier
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(signature)}
                      disabled={editing !== null || deleting !== null}
                      className={`${buttonSecondary} hover:border-danger/60 hover:text-danger`}
                    >
                      {deleting === signature.id ? (
                        <LoaderCircle className="size-4 animate-spin" aria-hidden />
                      ) : (
                        <Trash2 className="size-4" aria-hidden />
                      )}
                      Supprimer
                    </button>
                  </div>
                </div>
              </li>
            ),
          )}
        </ul>
      )}
    </>
  );
}
