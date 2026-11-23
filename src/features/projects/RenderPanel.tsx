"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Clock, Download, Film, LoaderCircle, Plus, RefreshCw, Scissors } from "lucide-react";
import type { BackgroundView } from "@/features/backgrounds/schema";
import { MUSIC_VOLUME_DEFAULT, MUSIC_VOLUME_MAX, MUSIC_VOLUME_MIN, parseMusicVolume, type MusicView } from "@/features/music/schema";
import { formatDate } from "@/features/projects/ProjectStatusBadge";
import {
  RENDER_ESTIMATED_MINUTES,
  isRenderPending,
  isRenderStale,
  isRenderStalled,
  lastBackgroundId,
  lastMusic,
  lastSignatureId,
  type ProjectRender,
  type ProjectRenders,
} from "@/features/projects/render";
import type { VideoFormat } from "@/features/projects/schema";
import type { SignatureOverrideView } from "@/features/projects/signature-override";
import { SignatureOverridePanel, type OverrideState } from "@/features/projects/SignatureOverridePanel";
import type { Appearance } from "@/features/projects/appearance";
import { isAvatarStale, type AvatarVideo, type AvatarVideos } from "@/features/projects/video";
import type { Voice } from "@/features/projects/voice";
import { SignatureDialog } from "@/features/signatures/SignatureDialog";
import { SIGNATURE_SECONDS, type SignatureView } from "@/features/signatures/schema";
import { buttonPrimary, buttonSecondary } from "@/ui/buttons";
import { quietPlayer } from "@/ui/media";
import { useModal } from "@/ui/modal/ModalProvider";
import { Select } from "@/ui/Select";

/** Messages affichés pour chaque code d'erreur renvoyé par l'API. */
const RENDER_ERRORS: Record<string, string> = {
  not_configured: "Le jeton GitHub du rendu n'est pas configuré sur le serveur (GITHUB_RENDER_TOKEN).",
  format_invalid: "Ce format n'est pas prévu pour ce projet.",
  avatar_missing: "La vidéo de Chris de ce format n'est pas encore prête.",
  avatar_stale: "La vidéo de Chris ne correspond plus à la voix. Relance-la avant le montage.",
  voice_stale: "La voix ne correspond plus au script. Régénère la voix, puis la vidéo.",
  too_long: "La vidéo dépasse la durée maximale du montage (120 s).",
  in_progress: "Une génération ou un rendu est déjà en cours pour ce projet. Patiente quelques secondes.",
  already_running: "Un rendu est déjà en cours pour ce format.",
  provider_error: "GitHub Actions ne répond pas pour le moment. Réessaie dans un instant.",
  signature_not_found: "Cette signature n'existe plus. Recharge la page et choisis-en une autre.",
  background_not_found: "Ce fond n'existe plus. Recharge la page et choisis-en un autre.",
  music_not_found: "Cette musique n'existe plus. Recharge la page et choisis-en une autre.",
};

/** Signature proposée au montage, avec son lien de logo pour l'aperçu ; le serveur relit tout au lancement. */
export type SignatureChoice = SignatureView;

/** Fond proposé au montage, avec son lien d'aperçu ; le serveur revérifie le propriétaire au lancement. */
export type BackgroundChoice = BackgroundView;

/** Musique proposée au montage, avec son lien d'écoute ; le serveur revérifie le propriétaire au lancement. */
export type MusicChoice = MusicView;

/** Intervalle de suivi tant qu'un rendu tourne (le suivi est gratuit). */
const POLL_MS = 15_000;

/** Classes d'aspect du lecteur pour chaque format. */
const ASPECT: Record<VideoFormat, string> = { "9:16": "aspect-[9/16] max-w-[280px]", "4:5": "aspect-[4/5] max-w-[360px]", "1:1": "aspect-square max-w-[400px]" };

const formatMegabytes = (bytes: number) => `${(bytes / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`;

type RenderLinks = Partial<Record<VideoFormat, { url: string; downloadUrl: string; expiresAt: string }>>;
type RenderStateResponse = { status: string; renders: ProjectRenders; urls: RenderLinks };

