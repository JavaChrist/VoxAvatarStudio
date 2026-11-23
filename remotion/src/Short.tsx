// Montage d'une vidéo courte : fond, Chris détouré, voix, titre d'ouverture, sous-titres mot à mot
// et, si une signature est choisie, carte de fin de SIGNATURE_SECONDS après la voix. Musique de fond en option.
// Images insérées en option : une carte flottante en haut pendant toute sa scène ; Chris rétrécit vers le bas pour lui laisser la place.
import { createTikTokStyleCaptions, type Caption, type TikTokPage } from "@remotion/captions";
import { Audio, Video } from "@remotion/media";
import { useMemo } from "react";
import {
  AbsoluteFill,
  Easing,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  type CalculateMetadataFunction,
} from "remotion";
import { alignmentToCaptions, type Alignment } from "./captions";
import { END_CARD_LAYOUTS, EndCard, SIGNATURE_SECONDS, type EndCardSignature } from "./EndCard";
import { FONT_FAMILY } from "./fonts";

export const FPS = 30;

/** Mêmes formats que l'app ; la vidéo de Chris a déjà le bon ratio (fal suit l'image de référence). */
export const FORMATS = {
  // insertTop et insertHeight : zone de la carte d'image, en fraction de la hauteur. Elle s'arrête au-dessus de la tête
  // de Chris une fois rétréci (sommet à 1 - avatarHeight × AVATAR_INSERT_SCALE), pour que son visage reste visible.
  "9:16": { width: 1080, height: 1920, avatarHeight: 0.86, captionTop: 0.64, titleSize: 68, captionSize: 76, insertTop: 0.06, insertHeight: 0.38 },
  "4:5": { width: 1080, height: 1350, avatarHeight: 0.84, captionTop: 0.66, titleSize: 58, captionSize: 64, insertTop: 0.05, insertHeight: 0.4 },
  "1:1": { width: 1080, height: 1080, avatarHeight: 0.82, captionTop: 0.7, titleSize: 52, captionSize: 58, insertTop: 0.05, insertHeight: 0.41 },
} as const;
export type Format = keyof typeof FORMATS;

/** Pose de Chris : debout (il rétrécit pendant les cartes) ou assis derrière un bureau (taille fixe). */
export type Pose = "standing" | "seated";

/**
 * Chris assis : la vidéo remplit toute l'image (bureau en bas, d'un bord à l'autre) et le haut reste vide,
 * la tête commençant à head_top de scripts/prepare_chris_seated.py. La carte occupe ce vide, les sous-titres le bureau.
 */
const SEATED_LAYOUTS: Record<Format, { avatarHeight: number; captionTop: number; insertTop: number; insertHeight: number }> = {
  "9:16": { avatarHeight: 1, captionTop: 0.85, insertTop: 0.06, insertHeight: 0.31 },
  "4:5": { avatarHeight: 1, captionTop: 0.89, insertTop: 0.05, insertHeight: 0.26 },
  "1:1": { avatarHeight: 1, captionTop: 0.88, insertTop: 0.04, insertHeight: 0.2 },
};

const COLORS = { black: "#0b0b0c", ink: "#ffffff", accent: "#ff7a1a", glow: "#3a1d08" };

/** Durée d'affichage du titre d'ouverture. */
const TITLE_SECONDS = 3;
/** Fondu d'entrée et de sortie de la musique, et montée du volume sur la signature. */
const MUSIC_FADE_IN_FRAMES = FPS;
const MUSIC_FADE_OUT_FRAMES = Math.round(1.5 * FPS);
const MUSIC_RISE_FRAMES = Math.round(0.6 * FPS);
/** Sur la signature, la musique monte à trois fois son niveau sous la voix, sans dépasser le volume d'origine. */
const MUSIC_END_CARD_BOOST = 3;

/** Carte d'image : largeur maximale, entrée et sortie, zoom lent sur toute la scène. */
const INSERT_WIDTH = 0.8;
const INSERT_ANIM_FRAMES = Math.round(0.3 * FPS);
const INSERT_ZOOM = 0.03;
/** En dessous, la carte n'aurait pas le temps d'être lue : elle n'est pas montée. */
const INSERT_MIN_FRAMES = Math.round(0.8 * FPS);
/** Taille de Chris pendant une carte, ancré en bas, et durée du passage d'une taille à l'autre. */
const AVATAR_INSERT_SCALE = 0.62;
const AVATAR_RESIZE_FRAMES = Math.round(0.45 * FPS);

