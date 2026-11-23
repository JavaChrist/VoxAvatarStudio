import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { MusicLibrary } from "@/features/music/MusicLibrary";
import type { MusicView } from "@/features/music/schema";
import { errorCode } from "@/server/firebase-admin";
import { listMusic, toMusicView } from "@/server/music";
import { getSessionUser } from "@/server/session";

export const metadata: Metadata = { title: "Musiques" };

async function loadMusic(): Promise<MusicView[] | null> {
  const user = await getSessionUser();
  if (!user) redirect("/connexion");
  try {
    return await Promise.all((await listMusic(user.uid)).map(toMusicView));
  } catch (error) {
    console.error("[music] list failed", errorCode(error));
    return null;
  }
}

export default async function MusicPage() {
  const music = await loadMusic();

  if (music === null) {
    return (
      <section className="flex flex-col items-center gap-3 rounded-lg border border-line px-6 py-16 text-center">
        <TriangleAlert className="size-6 text-quiet" aria-hidden />
        <p className="text-sm font-medium">Musiques indisponibles</p>
        <p className="max-w-sm text-sm text-muted">La base de données n&apos;a pas répondu. Recharge la page dans un instant.</p>
      </section>
    );
  }

  return <MusicLibrary initial={music} />;
}
