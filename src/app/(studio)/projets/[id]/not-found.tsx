import Link from "next/link";
import { SearchX } from "lucide-react";
import { buttonSecondary } from "@/ui/buttons";

export default function ProjectNotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
      <SearchX className="size-6 text-quiet" aria-hidden />
      <h1 className="text-sm font-medium">Projet introuvable</h1>
      <p className="text-sm text-muted">Ce projet n&apos;existe pas ou a été supprimé.</p>
      <Link href="/" className={`${buttonSecondary} mt-3`}>
        Retour aux projets
      </Link>
    </div>
  );
}