/** Suivi gratuit : le serveur lit le résultat du workflow et renvoie des liens de lecture et de téléchargement. */
async function fetchRenderState(projectId: string): Promise<RenderStateResponse | "unauthorized" | null> {
  try {
    const response = await fetch(`/api/projects/${projectId}/render`, { cache: "no-store" });
    if (response.status === 401) return "unauthorized";
    return response.ok ? ((await response.json()) as RenderStateResponse) : null;
  } catch {
    // Réseau coupé : le prochain suivi réessaiera.
    return null;
  }
}

/** Vidéo de Chris utilisable pour le montage : terminée, faite avec la voix et l'apparence actuelles. */
const isAvatarReady = (avatar: AvatarVideo | undefined, voice: Voice | null, appearance: Appearance): avatar is AvatarVideo =>
  !!avatar && avatar.state === "done" && !isAvatarStale(avatar, voice, appearance);

interface Props {
  projectId: string;
  formats: VideoFormat[];
  voice: Voice | null;
  /** Tenue et pose actuelles de Chris dans ce projet. */
  appearance: Appearance;
  avatars: AvatarVideos;
  initialRenders: ProjectRenders;
  /** null : la liste n'a pas pu être chargée, le montage reste possible sans signature. */
  signatures: SignatureChoice[] | null;
  /** null : la liste n'a pas pu être chargée, le montage reste possible avec le dégradé. */
  backgrounds: BackgroundChoice[] | null;
  /** null : la liste n'a pas pu être chargée, le montage reste possible sans musique. */
  music: MusicChoice[] | null;
  /** Accroche, QR code et logo propres à ce projet. */
  initialOverride: SignatureOverrideView;
}

