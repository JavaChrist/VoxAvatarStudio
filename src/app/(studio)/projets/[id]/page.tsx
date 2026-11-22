import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ProjectStatusBadge, formatDate } from "@/features/projects/ProjectStatusBadge";
import { ScriptEditor } from "@/features/projects/ScriptEditor";
import { DURATION_PRESETS, durationLabel, toneLabel } from "@/features/projects/schema";
import { getProject } from "@/server/projects";
import { getSessionUser } from "@/server/session";

type Props = { params: Promise<{ id: string }> };

async function loadProject(id: string) {
  const user = await getSessionUser();
  if (!user) redirect("/connexion");
  return getProject(user.uid, id);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const project = await loadProject((await params).id);
  return { title: project?.topic ?? "Projet introuvable" };
}

export default async function ProjectPage({ params }: Props) {
  const project = await loadProject((await params).id);
  if (!project) notFound();
  const preset = DURATION_PRESETS.find((p) => p.id === project.duration);

  const details = [
    { label: "Ton", value: toneLabel(project.tone) },
    { label: "Durée", value: preset ? `${preset.label} (cible ${preset.targetSeconds} s)` : durationLabel(project.duration) },
    { label: "Formats", value: project.formats.join(" · ") },
    { label: "Créé le", value: formatDate(project.createdAt) },
  ];

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted transition-colors duration-150 hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        Projets
      </Link>
      <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
        <h1 className="min-w-0 text-4xl font-normal tracking-[-0.04em] break-words">{project.topic}</h1>
        <ProjectStatusBadge status={project.status} />
      </div>

      <dl className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4">
        {details.map((item) => (
          <div key={item.label} className="bg-black p-4">
            <dt className="text-xs text-quiet">{item.label}</dt>
            <dd className="mt-1 text-sm">{item.value}</dd>
          </div>
        ))}
      </dl>

      {project.notes && (
        <section className="mt-8">
          <h2 className="text-sm font-medium">Notes</h2>
          <p className="mt-2 text-sm leading-6 whitespace-pre-wrap text-muted">{project.notes}</p>
        </section>
      )}

      <ScriptEditor projectId={project.id} initialScript={project.script} />
    </div>
  );
}
