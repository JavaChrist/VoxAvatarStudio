"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Clapperboard, Clock, LoaderCircle, RefreshCw, Video } from "lucide-react";
import type { Appearance } from "@/features/projects/appearance";
import { formatDate } from "@/features/projects/ProjectStatusBadge";
import type { VideoFormat } from "@/features/projects/schema";
import type { Script } from "@/features/projects/script";
import {
  estimateAvatarCostUsd,
  estimateAvatarMinutes,
  isAvatarPending,
  isAvatarStale,
  isAvatarStalled,
  type AvatarVideo,
  type AvatarVideos,
} from "@/features/projects/video";
import { isVoiceStale, type Voice } from "@/features/projects/voice";
import { buttonPrimary, buttonSecondary } from "@/ui/buttons";
import { quietPlayer } from "@/ui/media";
import { useModal } from "@/ui/modal/ModalProvider";

/** Messages affichés pour chaque code d'erreur renvoyé par l'API. */
const VIDEO_ERRORS: Record<string, string> = {
  not_configured: "La clé fal.ai n'est pas configurée sur le serveur.",
  format_invalid: "Ce format n'est pas prévu pour ce projet.",
  voice_missing: "Ce projet n'a pas encore de voix. Génère-la d'abord.",
  voice_stale: "La voix ne correspond plus au script. Régénère la voix avant la vidéo.",
  in_progress: "Une génération est déjà en cours pour ce projet. Patiente quelques secondes.",
  already_running: "Une vidéo est déjà en cours pour ce format.",
  reference_missing: "L'image de référence de Chris est introuvable dans Storage (npm run upload:character).",
  provider_busy: "fal.ai est saturé pour le moment. Réessaie dans une minute.",
  provider_error: "Le service fal.ai ne répond pas pour le moment. Réessaie dans un instant.",
};

/** Intervalle de suivi tant qu'une vidéo est en cours chez fal (le suivi est gratuit). */
const POLL_MS = 15_000;

/** Classes d'aspect du lecteur pour chaque format. */
const ASPECT: Record<VideoFormat, string> = { "9:16": "aspect-[9/16] max-w-[280px]", "4:5": "aspect-[4/5] max-w-[360px]", "1:1": "aspect-square max-w-[400px]" };

