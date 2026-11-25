"use client";

import { useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, FileText, Gauge, LoaderCircle, Plus, RefreshCw, Save, Sparkles, Trash2 } from "lucide-react";
import {
  SCRIPT_LIMITS,
  countWords,
  durationFit,
  estimateSeconds,
  validateScriptEdit,
  type Script,
} from "@/features/projects/script";
import { WORDS_PER_SECOND } from "@/features/projects/schema";
import { buttonPrimary, buttonSecondary } from "@/ui/buttons";
import { fieldErrorClass, inputClass, textareaClass } from "@/ui/fields";
import { useModal } from "@/ui/modal/ModalProvider";

interface DraftScene {
  key: number;
  spokenText: string;
  visualIntent: string;
}

interface Draft {
  title: string;
  scenes: DraftScene[];
}

type Busy = "generate" | "adjust" | "save" | null;

/** Clés React stables des scènes du brouillon (jamais envoyées au serveur). */
let keySeq = 0;
const nextKey = () => ++keySeq;

/** Messages affichés pour chaque code d'erreur renvoyé par l'API. */
const GENERATE_ERRORS: Record<string, string> = {
  not_configured: "La clé Anthropic n'est pas configurée sur le serveur.",
  in_progress: "Une génération est déjà en cours pour ce projet. Patiente quelques secondes.",
  script_refused: "Claude a refusé d'écrire ce script. Reformule le sujet ou les notes.",
  script_truncated: "La réponse de Claude a été coupée. Réessaie.",
  script_invalid: "La réponse de Claude n'était pas exploitable. Réessaie.",
  provider_error: "Le service Anthropic ne répond pas pour le moment. Réessaie dans un instant.",
};

const SAVE_ERRORS: Record<string, string> = {
  in_progress: "Une génération est en cours : attends qu'elle se termine avant d'enregistrer.",
  no_script: "Ce projet n'a plus de script à modifier. Recharge la page.",
};

function toDraft(script: Script): Draft {
  return {
    title: script.title,
    scenes: script.scenes.map((scene) => ({ key: nextKey(), spokenText: scene.spokenText, visualIntent: scene.visualIntent })),
  };
}

/** Compare le brouillon au script enregistré, sans tenir compte des espaces en trop. */
function sameAsSaved(draft: Draft, script: Script): boolean {
  const clean = (text: string) => text.trim().replace(/\s+/g, " ");
  return (
    clean(draft.title) === script.title &&
    draft.scenes.length === script.scenes.length &&
    draft.scenes.every(
      (scene, index) =>
        clean(scene.spokenText) === script.scenes[index]?.spokenText &&
        scene.visualIntent.trim() === script.scenes[index]?.visualIntent,
    )
  );
}

function formatSeconds(seconds: number): string {
  return `${seconds.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} s`;
}

