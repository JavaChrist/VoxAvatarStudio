import type { ModalContent } from "@/ui/modal/types";

/** Message compréhensible pour une erreur de connexion Firebase ou de session. */
export function authErrorContent(error: unknown): ModalContent {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
    case "auth/invalid-email":
      return { title: "Connexion impossible", body: "L'e-mail ou le mot de passe est incorrect." };
    case "auth/too-many-requests":
      return { title: "Trop de tentatives", body: "Le compte est bloqué quelques minutes. Réessaie plus tard ou réinitialise le mot de passe." };
    case "auth/network-request-failed":
      return { title: "Pas de connexion", body: "Vérifie ta connexion internet et réessaie." };
    case "session/forbidden":
      return { title: "Accès refusé", body: "Ce compte n'est pas autorisé à utiliser VoxAvatar Studio." };
    default:
      return { title: "Erreur", body: "La connexion a échoué. Réessaie dans un instant." };
  }
}
