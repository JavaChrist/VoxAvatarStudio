import Link from "next/link";
import { Plus } from "lucide-react";
import { buttonPrimary } from "@/ui/buttons";

export function NewProjectButton() {
  return (
    <Link href="/projets/nouveau" className={buttonPrimary}>
      <Plus className="size-4" aria-hidden />
      Nouveau projet
    </Link>
  );
}
