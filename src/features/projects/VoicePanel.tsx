"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, AudioLines, Check, LoaderCircle, Mic, RefreshCw } from "lucide-react";
import { formatDate } from "@/features/projects/ProjectStatusBadge";
import type { Script } from "@/features/projects/script";
import { estimateVoiceCostUsd, isVoiceStale, voiceText, type Voice } from "@/features/projects/voice";
import { buttonPrimary, buttonSecondary } from "@/ui/buttons";
import { useModal } from "@/ui/modal/ModalProvider";

/** Messages affichés pour chaque code d'erreur renvoyé par l'API. */
const VOICE_ERRORS: Record<string, string> = {
  not_configured: "La clé ElevenLabs ou l'identifiant de voix n'est pas configuré sur le serveur.",
  in_progress: "Une génération est déjà en cours pour ce projet (voix ou script). Patiente quelques secondes.",
  script_missing: "Ce projet n'a pas encore de script. Génère-le d'abord.",
  text_too_long: "Le script est trop long pour la synthèse vocale. Raccourcis-le.",
  provider_busy: "ElevenLabs est saturé pour le moment. Réessaie dans une minute.",
  provider_error: "Le service ElevenLabs ne répond pas pour le moment. Réessaie dans un instant.",
  voice_invalid: "La réponse d'ElevenLabs n'était pas exploitable. Réessaie.",
};

