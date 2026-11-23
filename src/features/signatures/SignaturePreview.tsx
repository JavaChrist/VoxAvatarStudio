import { QrCode } from "lucide-react";
import { SIGNATURE_SECONDS } from "./schema";

export interface PreviewContent {
  displayName: string;
  tagline: string;
  website: string;
  handle: string;
  qrUrl: string;
  logoUrl: string | null;
}

/**
 * Aperçu fixe de la carte de fin, en 9:16 : la mise en page de la vidéo, sans l'animation.
 * Le QR code réel est généré au rendu ; ici, un pictogramme marque sa place.
 */
export function SignaturePreview({ content, className = "" }: { content: PreviewContent; className?: string }) {
  const { displayName, tagline, website, handle, qrUrl, logoUrl } = content;
  const link = [website, handle].filter(Boolean).join(" · ");
  const empty = !logoUrl && !displayName && !tagline && !link && !qrUrl;

  return (
    <div
      className={`relative flex aspect-9/16 flex-col items-center justify-center gap-3 overflow-hidden rounded-lg border border-line px-4 text-center ${className}`}
      style={{ background: "radial-gradient(circle at 50% 42%, #3a1d08 0%, #0b0b0c 62%)" }}
      aria-label={`Aperçu de la carte de fin (${SIGNATURE_SECONDS} s)`}
      role="img"
    >
      {empty ? (
        <p className="text-xs text-quiet">Remplis au moins un champ pour voir la carte.</p>
      ) : (
        <>
          {logoUrl && (
            // Lien signé temporaire ou image locale : next/image n'apporterait rien ici.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className="max-h-[22%] max-w-[55%] object-contain" />
          )}
          {displayName && <p className="text-base leading-tight font-semibold break-words text-white">{displayName}</p>}
          {tagline && <p className="text-[11px] leading-snug break-words text-white/75">{tagline}</p>}
          {link && (
            <p className="max-w-full truncate rounded-full bg-accent px-3 py-1 text-[10px] font-medium text-black">{link}</p>
          )}
          {qrUrl && (
            <span className="mt-1 flex size-14 items-center justify-center rounded-md bg-white text-black">
              <QrCode className="size-9" aria-hidden />
            </span>
          )}
        </>
      )}
      <span className="absolute right-2 bottom-2 rounded-sm bg-black/60 px-1.5 py-0.5 text-[10px] text-muted tabular-nums">
        {SIGNATURE_SECONDS} s
      </span>
    </div>
  );
}
