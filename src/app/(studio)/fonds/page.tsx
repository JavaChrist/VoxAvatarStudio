import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { BackgroundLibrary } from "@/features/backgrounds/BackgroundLibrary";
import type { BackgroundView } from "@/features/backgrounds/schema";
import { listBackgrounds, toBackgroundView } from "@/server/backgrounds";
import { errorCode } from "@/server/firebase-admin";
import { getSessionUser } from "@/server/session";

export const metadata: Metadata = { title: "Fonds" };

async function loadBackgrounds(): Promise<BackgroundView[] | null> {
  const user = await getSessionUser();
  if (!user) redirect("/connexion");
  try {
    return await Promise.all((await listBackgrounds(user.uid)).map(toBackgroundView));
  } catch (error) {
    console.error("[backgrounds] list failed", errorCode(error));
    return null;
  }
}

export default async function BackgroundsPage() {
  const backgrounds = await loadBackgrounds();

  if (backgrounds === null) {
    return (
      <section className="flex flex-col items-center gap-3 rounded-lg border border-line px-6 py-16 text-center">
        <TriangleAlert className="size-6 text-quiet" aria-hidden />
        <p className="text-sm font-medium">Fonds indisponibles</p>
        <p className="max-w-sm text-sm text-muted">La base de données n&apos;a pas répondu. Recharge la page dans un instant.</p>
      </section>
    );
  }

  return <BackgroundLibrary initial={backgrounds} />;
}