type Window = { from: number; until: number };

/**
 * Plages où Chris est réduit. Deux cartes trop proches pour que Chris ait le temps de regrandir
 * sont fusionnées : il reste petit entre les deux au lieu de faire un aller-retour.
 */
function shrinkWindows(cards: Window[]): Window[] {
  const merged: Window[] = [];
  for (const card of [...cards].sort((a, b) => a.from - b.from)) {
    const last = merged.at(-1);
    if (last && card.from - AVATAR_RESIZE_FRAMES <= last.until + AVATAR_RESIZE_FRAMES) last.until = Math.max(last.until, card.until);
    else merged.push({ ...card });
  }
  return merged;
}

/** Chris rétrécit juste avant l'entrée de la carte et regrandit juste après sa sortie. */
function avatarScale(frame: number, windows: Window[]): number {
  let scale = 1;
  for (const { from, until } of windows) {
    const value = interpolate(
      frame,
      [from - AVATAR_RESIZE_FRAMES, from, until, until + AVATAR_RESIZE_FRAMES],
      [1, AVATAR_INSERT_SCALE, AVATAR_INSERT_SCALE, 1],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) },
    );
    scale = Math.min(scale, value);
  }
  return scale;
}

function Avatar({ src, height, windows }: { src: string; height: number; windows: Window[] }) {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{ top: "auto", height: `${height * 100}%`, transform: `scale(${avatarScale(frame, windows)})`, transformOrigin: "50% 100%" }}
    >
      <Video src={src} muted objectFit="contain" style={{ width: "100%", height: "100%" }} />
    </AbsoluteFill>
  );
}

/** Mots regroupés sur une même page de sous-titres. */
const CAPTION_PAGE_MS = 1200;

export type ShortProps = {
  format: Format;
  title: string;
  /** Vidéo de Chris détourée (WebM VP9 avec alpha), chemin dans public/ ou URL. */
  avatar: string;
  /** Voix ElevenLabs (MP3). */
  audio: string;
  /** Alignement ElevenLabs (JSON), d'où viennent les sous-titres. */
  alignment: string;
  durationSeconds: number;
  /** Image de fond (PNG, JPEG ou WebP), chemin dans public/ ou URL ; absente ou null : dégradé par défaut. */
  background?: string | null;
  /** Musique de fond jouée en boucle ; volume sous la voix entre 0 et 1. Absente ou null : pas de musique. */
  music?: { src: string; volume: number } | null;
  /** Pose de la vidéo de Chris ; absente : debout. */
  pose?: Pose;
  /** Images des scènes, avec le minutage de la scène dans la voix (secondes). Dimensions remplies par calculateMetadata. */
  inserts?: ShortInsert[];
  /** Carte de fin ; absente ou null : la vidéo s'arrête avec la voix. */
  signature?: EndCardSignature | null;
  /** Rempli par calculateMetadata. */
  captions?: Caption[];
};

export type ShortInsert = { src: string; start: number; end: number; width?: number; height?: number };

