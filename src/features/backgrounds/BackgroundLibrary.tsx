"use client";

import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, ImageOff, Images, LoaderCircle, Pencil, Trash2, Upload, X } from "lucide-react";
import { buttonPrimary, buttonSecondary } from "@/ui/buttons";
import { fieldErrorClass, inputClass } from "@/ui/fields";
import { useModal } from "@/ui/modal/ModalProvider";
import { backgroundErrorMessage, checkBackgroundFile, deleteBackground, importBackground, renameBackground } from "./api";
import { BACKGROUND_NAME_MAX, BACKGROUND_TYPES, nameFromFile, type BackgroundView } from "./schema";

const byName = (a: BackgroundView, b: BackgroundView) => a.name.localeCompare(b.name, "fr");

/** Bibliothèque des fonds : import, renommage et suppression, sur une seule page. */
export function BackgroundLibrary({ initial }: { initial: BackgroundView[] }) {
  const router = useRouter();
  const modal = useModal();
  const fileInput = useRef<HTMLInputElement>(null);
  const [backgrounds, setBackgrounds] = useState(initial);
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);

  const upsert = (background: BackgroundView) =>
    setBackgrounds((current) => [...current.filter((b) => b.id !== background.id), background].sort(byName));

  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const invalid = checkBackgroundFile(file);
    if (invalid) return void modal.error({ title: "Import impossible", body: backgroundErrorMessage(invalid) });
    setImporting(true);
    const result = await importBackground(nameFromFile(file.name), file);
    setImporting(false);
    if (result.ok) return upsert(result.background);
    if (result.error === "unauthorized") return router.replace("/connexion");
    await modal.error({ title: "Import impossible", body: result.field ?? backgroundErrorMessage(result.error) });
  };

  const startRename = (background: BackgroundView) => {
    setEditing(background.id);
    setDraft(background.name);
    setNameError(null);
  };

  const submitRename = async (event: FormEvent, background: BackgroundView) => {
    event.preventDefault();
    setBusy(background.id);
    const result = await renameBackground(background.id, draft);
    setBusy(null);
    if (result.ok) {
      upsert(result.background);
      setEditing(null);
      return;
    }
    if (result.error === "unauthorized") return router.replace("/connexion");
    if (result.field) return setNameError(result.field);
    await modal.error({ title: "Renommage impossible", body: backgroundErrorMessage(result.error) });
  };

  const remove = async (background: BackgroundView) => {
    const ok = await modal.destructive({
      title: "Supprimer ce fond ?",
      body: `« ${background.name} » sera supprimé définitivement. Les vidéos déjà montées ne changent pas. Cette action est irréversible.`,
      confirmLabel: "Supprimer le fond",
      cancelLabel: "Annuler",
    });
    if (!ok) return;
    setBusy(background.id);
    const result = await deleteBackground(background.id);
    setBusy(null);
    // not_found : déjà supprimé ailleurs, on le retire aussi de la liste.
    if (result === "ok" || result === "not_found") {
      setBackgrounds((current) => current.filter((b) => b.id !== background.id));
      return;
    }
    if (result === "unauthorized") return router.replace("/connexion");
    await modal.error({ title: "Suppression impossible", body: backgroundErrorMessage(result) });
  };

  const locked = importing || busy !== null;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-normal tracking-[-0.04em] md:text-5xl">Fonds</h1>
          <p className="mt-2 max-w-xl text-sm text-muted">
            Image posée derrière Chris détouré, à la place du dégradé. PNG, JPEG ou WebP, 4 Mo au plus. Format vertical
            conseillé (1080 × 1920). Tu la choisis au moment du montage.
          </p>
        </div>
        <button type="button" onClick={() => fileInput.current?.click()} disabled={locked} className={buttonPrimary}>
          {importing ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Upload className="size-4" aria-hidden />}
          {importing ? "Import en cours" : "Importer un fond"}
        </button>
        <input ref={fileInput} type="file" accept={BACKGROUND_TYPES.join(",")} onChange={choose} className="hidden" />
      </div>

      {backgrounds.length === 0 ? (
        <section className="mt-10 flex flex-col items-center gap-3 rounded-lg border border-line px-6 py-16 text-center">
          <Images className="size-6 text-quiet" aria-hidden />
          <p className="text-sm font-medium">Aucun fond pour l&apos;instant</p>
          <p className="max-w-sm text-sm text-muted">
            Importe une image une fois, puis réutilise-la derrière Chris dans chaque vidéo. Sans fond, le dégradé par
            défaut est utilisé.
          </p>
        </section>
      ) : (
        <ul className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {backgrounds.map((background) => (
            <li key={background.id} className="flex flex-col overflow-hidden rounded-lg border border-line">
              <div className="aspect-[9/16] bg-black">
                {background.imageUrl ? (
                  // URL signée temporaire de Storage : pas d'optimisation next/image.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={background.imageUrl} alt="" className="size-full object-cover" />
                ) : (
                  <div className="flex size-full items-center justify-center">
                    <ImageOff className="size-6 text-quiet" aria-hidden />
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-2 p-3">
                {editing === background.id ? (
                  <form onSubmit={(event) => submitRename(event, background)} className="flex flex-col gap-2">
                    <label htmlFor={`bg-name-${background.id}`} className="sr-only">
                      Nom du fond
                    </label>
                    <input
                      id={`bg-name-${background.id}`}
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      maxLength={BACKGROUND_NAME_MAX}
                      aria-invalid={nameError ? true : undefined}
                      autoFocus
                      className={inputClass}
                    />
                    {nameError && <p className={fieldErrorClass}>{nameError}</p>}
                    <div className="flex gap-2">
                      <button type="submit" disabled={busy !== null} className={buttonPrimary} aria-label="Enregistrer le nom">
                        {busy === background.id ? (
                          <LoaderCircle className="size-4 animate-spin" aria-hidden />
                        ) : (
                          <Check className="size-4" aria-hidden />
                        )}
                      </button>
                      <button type="button" onClick={() => setEditing(null)} className={buttonSecondary} aria-label="Annuler">
                        <X className="size-4" aria-hidden />
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <p className="truncate text-sm font-medium" title={background.name}>
                      {background.name}
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => startRename(background)}
                        disabled={locked || editing !== null}
                        className={buttonSecondary}
                        aria-label={`Renommer ${background.name}`}
                      >
                        <Pencil className="size-4" aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(background)}
                        disabled={locked || editing !== null}
                        className={`${buttonSecondary} hover:border-danger/60 hover:text-danger`}
                        aria-label={`Supprimer ${background.name}`}
                      >
                        {busy === background.id ? (
                          <LoaderCircle className="size-4 animate-spin" aria-hidden />
                        ) : (
                          <Trash2 className="size-4" aria-hidden />
                        )}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