export function RenderPanel({ projectId, formats, voice, appearance, avatars, initialRenders, signatures: initialSignatures, backgrounds, music, initialOverride }: Props) {
  const router = useRouter();
  const modal = useModal();
  const [renders, setRenders] = useState<ProjectRenders>(initialRenders);
  const [urls, setUrls] = useState<RenderLinks>({});
  const [starting, setStarting] = useState<VideoFormat | null>(null);
  // Liste locale : une signature créée depuis le montage y apparaît sans recharger la page.
  const [signatures, setSignatures] = useState(initialSignatures);
  const [creatingSignature, setCreatingSignature] = useState(false);
  // Par défaut, la signature du dernier rendu lancé, si elle existe encore ; "" : aucune.
  const [signatureId, setSignatureId] = useState(() => {
    const last = lastSignatureId(initialRenders);
    return last && initialSignatures?.some((s) => s.id === last) ? last : "";
  });
  // Par défaut, le fond du dernier rendu lancé, s'il existe encore ; "" : dégradé par défaut.
  const [backgroundId, setBackgroundId] = useState(() => {
    const last = lastBackgroundId(initialRenders);
    return last && backgrounds?.some((b) => b.id === last) ? last : "";
  });
  // Par défaut, la musique et le volume du dernier rendu lancé, si la musique existe encore ; "" : aucune.
  const [musicId, setMusicId] = useState(() => {
    const last = lastMusic(initialRenders).id;
    return last && music?.some((m) => m.id === last) ? last : "";
  });
  const [musicVolume, setMusicVolume] = useState(() => parseMusicVolume(lastMusic(initialRenders).volume) ?? MUSIC_VOLUME_DEFAULT);
  const [override, setOverride] = useState(initialOverride);
  const [overrideState, setOverrideState] = useState<OverrideState>({ dirty: false, busy: false });
  const base = signatures?.find((signature) => signature.id === signatureId) ?? null;
  // Un seul renouvellement automatique du lien de lecture par format, pour ne pas boucler si le fichier est absent.
  const retried = useRef(new Set<VideoFormat>());
  const lastStatus = useRef<string | null>(null);

  const apply = useCallback(
    (data: RenderStateResponse) => {
      setRenders(data.renders);
      setUrls(data.urls);
      // Un rendu vient de se terminer : la page serveur met à jour le statut du projet.
      if (lastStatus.current !== null && lastStatus.current !== data.status) router.refresh();
      lastStatus.current = data.status;
    },
    [router],
  );

  const poll = useCallback(
    () =>
      fetchRenderState(projectId).then((data) => {
        if (data === "unauthorized") router.replace("/connexion");
        else if (data) apply(data);
      }),
    [projectId, router, apply],
  );

  const pending = Object.values(renders).some((render) => isRenderPending(render) && !isRenderStalled(render));
  const hasAny = Object.keys(renders).length > 0;

  // Premier suivi au chargement (liens demandés dans le navigateur, jamais dans le HTML serveur).
  const mounted = useRef(hasAny);
  useEffect(() => {
    if (!mounted.current) return;
    mounted.current = false;
    void poll();
  }, [poll]);

  // Suivi régulier tant qu'un rendu tourne, en pause quand l'onglet est masqué.
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
    const current = renders[format];
    // Les réglages de la vidéo comptent seulement une fois enregistrés.
    if (base && overrideState.dirty) {
      const ok = await modal.confirm({
        title: "Réglages non enregistrés",
        body: "Les modifications de « Personnaliser pour cette vidéo » ne sont pas enregistrées. Le montage utilisera les derniers réglages enregistrés.",
        confirmLabel: "Monter quand même",
        cancelLabel: "Annuler",
      });
      if (!ok) return;
    }
    // Le rendu est gratuit : on ne confirme que s'il remplace une vidéo finale existante.
    if (current?.state === "done") {
      const ok = await modal.confirm({
        title: `Refaire le montage ${format} ?`,
        body: `La vidéo finale actuelle de ce format sera remplacée. Le rendu tourne sur GitHub Actions (gratuit) et prend environ ${RENDER_ESTIMATED_MINUTES} min.`,
        confirmLabel: "Refaire",
        cancelLabel: "Annuler",
      });
      if (!ok) return;
    }

    setStarting(format);
    try {
      const response = await fetch(`/api/projects/${projectId}/render`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          format,
          signatureId: signatureId || null,
          backgroundId: backgroundId || null,
          musicId: musicId || null,
          musicVolume,
        }),
      });
      if (response.status === 401) return router.replace("/connexion");
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.project?.renders) {
        await modal.error({
          title: "Montage impossible à lancer",
          body: RENDER_ERRORS[data?.error] ?? "Le montage n'a pas pu être lancé. Réessaie dans un instant.",
        });
        return;
      }
      setRenders(data.project.renders);
      retried.current.delete(format);
      router.refresh();
    } catch {
      await modal.error({ title: "Montage impossible à lancer", body: "La connexion au serveur a échoué. Vérifie ta connexion et réessaie." });
    } finally {
      setStarting(null);
    }
  };

  // La nouvelle signature est choisie aussitôt pour ce montage.
  const signatureCreated = (signature: SignatureView) => {
    setSignatures((current) =>
      [...(current ?? []).filter((s) => s.id !== signature.id), signature].sort((a, b) => a.name.localeCompare(b.name, "fr")),
    );
    setSignatureId(signature.id);
  };

  const anyAvatarReady = formats.some((format) => isAvatarReady(avatars[format], voice, appearance));
  if (!anyAvatarReady && !hasAny) {
    return (
      <section className="mt-10 rounded-lg border border-line px-6 py-8 text-center">
        <Film className="mx-auto size-6 text-quiet" aria-hidden />
        <p className="mt-3 text-sm font-medium">Montage</p>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted">Le montage sera disponible une fois une vidéo de Chris prête.</p>
      </section>
    );
  }

  return (
    <section className="mt-10 flex flex-col gap-4" aria-busy={pending || starting !== null}>
      <h2 className="flex items-center gap-2 text-sm font-medium">
        <Film className="size-4 text-quiet" aria-hidden />
        Montage
      </h2>

      <BackgroundPicker backgrounds={backgrounds} value={backgroundId} onChange={setBackgroundId} disabled={starting !== null} />

      <MusicPicker
        music={music}
        value={musicId}
        onChange={setMusicId}
        volume={musicVolume}
        onVolumeChange={setMusicVolume}
        disabled={starting !== null}
      />

      <SignaturePicker
        signatures={signatures}
        value={signatureId}
        onChange={setSignatureId}
        onCreate={() => setCreatingSignature(true)}
        disabled={starting !== null}
      />

      {creatingSignature && <SignatureDialog onCreated={signatureCreated} onClose={() => setCreatingSignature(false)} />}

      {base && (
        <SignatureOverridePanel
          projectId={projectId}
          base={base}
          saved={override}
          disabled={starting !== null}
          onSaved={setOverride}
          onStateChange={setOverrideState}
        />
      )}

      <ul className="flex flex-col gap-4">
        {formats.map((format) => (
          <RenderRow
            key={format}
            format={format}
            render={renders[format]}
            avatar={avatars[format]}
            voice={voice}
            appearance={appearance}
            link={urls[format]}
            disabled={starting !== null || overrideState.busy}
            starting={starting === format}
            onStart={() => start(format)}
            onVideoError={() => onVideoError(format)}
          />
        ))}
      </ul>

      <p className="text-xs text-quiet">
        Détourage du fond vert et montage Remotion (fond, titre, sous-titres mot à mot, signature de fin) sur GitHub Actions · gratuit ·
        liens privés, valables 15 min.
      </p>
    </section>
  );
}

