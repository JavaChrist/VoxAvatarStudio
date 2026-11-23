// Montage d'une vidéo courte : fond, Chris détouré, voix, titre d'ouverture, sous-titres mot à mot
// et, si une signature est choisie, carte de fin de SIGNATURE_SECONDS après la voix. Musique de fond en option.
import { createTikTokStyleCaptions, type Caption, type TikTokPage } from "@remotion/captions";
import { Audio, Video } from "@remotion/media";
import { useMemo } from "react";
import {
  AbsoluteFill,
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
  "9:16": { width: 1080, height: 1920, avatarHeight: 0.86, captionTop: 0.64, titleSize: 68, captionSize: 76 },
  "4:5": { width: 1080, height: 1350, avatarHeight: 0.84, captionTop: 0.66, titleSize: 58, captionSize: 64 },
  "1:1": { width: 1080, height: 1080, avatarHeight: 0.82, captionTop: 0.7, titleSize: 52, captionSize: 58 },
} as const;
export type Format = keyof typeof FORMATS;

const COLORS = { black: "#0b0b0c", ink: "#ffffff", accent: "#ff7a1a", glow: "#3a1d08" };

/** Durée d'affichage du titre d'ouverture. */
const TITLE_SECONDS = 3;
/** Fondu d'entrée et de sortie de la musique, et montée du volume sur la signature. */
const MUSIC_FADE_IN_FRAMES = FPS;
const MUSIC_FADE_OUT_FRAMES = Math.round(1.5 * FPS);
const MUSIC_RISE_FRAMES = Math.round(0.6 * FPS);
/** Sur la signature, la musique monte à trois fois son niveau sous la voix, sans dépasser le volume d'origine. */
const MUSIC_END_CARD_BOOST = 3;

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
  /** Carte de fin ; absente ou null : la vidéo s'arrête avec la voix. */
  signature?: EndCardSignature | null;
  /** Rempli par calculateMetadata. */
  captions?: Caption[];
};

const resolve = (path: string) => (/^https?:\/\//.test(path) ? path : staticFile(path));

/** Durée de la voix en images : l'avatar, l'audio et les sous-titres s'arrêtent là. */
const voiceFrames = (durationSeconds: number) => Math.max(1, Math.ceil(durationSeconds * FPS));

export const calculateShortMetadata: CalculateMetadataFunction<ShortProps> = async ({ props, abortSignal }) => {
  const response = await fetch(resolve(props.alignment), { signal: abortSignal });
  if (!response.ok) throw new Error(`Alignement introuvable (${response.status})`);
  const alignment = (await response.json()) as Alignment;
  const { width, height } = FORMATS[props.format];
  return {
    width,
    height,
    fps: FPS,
    durationInFrames: voiceFrames(props.durationSeconds) + (props.signature ? SIGNATURE_SECONDS * FPS : 0),
    props: { ...props, captions: alignmentToCaptions(alignment) },
  };
};

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
          // Ombre plutôt que contour : -webkit-text-stroke laisse des traits entre les lettres de Geist.
          textShadow: "0 0 6px rgba(0,0,0,0.95), 0 6px 20px rgba(0,0,0,0.85)",
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
  signature,
  captions = [],
}: ShortProps) {
  const { fps, durationInFrames } = useVideoConfig();
  const voiceEnd = voiceFrames(durationSeconds);
  const layout = FORMATS[format];
  const pages = useMemo(
    () => createTikTokStyleCaptions({ captions, combineTokensWithinMilliseconds: CAPTION_PAGE_MS }).pages,
    [captions],
  );

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.black }}>
      <Background image={background} />
      <Sequence durationInFrames={voiceEnd} name="Chris">
        <AbsoluteFill style={{ top: "auto", height: `${layout.avatarHeight * 100}%` }}>
          <Video src={resolve(avatar)} muted objectFit="contain" style={{ width: "100%", height: "100%" }} />
        </AbsoluteFill>
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
