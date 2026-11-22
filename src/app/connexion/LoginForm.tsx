"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, LoaderCircle } from "lucide-react";
import { sendPasswordResetEmail, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { authErrorContent } from "@/features/auth/auth-errors";
import { clientAuth } from "@/services/firebase-client";
import { buttonPrimary } from "@/ui/buttons";
import { useModal } from "@/ui/modal/ModalProvider";

const INPUT =
  "h-10 w-full rounded-lg border border-line bg-black px-3 text-sm text-ink placeholder:text-quiet transition-colors duration-150 hover:border-line-strong focus:border-ink focus:outline-none";

export function LoginForm() {
  const router = useRouter();
  const modal = useModal();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    try {
      const auth = await clientAuth();
      const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
      const idToken = await credential.user.getIdToken();
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      await signOut(auth);
      if (response.status === 403) throw { code: "session/forbidden" };
      if (!response.ok) throw { code: "session/failed" };
      router.replace("/");
      router.refresh();
    } catch (error) {
      setBusy(false);
      await modal.error(authErrorContent(error));
    }
  };

  const handleForgotPassword = async () => {
    const target = email.trim();
    if (!target) {
      await modal.info({
        title: "Mot de passe oublié",
        body: "Saisis d'abord ton e-mail dans le champ prévu, puis clique à nouveau sur « Mot de passe oublié ».",
      });
      return;
    }
    const confirmed = await modal.confirm({
      title: "Réinitialiser le mot de passe",
      body: `Un lien de réinitialisation sera envoyé à ${target}.`,
      confirmLabel: "Envoyer le lien",
    });
    if (!confirmed) return;
    try {
      await sendPasswordResetEmail(await clientAuth(), target);
    } catch {
      // Même réponse dans tous les cas : on ne révèle pas si le compte existe.
    }
    await modal.success({
      title: "E-mail envoyé",
      body: "Si un compte existe pour cette adresse, tu vas recevoir un lien pour choisir un nouveau mot de passe.",
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-2 text-sm font-medium">
        E-mail
        <input
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className={INPUT}
        />
      </label>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label htmlFor="password" className="text-sm font-medium">
            Mot de passe
          </label>
          <button
            type="button"
            onClick={handleForgotPassword}
            className="text-sm text-muted transition-colors duration-150 hover:text-ink"
          >
            Mot de passe oublié
          </button>
        </div>
        <div className="relative">
          <input
            id="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={`${INPUT} pr-10`}
          />
          <button
            type="button"
            onClick={() => setShowPassword((value) => !value)}
            aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
            aria-pressed={showPassword}
            className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted transition-colors duration-150 hover:text-ink"
          >
            {showPassword ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
          </button>
        </div>
      </div>
      <button type="submit" disabled={busy} className={`${buttonPrimary} mt-2 w-full`}>
        {busy && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
        Se connecter
      </button>
    </form>
  );
}
