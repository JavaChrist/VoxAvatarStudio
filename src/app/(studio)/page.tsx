import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, Clapperboard, TriangleAlert } from "lucide-react";
import { ProjectStatusBadge, formatDate } from "@/features/projects/ProjectStatusBadge";
import { durationLabel, toneLabel, type Project } from "@/features/projects/schema";
import { errorCode } from "@/server/firebase-admin";
import { listProjects } from "@/server/projects";
import { getSessionUser } from "@/server/session";
import { NewProjectButton } from "./NewProjectButton";

async function loadProjects(): Promise<Project[] | null> {
  const user = await getSessionUser();
  if (!user) redirect("/connexion");
  try {
    return await listProjects(user.uid);
  } catch (error) {
    console.error("[projects] list failed", errorCode(error));
    return null;
  }
}

function EmptyState({ icon: Icon, title, body }: { icon: typeof Clapperboard; title: string; body: string }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <Icon className="size-6 text-quiet" aria-hidden />
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-sm text-sm text-muted">{body}</p>
    </div>
  );
}

export default async function ProjectsPage() {
  const projects = await loadProjects();

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
        {projects === null ? (
          <EmptyState icon={TriangleAlert} title="Projets indisponibles" body="La base de données n'a pas répondu. Recharge la page dans un instant." />
        ) : projects.length === 0 ? (
          <EmptyState
            icon={Clapperboard}
            title="Aucun projet pour l'instant"
            body="Crée un projet : sujet, ton, durée et formats. Claude écrit le script, puis Chris le présente."
          />
        ) : (
          <ul className="divide-y divide-line">
            {projects.map((project) => (
              <li key={project.id}>
                <Link
                  href={`/projets/${project.id}`}
                  className="flex items-center gap-4 px-4 py-4 transition-colors duration-150 hover:bg-hover sm:px-5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{project.topic}</p>
                    <p className="mt-1 truncate text-xs text-muted">
                      {toneLabel(project.tone)} · {durationLabel(project.duration)} · {project.formats.join(", ")} ·{" "}
                      {formatDate(project.createdAt)}
                    </p>
                  </div>
                  <ProjectStatusBadge status={project.status} />
                  <ChevronRight className="size-4 shrink-0 text-quiet" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
