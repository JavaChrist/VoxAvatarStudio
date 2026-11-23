// Sous-titres mot à mot à partir de l'alignement caractère par caractère d'ElevenLabs (with-timestamps).
import type { Caption } from "@remotion/captions";

export interface Alignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

/**
 * Regroupe les caractères en mots. Chaque mot sauf le premier commence par une espace,
 * comme l'attend createTikTokStyleCaptions. Un saut de ligne (séparateur de scènes) force un changement de page.
 */
export function alignmentToCaptions(alignment: Alignment): Caption[] {
  const { characters, character_start_times_seconds: starts, character_end_times_seconds: ends } = alignment;
  const captions: Caption[] = [];
  let word = "";
  let start = 0;
  let end = 0;
  let breakAfter = false;

  const flush = () => {
    if (!/[\p{L}\p{N}]/u.test(word) && captions.length > 0) {
      // Ponctuation isolée (« : », « — ») : on la colle au mot précédent.
      const previous = captions[captions.length - 1]!;
      previous.text += word;
      previous.endMs = Math.round(end * 1000);
    } else if (word) {
      captions.push({
        text: captions.length === 0 ? word : ` ${word}`,
        startMs: Math.round(start * 1000),
        endMs: Math.round(end * 1000),
        timestampMs: Math.round(((start + end) / 2) * 1000),
        confidence: null,
      });
    }
    const last = captions[captions.length - 1];
    if (breakAfter && last) last.pageBreakAfter = true;
    word = "";
    breakAfter = false;
  };

  characters.forEach((char, index) => {
    if (/\s/.test(char)) {
      if (char === "\n") breakAfter = true;
      if (word) flush();
      else if (breakAfter) flush();
      return;
    }
    if (!word) start = starts[index] ?? end;
    word += char;
    end = ends[index] ?? end;
  });
  flush();
  return captions;
}