export function ScriptEditor({ projectId, initialScript }: { projectId: string; initialScript: Script | null }) {
  const router = useRouter();
  const modal = useModal();
  // Identifiants HTML stables entre serveur et navigateur (le compteur de clés, lui, sert seulement aux clés React).
  const fieldId = useId();

  const [saved, setSaved] = useState<Script | null>(initialScript);
  const [draft, setDraft] = useState<Draft | null>(() => (initialScript ? toDraft(initialScript) : null));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Busy>(null);

  const stats = useMemo(() => {
    if (!draft) return null;
    const scenes = draft.scenes.map((scene) => {
      const words = countWords(scene.spokenText);
      return { words, seconds: estimateSeconds(words) };
    });
    const totalWords = scenes.reduce((sum, scene) => sum + scene.words, 0);
    return { scenes, totalWords, seconds: estimateSeconds(totalWords) };
  }, [draft]);

  const dirty = Boolean(draft && saved && !sameAsSaved(draft, saved));

  const clearError = (field: string) =>
    setErrors((current) => {
      if (!current[field]) return current;
      const rest = { ...current };
      delete rest[field];
      return rest;
    });

  const applyScript = (script: Script) => {
    setSaved(script);
    setDraft(toDraft(script));
    setErrors({});
  };

  /**
   * Demande au serveur de ramener la durée dans la cible (au plus 2 appels facturés).
   * Renvoie false si la session a expiré (redirection en cours).
   */
  const runAdjust = async (): Promise<boolean> => {
    setBusy("adjust");
    try {
      const response = await fetch(`/api/projects/${projectId}/script/adjust`, { method: "POST" });
      if (response.status === 401) {
        router.replace("/connexion");
        return false;
      }
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.project?.script) {
        await modal.error({
          title: "Ajustement impossible",
          body: `${GENERATE_ERRORS[data?.error] ?? "La durée n'a pas pu être ajustée."} Tu peux corriger le texte à la main.`,
        });
        return true;
      }
      const script: Script = data.project.script;
      applyScript(script);
      if (data.fit !== "ok") {
        await modal.info({
          title: "Durée encore hors cible",
          body: `Après ${data.attempts} essai${data.attempts > 1 ? "s" : ""}, le script dure environ ${formatSeconds(script.estimatedSeconds)} pour une cible de ${formatSeconds(script.targetSeconds)}. Ajuste le texte à la main ou relance l'ajustement.`,
        });
      }
      return true;
    } catch {
      await modal.error({ title: "Ajustement impossible", body: "La connexion au serveur a échoué. Vérifie ta connexion et réessaie." });
      return true;
    } finally {
      setBusy(null);
    }
  };

  const adjust = async () => {
    if (!saved) return;
    const ok = await modal.confirm({
      title: "Ajuster la durée ?",
      body: `Claude va allonger ou raccourcir le texte pour viser ${formatSeconds(saved.targetSeconds)} (±10 %), en modifiant le moins possible. Jusqu'à 2 appels facturés.`,
      confirmLabel: "Ajuster",
      cancelLabel: "Annuler",
    });
    if (!ok) return;
    if (await runAdjust()) router.refresh();
  };

  const generate = async () => {
    if (saved) {
      const ok = await modal.confirm({
        title: "Régénérer le script ?",
        body: dirty
          ? "Claude va réécrire tout le script. Tes modifications non enregistrées et le texte actuel seront remplacés. Cet appel est facturé, plus 2 au maximum si la durée doit être ajustée."
          : "Claude va réécrire tout le script et remplacer le texte actuel. Cet appel est facturé, plus 2 au maximum si la durée doit être ajustée.",
        confirmLabel: "Régénérer",
        cancelLabel: "Annuler",
      });
      if (!ok) return;
    }
    setBusy("generate");
    try {
      const response = await fetch(`/api/projects/${projectId}/script`, { method: "POST" });
      if (response.status === 401) {
        router.replace("/connexion");
        return;
      }
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.project?.script) {
        await modal.error({
          title: "Génération impossible",
          body: GENERATE_ERRORS[data?.error] ?? "Le script n'a pas pu être généré. Réessaie dans un instant.",
        });
        return;
      }
      const script: Script = data.project.script;
      applyScript(script);
      // Durée hors cible : ajustement automatique (au plus 2 appels), puis rafraîchissement de la page.
      if (durationFit(script.estimatedSeconds, script.targetSeconds) !== "ok") {
        setBusy(null);
        if (!(await runAdjust())) return;
      }
      // Met à jour le statut affiché par la page serveur.
      router.refresh();
    } catch {
      await modal.error({ title: "Génération impossible", body: "La connexion au serveur a échoué. Vérifie ta connexion et réessaie." });
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!draft) return;
    const local = validateScriptEdit(draft);
    if (!local.ok) {
      setErrors(local.errors);
      return;
    }
    setBusy("save");
    try {
      const response = await fetch(`/api/projects/${projectId}/script`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(local.value),
      });
      if (response.status === 401) {
        router.replace("/connexion");
        return;
      }
      const data = await response.json().catch(() => null);
      if (response.status === 400 && data?.fields) {
        setErrors(data.fields);
        return;
      }
      if (!response.ok || !data?.project?.script) {
        await modal.error({
          title: "Enregistrement impossible",
          body: SAVE_ERRORS[data?.error] ?? "Le script n'a pas pu être enregistré. Réessaie dans un instant.",
        });
        return;
      }
      applyScript(data.project.script);
      router.refresh();
    } catch {
      await modal.error({ title: "Enregistrement impossible", body: "La connexion au serveur a échoué. Vérifie ta connexion et réessaie." });
    } finally {
      setBusy(null);
    }
  };

  const updateScene = (index: number, patch: Partial<Omit<DraftScene, "key">>) => {
    clearError(`scene-${index}`);
    setDraft((current) =>
      current ? { ...current, scenes: current.scenes.map((scene, i) => (i === index ? { ...scene, ...patch } : scene)) } : current,
    );
  };

  const addScene = () => {
    clearError("scenes");
    setDraft((current) =>
      current ? { ...current, scenes: [...current.scenes, { key: nextKey(), spokenText: "", visualIntent: "" }] } : current,
    );
  };

  const removeScene = async (index: number) => {
    if (!draft) return;
    const scene = draft.scenes[index];
    if (!scene) return;
    if (scene.spokenText.trim() || scene.visualIntent.trim()) {
      const ok = await modal.destructive({
        title: `Supprimer la scène ${index + 1} ?`,
        body: "Son texte sera retiré du brouillon. Tant que tu n'enregistres pas, le script enregistré reste inchangé.",
        confirmLabel: "Supprimer",
        cancelLabel: "Annuler",
      });
      if (!ok) return;
    }
    // Les erreurs sont indexées par position : on les efface pour ne pas les décaler.
    setErrors({});
    setDraft((current) => (current ? { ...current, scenes: current.scenes.filter((_, i) => i !== index) } : current));
  };

  const cancelEdits = () => {
    if (!saved) return;
    setDraft(toDraft(saved));
    setErrors({});
  };

  if (!saved || !draft || !stats) {
    return (
      <section className="mt-10 rounded-lg border border-line">
        <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
          <FileText className="size-6 text-quiet" aria-hidden />
          <p className="text-sm font-medium">Script</p>
          <p className="max-w-sm text-sm text-muted">
            Claude écrit le texte que Chris va dire, découpé en scènes, à partir du sujet, des notes, du ton et de la durée.
            Si la durée sort de la cible, elle est ajustée automatiquement (2 appels de plus au maximum).
          </p>
          <button type="button" onClick={generate} disabled={busy !== null} className={`${buttonPrimary} mt-2`}>
            {busy === "generate" ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
            {busy === "generate" ? "Génération en cours…" : "Générer le script"}
          </button>
        </div>
      </section>
    );
  }

  const fit = durationFit(stats.seconds, saved.targetSeconds);
  const savedFit = durationFit(saved.estimatedSeconds, saved.targetSeconds);
  const disabled = busy !== null;
  const origin =
    saved.editedAt && (!saved.adjustedAt || saved.editedAt > saved.adjustedAt)
      ? "Modifié à la main"
      : saved.adjustedAt
        ? `Durée ajustée par ${saved.model}`
        : `Écrit par ${saved.model}`;

  return (
    <section className="mt-10 flex flex-col gap-6" aria-busy={busy !== null}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <FileText className="size-4 text-quiet" aria-hidden />
          Script
        </h2>
        <div className="flex flex-wrap gap-2">
          {(savedFit !== "ok" || busy === "adjust") && (
            <button
              type="button"
              onClick={adjust}
              disabled={disabled || dirty}
              title={dirty ? "Enregistre ou annule tes modifications avant d'ajuster la durée." : undefined}
              className={buttonSecondary}
            >
              {busy === "adjust" ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Gauge className="size-4" aria-hidden />}
              {busy === "adjust" ? "Ajustement en cours…" : "Ajuster la durée"}
            </button>
          )}
          <button type="button" onClick={generate} disabled={disabled} className={buttonSecondary}>
            {busy === "generate" ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />}
            {busy === "generate" ? "Génération en cours…" : "Régénérer"}
          </button>
        </div>
      </div>

      <div
        className={`flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border px-4 py-3 text-sm ${
          fit === "ok" ? "border-line" : "border-danger/60"
        }`}
        aria-live="polite"
      >
        <span className="tabular-nums">
          <span className="text-quiet">Durée estimée </span>
          {formatSeconds(stats.seconds)}
          <span className="text-quiet"> / cible {formatSeconds(saved.targetSeconds)}</span>
        </span>
        <span className="tabular-nums">
          <span className="text-quiet">Mots </span>
          {stats.totalWords}
        </span>
        <span className="tabular-nums">
          <span className="text-quiet">Scènes </span>
          {draft.scenes.length}
        </span>
        <span className={`ml-auto inline-flex items-center gap-1.5 ${fit === "ok" ? "text-ready" : "text-danger"}`}>
          {fit === "ok" ? <Check className="size-4" aria-hidden /> : <AlertTriangle className="size-4" aria-hidden />}
          {fit === "ok" ? "Dans la cible (±10 %)" : fit === "short" ? "Trop court" : "Trop long"}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="script-title" className="text-sm font-medium">
          Titre
        </label>
        <input
          id="script-title"
          value={draft.title}
          onChange={(event) => {
            clearError("title");
            setDraft({ ...draft, title: event.target.value });
          }}
          maxLength={SCRIPT_LIMITS.titleMax}
          disabled={disabled}
          aria-invalid={Boolean(errors.title)}
          aria-describedby={errors.title ? "script-title-error" : undefined}
          className={inputClass}
        />
        {errors.title && (
          <p id="script-title-error" className={fieldErrorClass}>
            {errors.title}
          </p>
        )}
      </div>

      <ol className="flex flex-col gap-4">
        {draft.scenes.map((scene, index) => {
          const error = errors[`scene-${index}`];
          return (
            <li key={scene.key} className="flex flex-col gap-3 rounded-lg border border-line p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium">Scène {index + 1}</span>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-quiet tabular-nums">
                    {stats.scenes[index]?.words ?? 0} mots · {formatSeconds(stats.scenes[index]?.seconds ?? 0)}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeScene(index)}
                    disabled={disabled || draft.scenes.length <= 1}
                    aria-label={`Supprimer la scène ${index + 1}`}
                    className="inline-flex size-8 items-center justify-center rounded-lg text-quiet transition-colors duration-150 hover:bg-hover hover:text-danger disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </div>
              </div>
              <label htmlFor={`${fieldId}-scene-${index}-spoken`} className="sr-only">
                Texte parlé de la scène {index + 1}
              </label>
              <textarea
                id={`${fieldId}-scene-${index}-spoken`}
                value={scene.spokenText}
                onChange={(event) => updateScene(index, { spokenText: event.target.value })}
                maxLength={SCRIPT_LIMITS.spokenMax}
                disabled={disabled}
                placeholder="Ce que Chris dit face caméra"
                aria-invalid={Boolean(error)}
                className={textareaClass}
              />
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${fieldId}-scene-${index}-visual`} className="text-xs text-quiet">
                  Intention visuelle
                </label>
                <input
                  id={`${fieldId}-scene-${index}-visual`}
                  value={scene.visualIntent}
                  onChange={(event) => updateScene(index, { visualIntent: event.target.value })}
                  maxLength={SCRIPT_LIMITS.visualMax}
                  disabled={disabled}
                  placeholder="Illustration affichée au-dessus de Chris"
                  className={inputClass}
                />
              </div>
              {error && <p className={fieldErrorClass}>{error}</p>}
            </li>
          );
        })}
      </ol>

      {errors.scenes && <p className={fieldErrorClass}>{errors.scenes}</p>}

      <div className="flex flex-col gap-3 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={addScene}
          disabled={disabled || draft.scenes.length >= SCRIPT_LIMITS.scenesMax}
          className={buttonSecondary}
        >
          <Plus className="size-4" aria-hidden />
          Ajouter une scène
        </button>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
          {dirty && (
            <button type="button" onClick={cancelEdits} disabled={disabled} className={buttonSecondary}>
              Annuler les modifications
            </button>
          )}
          <button type="button" onClick={save} disabled={disabled || !dirty} className={buttonPrimary}>
            {busy === "save" ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />}
            Enregistrer
          </button>
        </div>
      </div>

      <p className="text-xs text-quiet">
        {origin} · mots et durées recalculés par le serveur à{" "}
        {WORDS_PER_SECOND.toLocaleString("fr-FR")} mots par seconde.
      </p>
    </section>
  );
}