const resolve = (path: string) => (/^https?:\/\//.test(path) ? path : staticFile(path));

/** Durée de la voix en images : l'avatar, l'audio et les sous-titres s'arrêtent là. */
const voiceFrames = (durationSeconds: number) => Math.max(1, Math.ceil(durationSeconds * FPS));

export const calculateShortMetadata: CalculateMetadataFunction<ShortProps> = async ({ props, abortSignal }) => {
  const response = await fetch(resolve(props.alignment), { signal: abortSignal });
  if (!response.ok) throw new Error(`Alignement introuvable (${response.status})`);
  const alignment = (await response.json()) as Alignment;
  const { width, height } = FORMATS[props.format];
  // Taille réelle de chaque image : la carte épouse ses proportions, coins arrondis compris.
  const inserts = await Promise.all((props.inserts ?? []).map(async (insert) => ({ ...insert, ...(await imageSize(resolve(insert.src))) })));
  return {
    width,
    height,
    fps: FPS,
    durationInFrames: voiceFrames(props.durationSeconds) + (props.signature ? SIGNATURE_SECONDS * FPS : 0),
    props: { ...props, inserts, captions: alignmentToCaptions(alignment) },
  };
};

function imageSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((done, fail) => {
    const image = new Image();
    image.onload = () => done({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => fail(new Error("Image insérée illisible"));
    image.src = src;
  });
}

function Background({ image }: { image: string | null }) {
  if (image) {
    // Recadrée pour remplir toute l'image, quel que soit le format.
    return (
      <AbsoluteFill>
        <Img src={resolve(image)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill
      style={{ background: `radial-gradient(circle at 50% 38%, ${COLORS.glow} 0%, ${COLORS.black} 62%)` }}
    />
  );
}

/**
 * Volume de la musique à une image donnée : fondu d'entrée, niveau discret sous la voix,
 * montée sur la signature de fin, puis fondu de sortie sur les dernières images.
 */
function musicVolume(frame: number, base: number, voiceEnd: number, total: number): number {
  const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
  const level =
    total > voiceEnd
      ? interpolate(frame, [voiceEnd, voiceEnd + MUSIC_RISE_FRAMES], [base, Math.min(1, base * MUSIC_END_CARD_BOOST)], clamp)
      : base;
  const fadeIn = interpolate(frame, [0, MUSIC_FADE_IN_FRAMES], [0, 1], clamp);
  const fadeOut = interpolate(frame, [total - MUSIC_FADE_OUT_FRAMES, total], [1, 0], clamp);
  return level * Math.min(fadeIn, fadeOut);
}

/**
 * Carte flottante d'une image de scène, centrée dans la zone au-dessus des sous-titres.
 * Entrée : fondu, léger agrandissement et montée ; sortie inverse ; zoom lent de l'image pendant la scène.
 */
function InsertCard({ src, width, height, box }: { src: string; width: number; height: number; box: { top: number; width: number; height: number } }) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const anim = Math.max(1, Math.min(INSERT_ANIM_FRAMES, Math.floor(durationInFrames / 3)));
  const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
  const enter = interpolate(frame, [0, anim], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const exit = interpolate(frame, [durationInFrames - anim, durationInFrames], [1, 0], { ...clamp, easing: Easing.in(Easing.cubic) });
  const shown = Math.min(enter, exit);
  const zoom = interpolate(frame, [0, durationInFrames], [1, 1 + INSERT_ZOOM], clamp);
  const scale = Math.min(box.width / width, box.height / height);
  return (
    <AbsoluteFill style={{ top: box.top, height: box.height, bottom: "auto", alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          width: Math.round(width * scale),
          height: Math.round(height * scale),
          borderRadius: 28,
          overflow: "hidden",
          opacity: shown,
          transform: `translateY(${(1 - shown) * 28}px) scale(${interpolate(shown, [0, 1], [0.92, 1])})`,
          boxShadow: "0 24px 64px rgba(0,0,0,0.55), 0 0 0 2px rgba(255,255,255,0.08)",
          backgroundColor: COLORS.black,
        }}
      >
        <Img src={src} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${zoom})` }} />
      </div>
    </AbsoluteFill>
  );
}

function Title({ text, size }: { text: string; size: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 200 } });
  const exit = interpolate(frame, [(TITLE_SECONDS - 0.4) * fps, TITLE_SECONDS * fps], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{ alignItems: "center", paddingTop: "5%", opacity: Math.min(enter, exit) }}>
      <div
        style={{
          maxWidth: "86%",
          textAlign: "center",
          fontFamily: FONT_FAMILY,
          fontWeight: 700,
          fontSize: size,
          lineHeight: 1.1,
          color: COLORS.ink,
          transform: `translateY(${(1 - enter) * -30}px)`,
          textShadow: "0 4px 24px rgba(0,0,0,0.6)",
        }}
      >
        {text}
        <div style={{ height: 8, width: 120, margin: "24px auto 0", borderRadius: 4, background: COLORS.accent }} />
      </div>
    </AbsoluteFill>
  );
}

function CaptionPage({ page, top, size }: { page: TikTokPage; top: number; size: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // Temps absolu en ms : la Sequence démarre au début de la page.
  const nowMs = page.startMs + (frame / fps) * 1000;
  const enter = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 6 });
  return (
    <AbsoluteFill style={{ alignItems: "center", top: `${top * 100}%`, bottom: "auto" }}>
      <div
        style={{
          maxWidth: "88%",
          textAlign: "center",
          fontFamily: FONT_FAMILY,
          fontWeight: 700,
          fontSize: size,
          lineHeight: 1.15,
          whiteSpace: "pre-wrap",
          color: COLORS.ink,
          // Fond sombre semi-transparent : les mots restent lisibles sur un décor clair (bureau en bois, fond blanc).
          backgroundColor: "rgba(0,0,0,0.55)",
          padding: "0.14em 0.42em 0.2em",
          borderRadius: "0.32em",
          // Ombre plutôt que contour : -webkit-text-stroke laisse des traits entre les lettres de Geist.
          textShadow: "0 0 6px rgba(0,0,0,0.9), 0 4px 14px rgba(0,0,0,0.6)",
          transform: `scale(${interpolate(enter, [0, 1], [0.9, 1])})`,
        }}
      >
        {page.tokens.map((token) => (
          <span key={token.fromMs} style={{ color: nowMs >= token.fromMs && nowMs < token.toMs ? COLORS.accent : COLORS.ink }}>
            {token.text}
          </span>
        ))}
      </div>
    </AbsoluteFill>
  );
}

export function Short({
  format,
  title,
  avatar,
  audio,
  durationSeconds,
  background = null,
  music = null,
  inserts = [],
  pose = "standing",
  signature,
  captions = [],
}: ShortProps) {
  const { fps, durationInFrames } = useVideoConfig();
  const voiceEnd = voiceFrames(durationSeconds);
  const seated = pose === "seated";
  const layout = seated ? { ...FORMATS[format], ...SEATED_LAYOUTS[format] } : FORMATS[format];
  const pages = useMemo(
    () => createTikTokStyleCaptions({ captions, combineTokensWithinMilliseconds: CAPTION_PAGE_MS }).pages,
    [captions],
  );
  // Cartes montées : celles qui ont une taille connue et assez de temps à l'écran.
  const cards = inserts.flatMap((insert) => {
    if (!insert.width || !insert.height) return [];
    // La carte attend la fin du titre d'ouverture, qui occupe le haut de l'image.
    const from = Math.max(Math.round(insert.start * fps), TITLE_SECONDS * fps);
    const until = Math.min(voiceEnd, Math.round(insert.end * fps));
    return until - from < INSERT_MIN_FRAMES ? [] : [{ src: insert.src, width: insert.width, height: insert.height, from, until }];
  });
  const box = {
    top: Math.round(layout.insertTop * layout.height),
    width: Math.round(INSERT_WIDTH * layout.width),
    height: Math.round(layout.insertHeight * layout.height),
  };

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.black }}>
      <Background image={background} />
      <Sequence durationInFrames={voiceEnd} name="Chris">
        <Avatar src={resolve(avatar)} height={layout.avatarHeight} windows={seated ? [] : shrinkWindows(cards)} />
      </Sequence>
      <Sequence durationInFrames={voiceEnd} name="Voix">
        <Audio src={resolve(audio)} />
      </Sequence>
      {music && (
        <Audio
          src={resolve(music.src)}
          loop
          // "extend" : l'image passée au volume continue d'avancer d'une boucle à l'autre.
          loopVolumeCurveBehavior="extend"
          volume={(frame) => musicVolume(frame, music.volume, voiceEnd, durationInFrames)}
          name="Musique"
        />
      )}
      {cards.map((card) => (
        <Sequence key={card.src} from={card.from} durationInFrames={card.until - card.from} name="Image">
          <InsertCard src={resolve(card.src)} width={card.width} height={card.height} box={box} />
        </Sequence>
      ))}
      <Sequence durationInFrames={TITLE_SECONDS * fps} name="Titre">
        <Title text={title} size={layout.titleSize} />
      </Sequence>
      {pages.map((page, index) => {
        const from = Math.round((page.startMs / 1000) * fps);
        const next = pages[index + 1];
        // Une page reste affichée jusqu'à la suivante, sans dépasser sa propre durée de plus d'une seconde.
        const endMs = Math.min(next ? next.startMs : Infinity, page.startMs + page.durationMs + 1000);
        const until = Math.min(voiceEnd, Math.round((endMs / 1000) * fps));
        if (until <= from) return null;
        return (
          <Sequence key={page.startMs} from={from} durationInFrames={until - from} name="Sous-titre">
            <CaptionPage page={page} top={layout.captionTop} size={layout.captionSize} />
          </Sequence>
        );
      })}
      {signature && (
        <Sequence from={voiceEnd} durationInFrames={SIGNATURE_SECONDS * fps} name="Signature">
          <EndCard signature={signature} layout={END_CARD_LAYOUTS[format]} />
        </Sequence>
      )}
    </AbsoluteFill>
  );
}
