"use client";

import { useEffect, useId, useRef, useState, type MouseEvent } from "react";
import { CircleAlert, CircleCheck, CircleHelp, Info, Trash2, type LucideIcon } from "lucide-react";
import { buttonPrimary, buttonSecondary, buttonDanger } from "@/ui/buttons";
import { textareaClass } from "@/ui/fields";
import type { ModalRequest, ModalVariant } from "./types";

const ICONS: Record<ModalVariant, LucideIcon> = {
  info: Info,
  success: CircleCheck,
  error: CircleAlert,
  confirm: CircleHelp,
  destructive: Trash2,
};

const ICON_COLORS: Record<ModalVariant, string> = {
  info: "text-muted",
  success: "text-ready",
  error: "text-danger",
  confirm: "text-muted",
  destructive: "text-danger",
};

const DEFAULT_CONFIRM: Record<ModalVariant, string> = {
  info: "OK",
  success: "OK",
  error: "OK",
  confirm: "Confirmer",
  destructive: "Supprimer",
};

interface ModalDialogProps {
  request: ModalRequest;
  onSettled: (confirmed: boolean, value: string) => void;
}

export function ModalDialog({ request, onSettled }: ModalDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const safeButtonRef = useRef<HTMLButtonElement>(null);
  const primaryButtonRef = useRef<HTMLButtonElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const confirmed = useRef(false);
  const titleId = useId();
  const bodyId = useId();
  const fieldId = useId();

  const { variant, content, needsChoice } = request;
  const { field } = content;
  const [value, setValue] = useState(field?.initialValue ?? "");
  const Icon = ICONS[variant];
  const isDangerous = variant === "destructive";
  const incomplete = field ? value.trim().length < field.minLength : false;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    // Une suppression ne doit pas pouvoir être validée par un simple appui sur Entrée.
    (fieldRef.current ?? (isDangerous ? safeButtonRef : primaryButtonRef).current)?.focus();
  }, [isDangerous]);

  // Tout passe par close() : le navigateur rend alors le focus à l'élément d'origine.
  const closeWith = (value: boolean) => {
    confirmed.current = value;
    dialogRef.current?.close();
  };

  const handleBackdropClick = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === dialogRef.current) closeWith(false);
  };

  return (
    <dialog
      ref={dialogRef}
      role={variant === "error" || isDangerous ? "alertdialog" : undefined}
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onClose={() => onSettled(confirmed.current, value.trim())}
      onClick={handleBackdropClick}
      className="modal m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-line bg-surface p-0 text-ink"
    >
      <div className="flex flex-col gap-4 p-6">
        <Icon aria-hidden className={`size-6 ${ICON_COLORS[variant]}`} />
        <h2 id={titleId} className="text-lg font-medium tracking-tight">
          {content.title}
        </h2>
        <p id={bodyId} className="text-sm leading-relaxed text-muted">
          {content.body}
        </p>
        {field && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={fieldId} className="text-xs text-quiet">
              {field.label}
            </label>
            <textarea
              ref={fieldRef}
              id={fieldId}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              maxLength={field.maxLength}
              placeholder={field.placeholder}
              className={textareaClass}
            />
          </div>
        )}
        <div className="mt-2 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          {needsChoice && (
            <button ref={safeButtonRef} type="button" onClick={() => closeWith(false)} className={buttonSecondary}>
              {content.cancelLabel ?? "Annuler"}
            </button>
          )}
          <button
            ref={primaryButtonRef}
            type="button"
            onClick={() => closeWith(true)}
            disabled={incomplete}
            className={isDangerous ? buttonDanger : buttonPrimary}
          >
            {content.confirmLabel ?? DEFAULT_CONFIRM[variant]}
          </button>
        </div>
      </div>
    </dialog>
  );
}
