"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";

/** Marge laissée entre l'en-tête fixe et le titre d'une section. */
const GAP = 16;
/** En dessous de cet écart, en pixels, deux positions comptent pour la même. */
const TOLERANCE = 4;

const UP = 1;
const DOWN = 2;

const button =
  "grid size-11 cursor-pointer place-items-center rounded-full border border-line-strong bg-surface/90 text-ink shadow-lg shadow-black/50 backdrop-blur transition-colors duration-150 hover:border-accent/60 hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

function maxScroll() {
  return Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
}

/** Directions encore possibles, réunies en un nombre pour que l'instantané reste stable. */
function directions() {
  const y = window.scrollY;
  return (y > TOLERANCE ? UP : 0) | (y < maxScroll() - TOLERANCE ? DOWN : 0);
}

function subscribe(onChange: () => void) {
  // La hauteur de la page change aussi sans défilement : navigation, panneau qui s'ouvre, image chargée.
  const observer = new ResizeObserver(onChange);
  observer.observe(document.body);
  window.addEventListener("scroll", onChange, { passive: true });
  window.addEventListener("resize", onChange);
  return () => {
    observer.disconnect();
    window.removeEventListener("scroll", onChange);
    window.removeEventListener("resize", onChange);
  };
}

/** Positions d'arrêt, de haut en bas : le haut, chaque section d'un bloc `data-scroll-sections`, le bas. */
function stops() {
  const max = maxScroll();
  const header = document.querySelector<HTMLElement>("[data-app-header]")?.offsetHeight ?? 0;
  const sections = Array.from(document.querySelectorAll("[data-scroll-sections] > section"), (section) => {
    const y = section.getBoundingClientRect().top + window.scrollY - header - GAP;
    // À moins d'une marge du bas, la section se confond avec lui, sans passer sous l'en-tête.
    return y > max - GAP ? max : Math.max(y, 0);
  });
  return [0, ...sections, max];
}

/** Flèches flottantes : section précédente ou suivante, ou haut et bas d'une page sans sections. */
export function ScrollButtons() {
  const available = useSyncExternalStore(subscribe, directions, () => 0);
  const container = useRef<HTMLDivElement>(null);
  // Destination du défilement en cours : un second clic part de là, pas de la position intermédiaire.
  const target = useRef<number | null>(null);

  useEffect(() => {
    const arrived = () => {
      if (target.current !== null && Math.abs(window.scrollY - target.current) <= TOLERANCE) target.current = null;
    };
    // Tout geste en dehors des flèches reprend la main sur le défilement.
    const release = (event: Event) => {
      if (!container.current?.contains(event.target as Node)) target.current = null;
    };
    const gestures = ["wheel", "pointerdown", "keydown"] as const;
    window.addEventListener("scroll", arrived, { passive: true });
    gestures.forEach((name) => window.addEventListener(name, release, { passive: true }));
    return () => {
      window.removeEventListener("scroll", arrived);
      gestures.forEach((name) => window.removeEventListener(name, release));
    };
  }, []);

  function go(direction: typeof UP | typeof DOWN) {
    const from = target.current ?? window.scrollY;
    const positions = stops();
    const next =
      direction === UP
        ? positions.reverse().find((y) => y < from - TOLERANCE)
        : positions.find((y) => y > from + TOLERANCE);
    if (next === undefined) return;
    target.current = next;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: next, behavior: reduced ? "instant" : "smooth" });
  }

  if (!available) return null;

  return (
    <div ref={container} className="fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-10 flex flex-col gap-2">
      {/* Masquée mais en place, pour que l'autre flèche ne bouge pas sous le doigt. */}
      <button type="button" onClick={() => go(UP)} aria-label="Monter" title="Monter" className={`${button} ${available & UP ? "" : "invisible"}`}>
        <ArrowUp className="size-5" aria-hidden />
      </button>
      <button type="button" onClick={() => go(DOWN)} aria-label="Descendre" title="Descendre" className={`${button} ${available & DOWN ? "" : "invisible"}`}>
        <ArrowDown className="size-5" aria-hidden />
      </button>
    </div>
  );
}
