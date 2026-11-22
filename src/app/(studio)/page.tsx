import { Clapperboard } from "lucide-react";
import { NewProjectButton } from "./NewProjectButton";

export default function ProjectsPage() {
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-normal tracking-[-0.04em] md:text-5xl">Projets</h1>
          <p className="mt-2 text-sm text-muted">Chaque projet produit une vidéo de Chris, dans un ou plusieurs formats.</p>
        </div>
        <NewProjectButton />
      </div>
      <section className="mt-10 rounded-lg border border-line">
        <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <Clapperboard className="size-6 text-quiet" aria-hidden />
          <p className="text-sm font-medium">Aucun projet pour l&apos;instant</p>
          <p className="max-w-sm text-sm text-muted">Crée un projet : sujet, ton, durée et formats. Claude écrit le script, puis Chris le présente.</p>
        </div>
      </section>
    </>
  );
}
