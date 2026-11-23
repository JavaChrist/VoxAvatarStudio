import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ProjectStatusBadge, formatDate } from "@/features/projects/ProjectStatusBadge";
import { DeleteProjectButton } from "@/features/projects/DeleteProjectButton";
import { ScriptEditor } from "@/features/projects/ScriptEditor";
import { RenderPanel, type BackgroundChoice, type MusicChoice, type SignatureChoice } from "@/features/projects/RenderPanel";
import { VideoPanel } from "@/features/projects/VideoPanel";
import { CharacterPanel } from "@/features/projects/CharacterPanel";
import { InsertsPanel } from "@/features/projects/InsertsPanel";
import type { InsertView } from "@/features/projects/inserts";
import { VoicePanel } from "@/features/projects/VoicePanel";
import { DURATION_PRESETS, durationLabel, toneLabel } from "@/features/projects/schema";
import { errorCode } from "@/server/firebase-admin";
import { getProject } from "@/server/projects";
import { getSessionUser } from "@/server/session";
import type { Project } from "@/features/projects/schema";
import { EMPTY_OVERRIDE_VIEW, type SignatureOverrideView } from "@/features/projects/signature-override";
import { listSignatures, toView } from "@/server/signatures";
import { listBackgrounds, toBackgroundView } from "@/server/backgrounds";
import { listMusic, toMusicView } from "@/server/music";
import { toOverrideView } from "@/server/signature-override";
import { toInsertViews } from "@/server/inserts";

type Props = { params: Promise<{ id: string }> };

async function loadProject(id: string) {
  const user = await getSessionUser();
  if (!user) redirect("/connexion");
  return getProject(user.uid, id);
}

/** Signatures proposées au montage, avec liens d'aperçu du logo. En cas d'échec, le montage reste possible sans signature. */
async function loadSignatureChoices(): Promise<SignatureChoice[] | null> {
  const user = await getSessionUser();
  if (!user) redirect("/connexion");
  try {
    return await Promise.all((await listSignatures(user.uid)).map(toView));
  } catch (error) {
    console.error("[project] signatures list failed", errorCode(error));
    return null;
  }
}

/** Fonds proposés au montage, avec liens d'aperçu. En cas d'échec, le montage reste possible avec le dégradé. */
async function loadBackgroundChoices(): Promise<BackgroundChoice[] | null> {
  const user = await getSessionUser();
  if (!user) redirect("/connexion");
  try {
    return await Promise.all((await listBackgrounds(user.uid)).map(toBackgroundView));
  } catch (error) {
    console.error("[project] backgrounds list failed", errorCode(error));
    return null;
  }
}

/** Musiques proposées au montage, avec liens d'écoute. En cas d'échec, le montage reste possible sans musique. */
async function loadMusicChoices(): Promise<MusicChoice[] | null> {
  const user = await getSessionUser();
  if (!user) redirect("/connexion");
  try {
    return await Promise.all((await listMusic(user.uid)).map(toMusicView));
  } catch (error) {
    console.error("[project] music list failed", errorCode(error));
    return null;
  }
}

/** Réglages de signature propres au projet, avec le lien d'aperçu de son logo. */
async function loadOverride(project: Project): Promise<SignatureOverrideView> {
  try {
    return await toOverrideView(project.signatureOverride);
  } catch (error) {
    console.error("[project] signature override view failed", errorCode(error));
    return project.signatureOverride ? { ...project.signatureOverride, logoUrl: null } : EMPTY_OVERRIDE_VIEW;
  }
}

/** Images insérées du projet, avec leurs liens d'aperçu. Null si la lecture échoue. */
async function loadInserts(project: Project): Promise<InsertView[] | null> {
  try {
    return await toInsertViews(project.inserts);
  } catch (error) {
    console.error("[project] inserts view failed", errorCode(error));
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const project = await loadProject((await params).id);
  return { title: project?.topic ?? "Projet introuvable" };
}

export default async function ProjectPage({ params }: Props) {
  const project = await loadProject((await params).id);
  if (!project) notFound();
  const [signatures, backgrounds, music, initialOverride, inserts] = await Promise.all([
    loadSignatureChoices(),
    loadBackgroundChoices(),
    loadMusicChoices(),
    loadOverride(project),
    loadInserts(project),
  ]);
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
      <VoicePanel projectId={project.id} script={project.script} initialVoice={project.voice} />
      <CharacterPanel projectId={project.id} appearance={project.appearance} avatars={project.avatars} />
      <VideoPanel projectId={project.id} formats={project.formats} script={project.script} voice={project.voice} appearance={project.appearance} initialAvatars={project.avatars} />
      <InsertsPanel projectId={project.id} script={project.script} voice={project.voice} initialInserts={inserts} />
      <RenderPanel projectId={project.id} formats={project.formats} voice={project.voice} appearance={project.appearance} avatars={project.avatars} initialRenders={project.renders} signatures={signatures} backgrounds={backgrounds} music={music} initialOverride={initialOverride} />
      <DeleteProjectButton projectId={project.id} topic={project.topic} hasScript={!!project.script} hasVoice={!!project.voice} />
    </div>
  );
}
