import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Image from "next/image";
import { getSessionUser } from "@/server/session";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Connexion · VoxAvatar Studio" };

export default async function LoginPage() {
  if (await getSessionUser()) redirect("/");
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <Image src="/logo192.png" alt="" width={48} height={48} className="mb-8 rounded-xl" priority />
        <h1 className="text-3xl font-normal tracking-[-0.04em]">VoxAvatar Studio</h1>
        <p className="mt-2 mb-8 text-sm text-muted">Connecte-toi pour créer tes vidéos avec Chris.</p>
        <LoginForm />
      </div>
    </main>
  );
}
