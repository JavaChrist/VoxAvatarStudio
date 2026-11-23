import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { SignatureLibrary } from "@/features/signatures/SignatureLibrary";
import type { SignatureView } from "@/features/signatures/schema";
import { errorCode } from "@/server/firebase-admin";
import { getSessionUser } from "@/server/session";
import { listSignatures, toView } from "@/server/signatures";

export const metadata: Metadata = { title: "Signatures" };

async function loadSignatures(): Promise<SignatureView[] | null> {
  const user = await getSessionUser();
  if (!user) redirect("/connexion");
  try {
    return await Promise.all((await listSignatures(user.uid)).map(toView));
  } catch (error) {
    console.error("[signatures] list failed", errorCode(error));
    return null;
  }
}

export default async function SignaturesPage() {
  const signatures = await loadSignatures();

  if (signatures === null) {
    return (
      <section className="flex flex-col items-center gap-3 rounded-lg border border-line px-6 py-16 text-center">
        <TriangleAlert className="size-6 text-quiet" aria-hidden />
        <p className="text-sm font-medium">Signatures indisponibles</p>
        <p className="max-w-sm text-sm text-muted">La base de données n&apos;a pas répondu. Recharge la page dans un instant.</p>
      </section>
    );
  }

  return <SignatureLibrary initial={signatures} />;
}