const formatUsd = (amount: number) =>
  amount.toLocaleString("fr-FR", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatSeconds = (seconds: number) => `${seconds.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} s`;

type PlaybackUrls = Partial<Record<VideoFormat, { url: string; expiresAt: string }>>;
type VideoState = { status: string; avatars: AvatarVideos; urls: PlaybackUrls };

/** Suivi gratuit : le serveur interroge fal, copie les vidéos terminées et renvoie des liens de lecture. */
async function fetchVideoState(projectId: string): Promise<VideoState | "unauthorized" | null> {
  try {
    const response = await fetch(`/api/projects/${projectId}/video`, { cache: "no-store" });
    if (response.status === 401) return "unauthorized";
    return response.ok ? ((await response.json()) as VideoState) : null;
  } catch {
    // Réseau coupé : le prochain suivi réessaiera.
    return null;
  }
}

interface Props {
  projectId: string;
  formats: VideoFormat[];
  script: Script | null;
  voice: Voice | null;
  /** Tenue et pose actuelles de Chris dans ce projet. */
  appearance: Appearance;
  initialAvatars: AvatarVideos;
}

export function VideoPanel({ projectId, formats, script, voice, appearance, initialAvatars }: Props) {
  const router = useRouter();
  const modal = useModal();
  const [avatars, setAvatars] = useState<AvatarVideos>(initialAvatars);
  const [urls, setUrls] = useState<PlaybackUrls>({});
  const [starting, setStarting] = useState<VideoFormat | null>(null);
  // Un seul renouvellement automatique du lien de lecture par format, pour ne pas boucler si le fichier est absent.
  const retried = useRef(new Set<VideoFormat>());
  const lastStatus = useRef<string | null>(null);

  /** Applique l'état renvoyé par le suivi. */
  const apply = useCallback(
    (data: VideoState) => {
      setAvatars(data.avatars);
      setUrls(data.urls);
      // Une vidéo vient de se terminer : la page serveur met à jour le statut du projet.
      if (lastStatus.current !== null && lastStatus.current !== data.status) router.refresh();
      lastStatus.current = data.status;
    },
    [router],
  );

  const poll = useCallback(
    () =>
      fetchVideoState(projectId).then((data) => {
        if (data === "unauthorized") router.replace("/connexion");
        else if (data) apply(data);
      }),
    [projectId, router, apply],
  );

  const pending = Object.values(avatars).some((video) => isAvatarPending(video) && !isAvatarStalled(video));
  const hasAny = Object.keys(avatars).length > 0;

  // Premier suivi au chargement (liens de lecture demandés dans le navigateur, jamais dans le HTML serveur).
  const mounted = useRef(hasAny);
  useEffect(() => {
    if (!mounted.current) return;
    mounted.current = false;
    void poll();
  }, [poll]);

  // Suivi régulier tant qu'une vidéo est en cours, en pause quand l'onglet est masqué.
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void poll();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [pending, poll]);

  const onVideoError = (format: VideoFormat) => {
    // Lien expiré (15 min) : on en redemande un une fois.
    if (retried.current.has(format)) return;
    retried.current.add(format);
    void poll();
  };

  const start = async (format: VideoFormat) => {
    if (!voice) return;
    const current = avatars[format];
    const cost = formatUsd(estimateAvatarCostUsd(voice.durationSeconds));
    const minutes = estimateAvatarMinutes(voice.durationSeconds);
    const ok = await modal.confirm({
      title: current ? `Relancer la vidéo ${format} ?` : `Générer la vidéo ${format} ?`,
      body: [
        `Kling AI Avatar v2 Pro (fal.ai) anime Chris sur fond vert avec la voix de ${formatSeconds(voice.durationSeconds)}.`,
        `Coût estimé : environ ${cost} (0,115 $ par seconde de vidéo, fin silencieuse comprise), un appel facturé sur ton compte fal.`,
        `Durée estimée : environ ${minutes} min. Tu peux quitter la page ou fermer l'application : la vidéo est récupérée automatiquement dès qu'elle est prête.`,
        current?.state === "done" ? "La vidéo actuelle de ce format sera remplacée." : "",
      ]
        .filter(Boolean)
        .join(" "),
      confirmLabel: current ? "Relancer" : "Générer",
      cancelLabel: "Annuler",
    });
    if (!ok) return;

    setStarting(format);
    try {
      const response = await fetch(`/api/projects/${projectId}/video`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ format }),
      });
      if (response.status === 401) return router.replace("/connexion");
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.project?.avatars) {
        await modal.error({
          title: "Vidéo impossible à lancer",
          body: VIDEO_ERRORS[data?.error] ?? "La vidéo n'a pas pu être lancée. Réessaie dans un instant.",
        });
        return;
      }
      setAvatars(data.project.avatars);
      retried.current.delete(format);
      router.refresh();
    } catch {
      await modal.error({ title: "Vidéo impossible à lancer", body: "La connexion au serveur a échoué. Vérifie ta connexion et réessaie." });
    } finally {
      setStarting(null);
    }
  };

  if (!voice || !script) {
    return (
      <section className="mt-10 rounded-lg border border-line px-6 py-8 text-center">
        <Video className="mx-auto size-6 text-quiet" aria-hidden />
        <p className="mt-3 text-sm font-medium">Vidéo</p>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted">La vidéo sera disponible une fois la voix générée.</p>
      </section>
    );
  }

  const voiceStale = isVoiceStale(voice, script);

  return (
    <section className="mt-10 flex flex-col gap-4" aria-busy={pending || starting !== null}>
      <h2 className="flex items-center gap-2 text-sm font-medium">
        <Clapperboard className="size-4 text-quiet" aria-hidden />
        Vidéo
      </h2>

      {voiceStale && (
        <p className="flex items-center gap-2 rounded-lg border border-danger/60 px-4 py-3 text-sm text-danger">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          La voix ne correspond plus au script : régénère-la avant de lancer une vidéo.
        </p>
      )}

      <ul className="flex flex-col gap-4">
        {formats.map((format) => (
          <FormatRow
            key={format}
            format={format}
            video={avatars[format]}
            voice={voice}
            appearance={appearance}
            url={urls[format]?.url}
            disabled={voiceStale || starting !== null}
            starting={starting === format}
            onStart={() => start(format)}
            onVideoError={() => onVideoError(format)}
          />
        ))}
      </ul>

      <p className="text-xs text-quiet">
        Kling AI Avatar v2 Pro via fal.ai · fond vert, le détourage viendra au montage · lien de lecture privé, valable 15 min.
      </p>
    </section>
  );
}

