export type ModalVariant = "info" | "success" | "error" | "confirm" | "destructive";

export interface ModalContent {
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

export interface ModalRequest {
  id: number;
  variant: ModalVariant;
  content: ModalContent;
  /** Affiche un bouton d'annulation. */
  needsChoice: boolean;
  resolve: (confirmed: boolean) => void;
}

export interface ModalApi {
  info: (content: ModalContent) => Promise<void>;
  success: (content: ModalContent) => Promise<void>;
  error: (content: ModalContent) => Promise<void>;
  /** Les deux suivantes renvoient true seulement si l'utilisateur valide. */
  confirm: (content: ModalContent) => Promise<boolean>;
  destructive: (content: ModalContent) => Promise<boolean>;
}
