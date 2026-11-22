"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, LoaderCircle } from "lucide-react";
import {
  DURATION_PRESETS,
  LIMITS,
  TONES,
  VIDEO_FORMATS,
  validateProjectInput,
  type DurationPreset,
  type Tone,
  type VideoFormat,
} from "@/features/projects/schema";
import { buttonPrimary, buttonSecondary } from "@/ui/buttons";
import { choiceClass, fieldErrorClass, inputClass, textareaClass } from "@/ui/fields";
import { useModal } from "@/ui/modal/ModalProvider";

/** Aperçu de chaque format : largeur en pixels pour une hauteur de 24 px. */
const FORMAT_PREVIEW: Record<VideoFormat, { width: number; label: string }> = {
  "9:16": { width: 14, label: "Stories, Reels, TikTok, Shorts" },
  "4:5": { width: 19, label: "Fil Instagram, Facebook" },
  "1:1": { width: 24, label: "Carré, tous réseaux" },
};

type Errors = Record<string, string>;

/** Ordre d'affichage des champs : on amène l'utilisateur sur la première erreur. */
const FIELD_ORDER = ["topic", "notes", "tone", "duration", "formats"];

function showErrors(errors: Errors, setErrors: (errors: Errors) => void) {
  setErrors(errors);
  const first = FIELD_ORDER.find((field) => errors[field]);
  if (!first) return;
  const element = document.getElementById(`field-${first}`);
  element?.scrollIntoView({ behavior: "smooth", block: "center" });
  // Le sujet et les notes reçoivent le focus ; pour un groupe de choix, le défilement suffit.
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) element.focus({ preventScroll: true });
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className={fieldErrorClass}>
      {message}
    </p>
  );
}

export function NewProjectForm() {
  const router = useRouter();
  const modal = useModal();
  const [topic, setTopic] = useState("");
  const [notes, setNotes] = useState("");
  const [tone, setTone] = useState<Tone>("pedagogique");
  const [duration, setDuration] = useState<DurationPreset>("15-30");
  const [formats, setFormats] = useState<VideoFormat[]>(["9:16"]);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  /** Efface l'erreur d'un champ dès que l'utilisateur le modifie. */
  const clearError = (field: string) =>
    setErrors((current) => {
      if (!current[field]) return current;
      const rest = { ...current };
      delete rest[field];
      return rest;
    });

  const toggleFormat = (format: VideoFormat) => {
    clearError("formats");
    setFormats((current) => (current.includes(format) ? current.filter((f) => f !== format) : [...current, format]));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const input = { topic, notes, tone, duration, formats };
    // Même validation que le serveur : les erreurs s'affichent sans aller-retour.
    const local = validateProjectInput(input);
    if (!local.ok) {
      showErrors(local.errors, setErrors);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(local.value),
      });
      if (response.status === 401) {
        router.replace("/connexion");
        return;
      }
      const data = await response.json().catch(() => null);
      if (response.status === 400 && data?.fields) {
        setBusy(false);
        showErrors(data.fields, setErrors);
        return;
      }
      if (!response.ok || !data?.project?.id) throw new Error("create_failed");
      router.push(`/projets/${data.project.id}`);
      router.refresh();
    } catch {
      setBusy(false);
      await modal.error({ title: "Création impossible", body: "Le projet n'a pas pu être enregistré. Réessaie dans un instant." });
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <label htmlFor="field-topic" className="text-sm font-medium">
          Sujet
        </label>
        <input
          id="field-topic"
          value={topic}
          onChange={(event) => {
            setTopic(event.target.value);
            clearError("topic");
          }}
          maxLength={LIMITS.topicMax}
          placeholder="Ex. : 3 erreurs à éviter quand on lance son site"
          aria-invalid={Boolean(errors.topic)}
          aria-describedby={errors.topic ? "topic-error" : undefined}
          className={inputClass}
        />
        <FieldError id="topic-error" message={errors.topic} />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-4">
          <label htmlFor="field-notes" className="text-sm font-medium">
            Notes <span className="font-normal text-quiet">(facultatif)</span>
          </label>
          <span className="text-xs text-quiet tabular-nums">
            {notes.length} / {LIMITS.notesMax}
          </span>
        </div>
        <textarea
          id="field-notes"
          value={notes}
          onChange={(event) => {
            setNotes(event.target.value);
            clearError("notes");
          }}
          maxLength={LIMITS.notesMax}
          placeholder="Points à aborder, public visé, appel à l'action, liens…"
          aria-invalid={Boolean(errors.notes)}
          aria-describedby={errors.notes ? "notes-error" : undefined}
          className={textareaClass}
        />
        <FieldError id="notes-error" message={errors.notes} />
      </div>

      <fieldset id="field-tone" className="flex scroll-mt-24 flex-col gap-3">
        <legend className="mb-3 text-sm font-medium">Ton</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {TONES.map((option) => (
            <label key={option.id} className={choiceClass}>
              <input
                type="radio"
                name="tone"
                value={option.id}
                checked={tone === option.id}
                onChange={() => {
                  setTone(option.id);
                  clearError("tone");
                }}
                className="sr-only"
              />
              {option.label}
            </label>
          ))}
        </div>
        <FieldError id="tone-error" message={errors.tone} />
      </fieldset>

      <fieldset id="field-duration" className="flex scroll-mt-24 flex-col gap-3">
        <legend className="mb-3 text-sm font-medium">Durée</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {DURATION_PRESETS.map((preset) => (
            <label key={preset.id} className={`${choiceClass} flex-col items-start gap-0.5`}>
              <input
                type="radio"
                name="duration"
                value={preset.id}
                checked={duration === preset.id}
                onChange={() => {
                  setDuration(preset.id);
                  clearError("duration");
                }}
                className="sr-only"
              />
              <span className="font-medium">{preset.label}</span>
              <span className="text-xs text-muted">Cible {preset.targetSeconds} s</span>
            </label>
          ))}
        </div>
        <FieldError id="duration-error" message={errors.duration} />
      </fieldset>

      <fieldset id="field-formats" className="flex scroll-mt-24 flex-col gap-3">
        <legend className="mb-3 text-sm font-medium">Formats</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {VIDEO_FORMATS.map((format) => {
            const checked = formats.includes(format);
            return (
              <label key={format} className={choiceClass}>
                <input type="checkbox" checked={checked} onChange={() => toggleFormat(format)} className="sr-only" />
                <span className="flex h-8 w-7 shrink-0 items-center justify-center" aria-hidden>
                  <span
                    className={`h-6 rounded-sm border ${checked ? "border-ink" : "border-line-strong"}`}
                    style={{ width: FORMAT_PREVIEW[format].width }}
                  />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium">{format}</span>
                  <span className="truncate text-xs text-muted">{FORMAT_PREVIEW[format].label}</span>
                </span>
                {checked && <Check className="size-4 shrink-0" aria-hidden />}
              </label>
            );
          })}
        </div>
        <FieldError id="formats-error" message={errors.formats} />
      </fieldset>

      <div className="flex flex-col-reverse gap-2 border-t border-line pt-6 sm:flex-row sm:justify-end">
        <button type="button" onClick={() => router.back()} className={buttonSecondary} disabled={busy}>
          Annuler
        </button>
        <button type="submit" disabled={busy} className={buttonPrimary}>
          {busy && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
          Créer le projet
        </button>
      </div>
    </form>
  );
}