interface RowProps {
  format: VideoFormat;
  video: AvatarVideo | undefined;
  voice: Voice;
  appearance: Appearance;
  url: string | undefined;
  disabled: boolean;
  starting: boolean;
  onStart: () => void;
  onVideoError: () => void;
}

function FormatRow({ format, video, voice, appearance, url, disabled, starting, onStart, onVideoError }: RowProps) {
  const stalled = video ? isAvatarStalled(video) : false;
  const pending = video ? isAvatarPending(video) && !stalled : false;
  const stale = video ? isAvatarStale(video, voice, appearance) : false;
  const canStart = !pending && !disabled;

  const button = (
    <button type="button" onClick={onStart} disabled={!canStart} className={!video || stale || video.state === "failed" || stalled ? buttonPrimary : buttonSecondary}>
      {starting ? (
        <LoaderCircle className="size-4 animate-spin" aria-hidden />
      ) : video ? (
        <RefreshCw className="size-4" aria-hidden />
      ) : (
        <Video className="size-4" aria-hidden />
      )}
      {starting ? "Lancement…" : video ? "Relancer" : `Générer (${formatUsd(estimateAvatarCostUsd(voice.durationSeconds))})`}
    </button>
  );

  return (
    <li className={`rounded-lg border ${stale && video?.state === "done" ? "border-danger/60" : "border-line"}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-sm font-medium tabular-nums">{format}</span>
          <RowStatus video={video} voice={voice} stalled={stalled} stale={stale} />
        </div>
        {!pending && button}
      </div>

      {video?.state === "done" && (
        <div className="border-t border-line p-4">
          {url ? (
            <video
              key={url}
              ref={quietPlayer}
              controls
              playsInline
              preload="metadata"
              src={url}
              onError={onVideoError}
              className={`mx-auto w-full rounded-md bg-surface ${ASPECT[format]}`}
            >
              Ton navigateur ne lit pas la vidéo.
            </video>
          ) : (
            <p className="flex items-center gap-2 text-sm text-muted">
              <LoaderCircle className="size-4 animate-spin" aria-hidden />
              Chargement du lecteur…
            </p>
          )}
        </div>
      )}
    </li>
  );
}

function RowStatus({ video, voice, stalled, stale }: { video: AvatarVideo | undefined; voice: Voice; stalled: boolean; stale: boolean }) {
  if (!video) {
    return (
      <span className="text-xs text-muted tabular-nums">
        Pas encore générée · environ {estimateAvatarMinutes(voice.durationSeconds)} min de génération
      </span>
    );
  }
  if (stalled) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-danger" aria-live="polite">
        <AlertTriangle className="size-3.5" aria-hidden />
        Toujours pas de vidéo (lancée le {formatDate(video.submittedAt)}) : recharge la page pour revérifier chez fal avant de relancer.
      </span>
    );
  }
  if (isAvatarPending(video) && video.falOutput) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-accent-soft" aria-live="polite">
        <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
        Vidéo générée chez fal, récupération en cours
      </span>
    );
  }
  if (video.state === "queued" || video.state === "running") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-accent-soft tabular-nums" aria-live="polite">
        {video.state === "queued" ? <Clock className="size-3.5" aria-hidden /> : <LoaderCircle className="size-3.5 animate-spin" aria-hidden />}
        {video.state === "queued" ? "En file d'attente chez fal" : "Génération en cours"} · lancée le {formatDate(video.submittedAt)} · environ{" "}
        {estimateAvatarMinutes(video.voiceSeconds)} min, {formatUsd(video.estimatedCostUsd)} estimés
      </span>
    );
  }
  if (video.state === "failed") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-danger" aria-live="polite">
        <AlertTriangle className="size-3.5" aria-hidden />
        {video.error ?? "La génération a échoué."}
      </span>
    );
  }
  return (
    <span className={`inline-flex flex-wrap items-center gap-x-1.5 text-xs tabular-nums ${stale ? "text-danger" : "text-ready"}`} aria-live="polite">
      {stale ? <AlertTriangle className="size-3.5" aria-hidden /> : <Check className="size-3.5" aria-hidden />}
      {stale ? "Périmée : la voix a changé" : "Prête"}
      <span className="text-quiet">
        · {video.durationSeconds !== null ? formatSeconds(video.durationSeconds) : "durée inconnue"}
        {video.costUsd !== null && ` · ${formatUsd(video.costUsd)}`}
        {video.completedAt && ` · le ${formatDate(video.completedAt)}`}
      </span>
    </span>
  );
}
