// Carte de fin animée : logo, nom, accroche, site et pseudo, QR code. Affichée après la voix.
import QRCode from "qrcode";
import { useMemo, type ReactNode } from "react";
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { FONT_FAMILY } from "./fonts";

/** Même valeur que SIGNATURE_SECONDS dans l'app (src/features/signatures/schema.ts). */
export const SIGNATURE_SECONDS = 4;

export type EndCardSignature = {
  displayName: string;
  tagline: string;
  website: string;
  handle: string;
  /** Lien encodé dans le QR code ; vide : pas de QR code. */
  qrUrl: string;
  /** Logo, chemin dans public/ ou URL ; null : pas de logo. */
  logo: string | null;
};

type EndCardLayout = { logo: number; name: number; tagline: number; pill: number; qr: number; gap: number };

/** Tailles par format (largeur 1080 partout, la hauteur change). */
export const END_CARD_LAYOUTS: Record<"9:16" | "4:5" | "1:1", EndCardLayout> = {
  "9:16": { logo: 220, name: 92, tagline: 44, pill: 38, qr: 340, gap: 40 },
  "4:5": { logo: 170, name: 78, tagline: 38, pill: 34, qr: 260, gap: 30 },
  "1:1": { logo: 120, name: 64, tagline: 32, pill: 28, qr: 200, gap: 22 },
};

const COLORS = { black: "#0b0b0c", ink: "#ffffff", muted: "#b8b8bd", accent: "#ff7a1a", glow: "#3a1d08" };

const resolve = (path: string) => (/^https?:\/\//.test(path) ? path : staticFile(path));

/** QR code dessiné en SVG à partir de la matrice : net à toutes les tailles, sans fichier image. */
function QrCode({ url, size }: { url: string; size: number }) {
  const { path, count } = useMemo(() => {
    // Niveau M : lisible même si la vidéo est compressée par le réseau social.
    const { modules } = QRCode.create(url, { errorCorrectionLevel: "M" });
    let d = "";
    for (let row = 0; row < modules.size; row++) {
      for (let col = 0; col < modules.size; col++) {
        if (modules.get(row, col)) d += `M${col} ${row}h1v1h-1z`;
      }
    }
    return { path: d, count: modules.size };
  }, [url]);
  const quiet = 3;
  const box = count + quiet * 2;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`${-quiet} ${-quiet} ${box} ${box}`}
      shapeRendering="crispEdges"
      style={{ borderRadius: size * 0.06, display: "block" }}
    >
      <rect x={-quiet} y={-quiet} width={box} height={box} fill="#ffffff" />
      <path d={path} fill={COLORS.black} />
    </svg>
  );
}

export function EndCard({ signature, layout }: { signature: EndCardSignature; layout: EndCardLayout }) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // Fond en fondu, puis chaque élément entre à son tour (0,15 s d'écart).
  const background = interpolate(frame, [0, 0.4 * fps], [0, 1], { extrapolateRight: "clamp" });
  const enter = (index: number) =>
    spring({ frame: frame - Math.round(0.25 * fps) - index * Math.round(0.15 * fps), fps, config: { damping: 200 } });
  const rise = (progress: number) => ({ opacity: progress, transform: `translateY(${(1 - progress) * 40}px)` });
  // Halo orange qui respire doucement derrière le contenu.
  const pulse = 0.85 + 0.15 * Math.sin((frame / fps) * Math.PI);
  // Fondu au noir sur les 0,3 dernières secondes.
  const out = interpolate(frame, [durationInFrames - 0.3 * fps, durationInFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const links = [signature.website, signature.handle].filter(Boolean).join("  ·  ");
  const items: { key: string; node: ReactNode }[] = [];
  if (signature.logo) {
    items.push({
      key: "logo",
      node: (
        <Img
          src={resolve(signature.logo)}
          style={{ maxHeight: layout.logo, maxWidth: "60%", objectFit: "contain", display: "block" }}
        />
      ),
    });
  }
  if (signature.displayName) {
    items.push({
      key: "name",
      node: (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div style={{ fontSize: layout.name, fontWeight: 700, lineHeight: 1.05, letterSpacing: "-0.02em" }}>
            {signature.displayName}
          </div>
          <div
            style={{
              height: 8,
              width: 120 * enter(items.length + 1),
              marginTop: layout.gap * 0.6,
              borderRadius: 4,
              background: COLORS.accent,
            }}
          />
        </div>
      ),
    });
  }
  if (signature.tagline) {
    items.push({
      key: "tagline",
      node: (
        <div style={{ fontSize: layout.tagline, fontWeight: 600, lineHeight: 1.25, color: COLORS.muted, maxWidth: "86%" }}>
          {signature.tagline}
        </div>
      ),
    });
  }
  if (links) {
    items.push({
      key: "links",
      node: (
        <div
          style={{
            fontSize: layout.pill,
            fontWeight: 600,
            lineHeight: 1.2,
            color: COLORS.black,
            background: COLORS.accent,
            borderRadius: 999,
            padding: `${layout.pill * 0.45}px ${layout.pill * 0.9}px`,
            maxWidth: "90%",
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
          }}
        >
          {links}
        </div>
      ),
    });
  }
  if (signature.qrUrl) {
    items.push({ key: "qr", node: <QrCode url={signature.qrUrl} size={layout.qr} /> });
  }

  return (
    <AbsoluteFill style={{ opacity: out }}>
      <AbsoluteFill style={{ backgroundColor: COLORS.black, opacity: background }} />
      <AbsoluteFill
        style={{
          opacity: background,
          background: `radial-gradient(circle at 50% 45%, ${COLORS.glow} 0%, transparent ${62 * pulse}%)`,
        }}
      />
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          gap: layout.gap,
          padding: "6%",
          textAlign: "center",
          fontFamily: FONT_FAMILY,
          color: COLORS.ink,
        }}
      >
        {items.map((item, index) => {
          const progress = enter(index);
          return (
            <div
              key={item.key}
              style={{
                ...rise(progress),
                width: "100%",
                display: "flex",
                justifyContent: "center",
                ...(item.key === "qr" ? { transform: `scale(${interpolate(progress, [0, 1], [0.85, 1])})` } : {}),
              }}
            >
              {item.node}
            </div>
          );
        })}
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
