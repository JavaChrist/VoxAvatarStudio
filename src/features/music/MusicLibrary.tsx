"use client";

import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, LoaderCircle, Music as MusicIcon, Pencil, Trash2, Upload, X } from "lucide-react";
import { buttonPrimary, buttonSecondary } from "@/ui/buttons";
import { fieldErrorClass, inputClass } from "@/ui/fields";
import { quietPlayer } from "@/ui/media";
import { useModal } from "@/ui/modal/ModalProvider";
import { checkMusicFile, deleteMusic, importMusic, musicErrorMessage, renameMusic } from "./api";
import { MUSIC_EXTENSIONS, MUSIC_NAME_MAX, MUSIC_TYPES, musicNameFromFile, type MusicView } from "./schema";

const byName = (a: MusicView, b: MusicView) => a.name.localeCompare(b.name, "fr");

/** Extensions et types acceptés par le sélecteur de fichier (certains systèmes annoncent audio/x-m4a ou audio/x-wav). */
const ACCEPT = [...MUSIC_TYPES, "audio/x-m4a", "audio/x-wav", ...Object.values(MUSIC_EXTENSIONS).map((ext) => `.${ext}`)].join(",");

const formatSize = (bytes: number) => `${(bytes / (1024 * 1024)).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`;

/** Bibliothèque des musiques : import, écoute, renommage et suppression, sur une seule page. */
export function MusicLibrary({ initial }: { initial: MusicView[] }) {
  const router = useRouter();
  const modal = useModal();
  const fileInput = useRef<HTMLInputElement>(null);
  const [tracks, setTracks] = useState(initial);
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);

  const upsert = (music: MusicView) => setTracks((current) => [...current.filter((m) => m.id !== music.id), music].sort(byName));

  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImporting(true);
    const checked = await checkMusicFile(file);
    if (!checked.ok) {
      setImporting(false);
      return void modal.error({ title: "Import impossible", body: musicErrorMessage(checked.error) });
    }
    const result = await importMusic(musicNameFromFile(file.name), file, checked.type);
    setImporting(false);
    if (result.ok) return upsert(result.music);
    if (result.error === "unauthorized") return router.replace("/connexion");
    await modal.error({ title: "Import impossible", body: result.field ?? musicErrorMessage(result.error) });
  };

  const startRename = (music: MusicView) => {
    setEditing(music.id);
    setDraft(music.name);
    setNameError(null);
  };

  const submitRename = async (event: FormEvent, music: MusicView) => {
    event.preventDefault();
    setBusy(music.id);
    const result = await renameMusic(music.id, draft);
    setBusy(null);
    if (result.ok) {
      upsert(result.music);
      setEditing(null);
      return;
    }
    if (result.error === "unauthorized") return router.replace("/connexion");
    if (result.field) return setNameError(result.field);
    await modal.error({ title: "Renommage impossible", body: musicErrorMessage(result.error) });
  };

  const remove = async (music: MusicView) => {
    const ok = await modal.destructive({
      title: "Supprimer cette musique ?",
      body: `« ${music.name} » sera supprimée définitivement. Les vidéos déjà montées ne changent pas. Cette action est irréversible.`,
      confirmLabel: "Supprimer la musique",
      cancelLabel: "Annuler",
    });
    if (!ok) return;
    setBusy(music.id);
    const result = await deleteMusic(music.id);
    setBusy(null);
    // not_found : déjà supprimée ailleurs, on la retire aussi de la liste.
    if (result === "ok" || result === "not_found") {
      setTracks((current) => current.filter((m) => m.id !== music.id));
      return;
    }
    if (result === "unauthorized") return router.replace("/connexion");
    await modal.error({ title: "Suppression impossible", body: musicErrorMessage(result) });
  };

  const locked = importing || busy !== null;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-normal tracking-[-0.04em] md:text-5xl">Musiques</h1>
          <p className="mt-2 max-w-xl text-sm text-muted">
            Musique de fond jouée en boucle sous la voix de Chris, plus forte sur la signature de fin. MP3, M4A ou WAV,
            20 Mo au plus. Tu la choisis au moment du montage, avec son volume.
          </p>
        </div>
        <button type="button" onClick={() => fileInput.current?.click()} disabled={locked} className={buttonPrimary}>
          {importing ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Upload className="size-4" aria-hidden />}
          {importing ? "Import en cours" : "Importer une musique"}
        </button>
        <input ref={fileInput} type="file" accept={ACCEPT} onChange={choose} className="hidden" />
      </div>

      {tracks.length === 0 ? (
        <section className="mt-10 flex flex-col items-center gap-3 rounded-lg border border-line px-6 py-16 text-center">
          <MusicIcon className="size-6 text-quiet" aria-hidden />
          <p className="text-sm font-medium">Aucune musique pour l&apos;instant</p>
          <p className="max-w-sm text-sm text-muted">
            Importe une piste une fois, puis réutilise-la sous la voix de Chris dans chaque vidéo. Utilise uniquement des
            musiques libres de droits ou dont tu as la licence.
          </p>
        </section>
      ) : (
        <ul className="mt-10 flex flex-col gap-3">
          {tracks.map((music) => (
            <li key={music.id} className="flex flex-col gap-3 rounded-lg border border-line p-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                {editing === music.id ? (
                  <form onSubmit={(event) => submitRename(event, music)} className="flex flex-col gap-2">
                    <label htmlFor={`music-name-${music.id}`} className="sr-only">
                      Nom de la musique
                    </label>
                    <div className="flex gap-2">
                      <input
                        id={`music-name-${music.id}`}
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        maxLength={MUSIC_NAME_MAX}
                        aria-invalid={nameError ? true : undefined}
                        autoFocus
                        className={inputClass}
                      />
                      <button type="submit" disabled={busy !== null} className={buttonPrimary} aria-label="Enregistrer le nom">
                        {busy === music.id ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
                      </button>
                      <button type="button" onClick={() => setEditing(null)} className={buttonSecondary} aria-label="Annuler">
                        <X className="size-4" aria-hidden />
                      </button>
                    </div>
                    {nameError && <p className={fieldErrorClass}>{nameError}</p>}
                  </form>
                ) : (
                  <>
                    <p className="truncate text-sm font-medium" title={music.name}>
                      {music.name}
                    </p>
                    <p className="mt-1 text-xs text-quiet">
                      {MUSIC_EXTENSIONS[music.track.contentType].toUpperCase()} · {formatSize(music.track.sizeBytes)}
                    </p>
                  </>
                )}
              </div>
              {music.trackUrl && (
                <audio ref={quietPlayer} controls preload="none" src={music.trackUrl} className="w-full sm:w-72">
                  <track kind="captions" />
                </audio>
              )}
              {editing !== music.id && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => startRename(music)}
                    disabled={locked || editing !== null}
                    className={buttonSecondary}
                    aria-label={`Renommer ${music.name}`}
                  >
                    <Pencil className="size-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(music)}
                    disabled={locked || editing !== null}
                    className={`${buttonSecondary} hover:border-danger/60 hover:text-danger`}
                    aria-label={`Supprimer ${music.name}`}
                  >
                    {busy === music.id ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Trash2 className="size-4" aria-hidden />}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
