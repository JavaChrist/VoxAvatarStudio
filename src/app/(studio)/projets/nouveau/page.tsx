import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { NewProjectForm } from "./NewProjectForm";

export const metadata: Metadata = { title: "Nouveau projet" };

export default function NewProjectPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted transition-colors duration-150 hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        Projets
      </Link>
      <h1 className="mt-6 text-4xl font-normal tracking-[-0.04em]">Nouveau projet</h1>
      <p className="mt-2 text-sm text-muted">Décris la vidéo. Claude écrira ensuite le script, calé sur la durée choisie.</p>
      <div className="mt-10">
        <NewProjectForm />
      </div>
    </div>
  );
}