const formatSeconds = (seconds: number) => `${seconds.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} s`;
const formatUsd = (amount: number) =>
  amount.toLocaleString("fr-FR", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface AudioLink {
  url: string;
  expiresAt: string;
}

export function VoicePanel({ projectId, script, initialVoice }: { projectId: string; script: Script | null; initialVoice: Voice | null }) {
  const router = useRouter();
  const modal = useModal();
  const [voice, setVoice] = useState<Voice | null>(initialVoice);
  const [audio, setAudio] = useState<AudioLink | null>(null);
  const [busy, setBusy] = useState(false);
  // Un seul renouvellement automatique du lien d'écoute par génération, pour ne pas boucler si le fichier est absent.
  const retried = useRef(false);

  /** Demande un lien d'écoute temporaire (gratuit). */
  const loadAudio = async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/voice`, { cache: "no-store" });
      if (response.status === 401) return router.replace("/connexion");
      if (!response.ok) return setAudio(null);
      setAudio(await response.json());
    } catch {
      setAudio(null);
    }
  };

  // Le lien d'écoute est demandé dans le navigateur : il n'apparaît jamais dans le HTML rendu par le serveur.
  useEffect(() => {
    if (!initialVoice) return;
    let active = true;
    fetch(`/api/projects/${projectId}/voice`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((link: AudioLink | null) => active && setAudio(link))
      .catch(() => active && setAudio(null));
    return () => {
      active = false;
    };
  }, [projectId, initialVoice]);

  const onAudioError = () => {
    // Lien expiré (15 min) : on en redemande un une fois.
    if (retried.current) return;
    retried.current = true;
    void loadAudio();
  };

  const generate = async () => {
    if (!script) return;
    const characters = voiceText(script).length;
    const stale = voice ? isVoiceStale(voice, script) : false;
    const ok = await modal.confirm({
      title: voice ? "Régénérer la voix ?" : "Générer la voix ?",
      body: [
        `ElevenLabs va lire les ${script.scenes.length} scènes du script enregistré (${characters.toLocaleString("fr-FR")} caractères).`,
        `Coût estimé : environ ${formatUsd(estimateVoiceCostUsd(characters))} au tarif API d'eleven_v4 (un appel facturé, déduit de ton quota ElevenLabs).`,
        voice ? (stale ? "La voix actuelle, périmée, sera remplacée." : "La voix actuelle sera remplacée.") : "",
      ]
        .filter(Boolean)
        .join(" "),
      confirmLabel: voice ? "Régénérer" : "Générer",
      cancelLabel: "Annuler",
    });
    if (!ok) return;

    setBusy(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/voice`, { method: "POST" });
      if (response.status === 401) return router.replace("/connexion");
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.project?.voice) {
        await modal.error({
          title: "Voix impossible à générer",
          body: VOICE_ERRORS[data?.error] ?? "La voix n'a pas pu être générée. Réessaie dans un instant.",
        });
        return;
      }
      setVoice(data.project.voice);
      setAudio(data.audio ?? null);
      retried.current = false;
      // Met à jour le statut affiché par la page serveur.
      router.refresh();
    } catch {
      await modal.error({ title: "Voix impossible à générer", body: "La connexion au serveur a échoué. Vérifie ta connexion et réessaie." });
    } finally {
      setBusy(false);
    }
  };

  if (!script) {
    return (
      <section className="mt-10 rounded-lg border border-line px-6 py-8 text-center">
        <Mic className="mx-auto size-6 text-quiet" aria-hidden />
        <p className="mt-3 text-sm font-medium">Voix</p>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted">La voix sera disponible une fois le script écrit.</p>
      </section>
    );
  }

  const stale = voice ? isVoiceStale(voice, script) : false;
  const characters = voiceText(script).length;
  const buttonIcon = busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : voice ? <RefreshCw className="size-4" aria-hidden /> : <Mic className="size-4" aria-hidden />;
  const buttonLabel = busy ? "Génération en cours…" : voice ? "Régénérer la voix" : "Générer la voix";

  if (!voice) {
    return (
      <section className="mt-10 rounded-lg border border-line" aria-busy={busy}>
        <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
          <Mic className="size-6 text-quiet" aria-hidden />
          <p className="text-sm font-medium">Voix</p>
          <p className="max-w-sm text-sm text-muted">
            ElevenLabs lit le script enregistré avec la voix de Chris. {characters.toLocaleString("fr-FR")} caractères, environ{" "}
            {formatUsd(estimateVoiceCostUsd(characters))}.
          </p>
          <button type="button" onClick={generate} disabled={busy} className={`${buttonPrimary} mt-2`}>
            {buttonIcon}
            {buttonLabel}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="mt-10 flex flex-col gap-4" aria-busy={busy}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <AudioLines className="size-4 text-quiet" aria-hidden />
          Voix
        </h2>
        <button type="button" onClick={generate} disabled={busy} className={stale ? buttonPrimary : buttonSecondary}>
          {buttonIcon}
          {buttonLabel}
        </button>
      </div>

      <div
        className={`flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border px-4 py-3 text-sm ${stale ? "border-danger/60" : "border-line"}`}
        aria-live="polite"
      >
        <span className="tabular-nums">
          <span className="text-quiet">Durée réelle </span>
          {formatSeconds(voice.durationSeconds)}
          <span className="text-quiet"> / cible {formatSeconds(script.targetSeconds)}</span>
        </span>
        <span className="tabular-nums">
          <span className="text-quiet">Caractères </span>
          {voice.characters.toLocaleString("fr-FR")}
        </span>
        <span className={`ml-auto inline-flex items-center gap-1.5 ${stale ? "text-danger" : "text-ready"}`}>
          {stale ? <AlertTriangle className="size-4" aria-hidden /> : <Check className="size-4" aria-hidden />}
          {stale ? "Voix périmée : le script a changé" : "À jour avec le script"}
        </span>
      </div>

      {audio ? (
        <audio key={audio.url} controls preload="metadata" src={audio.url} onError={onAudioError} className="w-full">
          Ton navigateur ne lit pas l&apos;audio.
        </audio>
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted">
          <LoaderCircle className="size-4 animate-spin" aria-hidden />
          Chargement du lecteur…
        </p>
      )}

      {voice.scenes.length > 0 && (
        <ol className="grid gap-px overflow-hidden rounded-lg border border-line bg-line text-xs sm:grid-cols-2">
          {voice.scenes.map((timing, index) => (
            <li key={index} className="flex justify-between gap-3 bg-black px-4 py-2 tabular-nums">
              <span className="text-quiet">Scène {index + 1}</span>
              <span>
                {formatSeconds(timing.start)} → {formatSeconds(timing.end)}
              </span>
            </li>
          ))}
        </ol>
      )}

      <p className="text-xs text-quiet">
        {voice.model} · générée le{" "}
        {formatDate(voice.generatedAt)} · lien d&apos;écoute privé, valable
        15 min.
      </p>
    </section>
  );
}
