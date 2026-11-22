import { STATUS_LABELS, type ProjectStatus } from "./schema";

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  const done = status === "rendered";
  return (
    <span className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border border-line px-2.5 text-xs text-muted">
      <span className={`size-1.5 rounded-full ${done ? "bg-ready" : "bg-quiet"}`} aria-hidden />
      {STATUS_LABELS[status]}
    </span>
  );
}

/** Date lisible en français, toujours à l'heure de Paris (rendu serveur). */
export const formatDate = (iso: string) =>
  new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" }).format(new Date(iso));