interface RowProps {
  format: VideoFormat;
  render: ProjectRender | undefined;
  avatar: AvatarVideo | undefined;
  voice: Voice | null;
  appearance: Appearance;
  link: { url: string; downloadUrl: string } | undefined;
  disabled: boolean;
  starting: boolean;
  onStart: () => void;
  onVideoError: () => void;
}

function RenderRow({ format, render, avatar, voice, appearance, link, disabled, starting, onStart, onVideoError }: RowProps) {
  const ready = isAvatarReady(avatar, voice, appearance);
  const stalled = render ? isRenderStalled(render) : false;
  const pending = render ? isRenderPending(render) && !stalled : false;
  const stale = render?.state === "done" && isRenderStale(render, avatar, voice, appearance);
  const canStart = ready && !pending && !disabled;
  const primary = !render || stale || render.state === "failed" || stalled;

  const button = (
    <button type="button" onClick={onStart} disabled={!canStart} className={primary ? buttonPrimary : buttonSecondary}>
      {starting ? (
        <LoaderCircle className="size-4 animate-spin" aria-hidden />
      ) : render ? (
        <RefreshCw className="size-4" aria-hidden />
      ) : (
        <Scissors className="size-4" aria-hidden />
      )}
      {starting ? "Lancement…" : render ? "Refaire" : "Monter"}
    </button>
  );

  return (
    <li className={`rounded-lg border ${stale ? "border-danger/60" : "border-line"}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-sm font-medium tabular-nums">{format}</span>
          <RenderStatus render={render} ready={ready} stalled={stalled} stale={stale} />
        </div>
        {!pending && (
          <div className="flex flex-wrap items-center gap-2">
            {render?.state === "done" && link && (
              <a href={link.downloadUrl} className={buttonSecondary}>
                <Download className="size-4" aria-hidden />
                Télécharger
              </a>
            )}
            {button}
          </div>
        )}
      </div>

      {render?.state === "done" && (
        <div className="border-t border-line p-4">
          {link ? (
            <video
              key={link.url}
              ref={quietPlayer}
              controls
              playsInline
              preload="metadata"
              src={link.url}
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

function BackgroundPicker({
  backgrounds,
  value,
  onChange,
  disabled,
}: {
  backgrounds: BackgroundChoice[] | null;
  value: string;
  onChange: (id: string) => void;
  disabled: boolean;
}) {
  const manage = (
    <Link href="/fonds" className="text-xs text-muted underline-offset-4 transition-colors duration-150 hover:text-ink hover:underline">
      Gérer les fonds
    </Link>
  );
  if (backgrounds === null) {
    return <p className="text-xs text-muted">Fonds indisponibles pour le moment : le montage utilisera le dégradé par défaut.</p>;
  }
  if (backgrounds.length === 0) {
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted">
        <span>Fond : dégradé par défaut. Importe une image pour la placer derrière Chris.</span>
        {manage}
      </div>
    );
  }
  const selected = backgrounds.find((background) => background.id === value) ?? null;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="render-background" className="text-sm font-medium">
        Fond
      </label>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="aspect-[9/16] w-10 shrink-0 overflow-hidden rounded-md border border-line bg-[radial-gradient(circle_at_50%_30%,#3a1d08,#0b0b0c_70%)]">
          {selected?.imageUrl && (
            // URL signée temporaire de Storage : pas d'optimisation next/image.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={selected.imageUrl} alt="" className="size-full object-cover" />
          )}
        </div>
        <Select
          id="render-background"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          aria-describedby="render-background-hint"
          className="max-w-xs"
        >
          <option value="">Dégradé par défaut</option>
          {backgrounds.map((background) => (
            <option key={background.id} value={background.id}>
              {background.name}
            </option>
          ))}
        </Select>
        {manage}
      </div>
      <p id="render-background-hint" className="text-xs text-quiet">
        Image derrière Chris détouré, recadrée pour remplir l&apos;écran, pour les prochains montages.
      </p>
    </div>
  );
}

function MusicPicker({
  music,
  value,
  onChange,
  volume,
  onVolumeChange,
  disabled,
}: {
  music: MusicChoice[] | null;
  value: string;
  onChange: (id: string) => void;
  volume: number;
  onVolumeChange: (volume: number) => void;
  disabled: boolean;
}) {
  const manage = (
    <Link href="/musiques" className="text-xs text-muted underline-offset-4 transition-colors duration-150 hover:text-ink hover:underline">
      Gérer les musiques
    </Link>
  );
  if (music === null) {
    return <p className="text-xs text-muted">Musiques indisponibles pour le moment : le montage se fera sans musique.</p>;
  }
  if (music.length === 0) {
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted">
        <span>Musique : aucune. Importe une piste pour la jouer sous la voix de Chris.</span>
        {manage}
      </div>
    );
  }
  const selected = music.find((track) => track.id === value) ?? null;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="render-music" className="text-sm font-medium">
        Musique
      </label>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Select
          id="render-music"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          aria-describedby="render-music-hint"
          className="max-w-xs"
        >
          <option value="">Aucune</option>
          {music.map((track) => (
            <option key={track.id} value={track.id}>
              {track.name}
            </option>
          ))}
        </Select>
        {manage}
      </div>
      {selected && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label htmlFor="render-music-volume" className="text-xs text-muted">
            Volume sous la voix
          </label>
          <input
            id="render-music-volume"
            type="range"
            min={MUSIC_VOLUME_MIN}
            max={MUSIC_VOLUME_MAX}
            step={5}
            value={volume}
            onChange={(event) => onVolumeChange(Number(event.target.value))}
            disabled={disabled}
            className="w-40 cursor-pointer accent-accent disabled:cursor-not-allowed disabled:opacity-50"
          />
          <span className="w-10 text-xs tabular-nums text-muted">{volume} %</span>
          {selected.trackUrl && (
            <audio key={selected.id} ref={quietPlayer} controls preload="none" src={selected.trackUrl} className="h-9 w-full max-w-xs">
              <track kind="captions" />
            </audio>
          )}
        </div>
      )}
      <p id="render-music-hint" className="text-xs text-quiet">
        Jouée en boucle, avec une entrée et une sortie en fondu, discrète sous la voix et plus présente sur la signature de fin.
      </p>
    </div>
  );
}

function SignaturePicker({
  signatures,
  value,
  onChange,
  onCreate,
  disabled,
}: {
  signatures: SignatureChoice[] | null;
  value: string;
  onChange: (id: string) => void;
  onCreate: () => void;
  disabled: boolean;
}) {
  const manage = (
    <>
      <button type="button" onClick={onCreate} disabled={disabled} className={buttonSecondary}>
        <Plus className="size-4" aria-hidden />
        Nouvelle signature
      </button>
      <Link href="/signatures" className="text-xs text-muted underline-offset-4 transition-colors duration-150 hover:text-ink hover:underline">
        Gérer les signatures
      </Link>
    </>
  );
  if (signatures === null) {
    return <p className="text-xs text-muted">Signatures indisponibles pour le moment : le montage se fera sans signature de fin.</p>;
  }
  if (signatures.length === 0) {
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted">
        <span>Pas encore de signature de fin.</span>
        {manage}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="render-signature" className="text-sm font-medium">
        Signature de fin
      </label>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Select
          id="render-signature"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          aria-describedby="render-signature-hint"
          className="max-w-xs"
        >
          <option value="">Aucune</option>
          {signatures.map((signature) => (
            <option key={signature.id} value={signature.id}>
              {signature.name}
            </option>
          ))}
        </Select>
        {manage}
      </div>
      <p id="render-signature-hint" className="text-xs text-quiet">
        Carte de {SIGNATURE_SECONDS} s après la voix, pour les prochains montages. Les vidéos déjà montées ne changent pas.
      </p>
    </div>
  );
}

function RenderStatus({ render, ready, stalled, stale }: { render: ProjectRender | undefined; ready: boolean; stalled: boolean; stale: boolean }) {
  if (!render) {
    return (
      <span className="text-xs text-muted tabular-nums">
        {ready ? `Pas encore monté · environ ${RENDER_ESTIMATED_MINUTES} min de rendu` : "En attente de la vidéo de Chris pour ce format"}
      </span>
    );
  }
  if (stalled) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-danger" aria-live="polite">
        <AlertTriangle className="size-3.5" aria-hidden />
        Rendu bloqué depuis le {formatDate(render.submittedAt)} : relance-le.
      </span>
    );
  }
  if (render.state === "queued" || render.state === "running") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-accent-soft tabular-nums" aria-live="polite">
        {render.state === "queued" ? <Clock className="size-3.5" aria-hidden /> : <LoaderCircle className="size-3.5 animate-spin" aria-hidden />}
        {render.state === "queued" ? "En attente d'un runner GitHub" : "Rendu en cours"} · lancé le {formatDate(render.submittedAt)} · environ{" "}
        {RENDER_ESTIMATED_MINUTES} min
      </span>
    );
  }
  if (render.state === "failed") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-danger" aria-live="polite">
        <AlertTriangle className="size-3.5" aria-hidden />
        {render.error ?? "Le rendu a échoué."}
      </span>
    );
  }
  return (
    <span className={`inline-flex flex-wrap items-center gap-x-1.5 text-xs tabular-nums ${stale ? "text-danger" : "text-ready"}`} aria-live="polite">
      {stale ? <AlertTriangle className="size-3.5" aria-hidden /> : <Check className="size-3.5" aria-hidden />}
      {stale ? "Périmé : la vidéo de Chris a changé" : "Vidéo finale prête"}
      <span className="text-quiet">
        {render.backgroundName && ` · fond « ${render.backgroundName} »`}
        {render.musicName && ` · musique « ${render.musicName} »${render.musicVolume ? ` (${render.musicVolume} %)` : ""}`}
        {render.signatureName &&
          ` · signature « ${render.signatureName} »${render.signatureCustomized ? " (personnalisée)" : ""}`}
        {render.sizeBytes !== null && ` · ${formatMegabytes(render.sizeBytes)}`}
        {render.renderSeconds !== null && ` · rendu en ${Math.round(render.renderSeconds / 60) || 1} min`}
        {render.completedAt && ` · le ${formatDate(render.completedAt)}`}
      </span>
    </span>
  );
}
