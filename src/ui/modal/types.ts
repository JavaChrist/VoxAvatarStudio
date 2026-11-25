export type ModalVariant = "info" | "success" | "error" | "confirm" | "destructive";

export interface ModalContent {
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

/** Champ de texte affiché dans la modale. Le bouton de validation reste inactif tant que le texte est trop court. */
export interface ModalField {
  label: string;
  initialValue: string;
  minLength: number;
  maxLength: number;
  placeholder?: string;
}

export type ModalAskContent = ModalContent & { field: ModalField };

export interface ModalRequest {
  id: number;
  variant: ModalVariant;
  content: ModalContent & { field?: ModalField };
  /** Affiche un bouton d'annulation. */
  needsChoice: boolean;
  /** `value` : texte saisi, vide sans champ. */
  resolve: (confirmed: boolean, value: string) => void;
}

export interface ModalApi {
  info: (content: ModalContent) => Promise<void>;
  success: (content: ModalContent) => Promise<void>;
  error: (content: ModalContent) => Promise<void>;
  /** Les deux suivantes renvoient true seulement si l'utilisateur valide. */
  confirm: (content: ModalContent) => Promise<boolean>;
  destructive: (content: ModalContent) => Promise<boolean>;
  /** Demande un texte : renvoie la saisie sans espaces autour, ou null si l'utilisateur renonce. */
  ask: (content: ModalAskContent) => Promise<string | null>;
}
