import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Signature } from "lucide-react";
import { getSessionUser } from "@/server/session";
import { LogoutButton } from "@/features/auth/LogoutButton";

export default async function StudioLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/connexion");

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-line bg-black pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-3 text-sm font-medium">
            <Image src="/logo192.png" alt="" width={28} height={28} className="rounded-md" />
            VoxAvatar Studio
          </Link>
          <div className="flex items-center gap-4">
            <Link
              href="/signatures"
              className="inline-flex items-center gap-2 text-sm text-muted transition-colors duration-150 hover:text-ink"
            >
              <Signature className="size-4" aria-hidden />
              Signatures
            </Link>
            <span className="hidden truncate text-sm text-muted sm:block">{user.email}</span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">{children}</main>
    </div>
  );
}
