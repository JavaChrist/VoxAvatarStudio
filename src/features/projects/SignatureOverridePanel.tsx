"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ImageOff, ImagePlus, LoaderCircle, RotateCcw, Save, SlidersHorizontal } from "lucide-react";
import {
  isEmptyOverride,
  validateOverrideInput,
  type SignatureOverrideInput,
  type SignatureOverrideView,
} from "@/features/projects/signature-override";
import { checkLogoFile, signatureErrorMessage } from "@/features/signatures/api";
import { SignaturePreview } from "@/features/signatures/SignaturePreview";
import { LOGO_TYPES, SIGNATURE_LIMITS, line, type SignatureView } from "@/features/signatures/schema";
import { buttonPrimary, buttonSecondary } from "@/ui/buttons";
import { fieldErrorClass, inputClass } from "@/ui/fields";
import { useModal } from "@/ui/modal/ModalProvider";

// Accroche, QR code et logo propres à une vidéo, posés sur la signature choisie au montage. Gratuit.

/** Logo de la vidéo : celui de la signature, un logo propre à la vidéo, ou aucun. */
type LogoMode = "signature" | "own" | "none";

/** Brouillon du formulaire. null : la valeur de la signature (suit la signature si on en change). */
interface Draft {
  tagline: string | null;
  qrUrl: string | null;
  logoMode: LogoMode;
}

type Field = "tagline" | "qrUrl";
type Errors = Partial<Record<Field, string>>;

const modeOf = (override: SignatureOverrideView): LogoMode => (override.hideLogo ? "none" : override.logo ? "own" : "signature");
const draftOf = (override: SignatureOverrideView): Draft => ({ tagline: override.tagline, qrUrl: override.qrUrl, logoMode: modeOf(override) });

type OverrideResult = { ok: true; override: SignatureOverrideView } | { ok: false; error: string; fields?: Errors };

/** Appel des routes /api/projects/{id}/signature : la session passe par le cookie httpOnly, aucun secret ici. */
async function call(url: string, init: RequestInit): Promise<OverrideResult> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    return { ok: false, error: "network" };
  }
  if (response.status === 401) return { ok: false, error: "unauthorized" };
  const data = await response.json().catch(() => null);
  if (response.ok && data?.override) return { ok: true, override: data.override };
  return { ok: false, error: typeof data?.error === "string" ? data.error : "server_error", fields: data?.fields };
}

const OVERRIDE_ERRORS: Record<string, string> = {
  not_found: "Ce projet n'existe plus. Recharge la page.",
};
const overrideErrorMessage = (code: string) => OVERRIDE_ERRORS[code] ?? signatureErrorMessage(code);

/** État remonté au panneau Montage : modifications non enregistrées, enregistrement en cours. */
export interface OverrideState {
  dirty: boolean;
  busy: boolean;
}

interface Props {
  projectId: string;
  /** Signature choisie pour le montage. */
  base: SignatureView;
  /** Réglages enregistrés. */
  saved: SignatureOverrideView;
  disabled: boolean;
  onSaved: (override: SignatureOverrideView) => void;
  onStateChange: (state: OverrideState) => void;
}

export function SignatureOverridePanel({ projectId, base, saved, disabled, onSaved, onStateChange }: Props) {
  const router = useRouter();
  const modal = useModal();
  const customized = !isEmptyOverride(saved);
  const [open, setOpen] = useState(customized);
  const [draft, setDraft] = useState<Draft>(() => draftOf(saved));
  const [localLogo, setLocalLogo] = useState<{ file: File; url: string } | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const localUrl = useRef<string | null>(null);

  // Libère l'image locale en quittant le panneau.
  useEffect(() => () => {
    if (localUrl.current) URL.revokeObjectURL(localUrl.current);
  }, []);

  const replaceLocalLogo = (next: { file: File; url: string } | null) => {
    if (localUrl.current) URL.revokeObjectURL(localUrl.current);
    localUrl.current = next?.url ?? null;
    setLocalLogo(next);
  };

  const savedDraft = draftOf(saved);
  const dirty =
    localLogo !== null ||
    draft.tagline !== savedDraft.tagline ||
    draft.qrUrl !== savedDraft.qrUrl ||
    draft.logoMode !== savedDraft.logoMode;

  // Avant l'affichage : un clic sur « Monter » juste après une saisie doit déjà voir les réglages non enregistrés.
  useLayoutEffect(() => onStateChange({ dirty, busy }), [dirty, busy, onStateChange]);

  const shown = {
    tagline: draft.tagline ?? base.tagline,
    qrUrl: draft.qrUrl ?? base.qrUrl,
  };
  const logoUrl =
    draft.logoMode === "none" ? null : draft.logoMode === "own" ? (localLogo?.url ?? saved.logoUrl) : base.logoUrl;

  const setField = (field: Field, value: string) => {
    // Revenir à la valeur de la signature redonne null : le champ suit de nouveau la signature.
    setDraft((current) => ({ ...current, [field]: value === base[field] ? null : value }));
    setErrors((current) => {
      if (!current[field]) return current;
      const rest = { ...current };
      delete rest[field];
      return rest;
    });
  };

  const resetField = (field: Field) => setField(field, base[field]);

  const chooseLogo = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const problem = checkLogoFile(file);
    if (problem) {
      await modal.error({ title: "Logo refusé", body: signatureErrorMessage(problem) });
      return;
    }
    replaceLocalLogo({ file, url: URL.createObjectURL(file) });
    setDraft((current) => ({ ...current, logoMode: "own" }));
  };

  const setLogoMode = (logoMode: LogoMode) => {
    replaceLocalLogo(null);
    setDraft((current) => ({ ...current, logoMode }));
  };

  /** Brouillon enregistré : on remet le formulaire sur les réglages renvoyés par le serveur. */
  const commit = (override: SignatureOverrideView) => {
    replaceLocalLogo(null);
    setDraft(draftOf(override));
    setErrors({});
    onSaved(override);
  };

  const fail = async (error: string, title: string) => {
    if (error === "unauthorized") return router.replace("/connexion");
    await modal.error({ title, body: overrideErrorMessage(error) });
  };

  const save = async () => {
    // Une valeur identique à celle de la signature n'est pas un réglage : elle suivra la signature.
    const same = (value: string | null, field: Field) => value === null || line(value) === line(base[field]);
    const input: SignatureOverrideInput = {
      tagline: same(draft.tagline, "tagline") ? null : draft.tagline,
      qrUrl: same(draft.qrUrl, "qrUrl") ? null : draft.qrUrl,
      hideLogo: draft.logoMode === "none",
    };
    const local = validateOverrideInput(input);
    if (!local.ok) {
      const fields = { tagline: local.errors.tagline, qrUrl: local.errors.qrUrl };
      setErrors(fields);
      document.getElementById(`override-${fields.tagline ? "tagline" : "qrUrl"}`)?.focus();
      return;
    }

    setBusy(true);
    try {
      const texts = await call(`/api/projects/${projectId}/signature`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(local.value),
      });
      if (!texts.ok) {
        if (texts.error === "invalid_input" && texts.fields) return setErrors(texts.fields);
        return void (await fail(texts.error, "Enregistrement impossible"));
      }

      // Les textes sont enregistrés ; le logo suit dans une seconde requête.
      let result = texts.override;
      const logoStep =
        draft.logoMode === "own" && localLogo
          ? await call(`/api/projects/${projectId}/signature/logo`, { method: "PUT", body: localLogo.file })
          : draft.logoMode !== "own" && result.logo
            ? await call(`/api/projects/${projectId}/signature/logo`, { method: "DELETE" })
            : null;
      if (logoStep?.ok) result = logoStep.override;
      commit(result);
      if (logoStep?.ok === false) {
        await fail(logoStep.error, "Logo non enregistré");
      }
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    const ok = await modal.confirm({
      title: "Revenir à la signature ?",
      body: `Les réglages propres à cette vidéo seront effacés, logo compris. Les prochains montages utiliseront la signature « ${base.name} » telle quelle.`,
      confirmLabel: "Revenir à la signature",
      cancelLabel: "Annuler",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const result = await call(`/api/projects/${projectId}/signature`, { method: "DELETE" });
      if (!result.ok) return void (await fail(result.error, "Réglages non effacés"));
      commit(result.override);
    } finally {
      setBusy(false);
    }
  };

  const changes = [
    saved.tagline !== null && "accroche",
    saved.qrUrl !== null && "QR code",
    (saved.hideLogo || saved.logo) && "logo",
  ].filter(Boolean);
  const locked = disabled || busy;

  const fields: { id: Field; label: string; max: number; placeholder: string; empty: string }[] = [
    { id: "tagline", label: "Accroche", max: SIGNATURE_LIMITS.taglineMax, placeholder: "Ex. : Formation Next.js", empty: "Vide : pas d'accroche dans cette vidéo." },
    { id: "qrUrl", label: "Lien du QR code", max: SIGNATURE_LIMITS.qrUrlMax, placeholder: "https://…", empty: "Vide : pas de QR code dans cette vidéo." },
  ];

  return (
    <div className="rounded-lg border border-line">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="signature-override"
        className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left transition-colors duration-150 hover:bg-hover"
      >
        <span className="flex items-center gap-2 text-sm font-medium">
          <SlidersHorizontal className="size-4 text-quiet" aria-hidden />
          Personnaliser pour cette vidéo
        </span>
        <span className="flex items-center gap-2 text-xs text-muted">
          {dirty ? "Modifications non enregistrées" : customized ? `Personnalisée : ${changes.join(", ")}` : "Identique à la signature"}
          <ChevronDown className={`size-4 transition-transform duration-150 ${open ? "rotate-180" : ""}`} aria-hidden />
        </span>
      </button>

      {open && (
        <div id="signature-override" className="grid gap-6 border-t border-line p-4 sm:p-6 md:grid-cols-[1fr_180px]">
          <div className="flex flex-col gap-5">
            <p className="text-xs text-quiet">
              Ces réglages s&apos;appliquent seulement à ce projet, par-dessus la signature « {base.name} ». La signature
              elle-même ne change pas.
            </p>

            {fields.map((field) => {
              const id = `override-${field.id}`;
              const error = errors[field.id];
              const own = draft[field.id] !== null;
              return (
                <div key={field.id} className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label htmlFor={id} className="text-sm font-medium">
                      {field.label}
                    </label>
                    {own && (
                      <button
                        type="button"
                        onClick={() => resetField(field.id)}
                        disabled={locked}
                        className="inline-flex items-center gap-1 text-xs text-muted transition-colors duration-150 hover:text-ink disabled:opacity-50"
                      >
                        <RotateCcw className="size-3.5" aria-hidden />
                        Reprendre celle de la signature
                      </button>
                    )}
                  </div>
                  <input
                    id={id}
                    value={shown[field.id]}
                    onChange={(event) => setField(field.id, event.target.value)}
                    maxLength={field.max}
                    placeholder={field.placeholder}
                    inputMode={field.id === "qrUrl" ? "url" : undefined}
                    disabled={locked}
                    aria-invalid={Boolean(error)}
                    aria-describedby={`${id}-${error ? "error" : "hint"}`}
                    className={inputClass}
                  />
                  {error ? (
                    <p id={`${id}-error`} className={fieldErrorClass}>
                      {error}
                    </p>
                  ) : (
                    <p id={`${id}-hint`} className="text-xs text-quiet">
                      {own ? "Propre à cette vidéo." : "Celle de la signature."} {field.empty}
                    </p>
                  )}
                </div>
              );
            })}

            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">Logo</span>
              <p className="text-xs text-muted">
                {draft.logoMode === "none"
                  ? "Pas de logo dans cette vidéo."
                  : draft.logoMode === "own"
                    ? "Logo propre à cette vidéo."
                    : base.logoUrl
                      ? "Logo de la signature."
                      : "La signature n'a pas de logo."}
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => fileInput.current?.click()} disabled={locked} className={buttonSecondary}>
                  <ImagePlus className="size-4" aria-hidden />
                  {draft.logoMode === "own" ? "Changer le logo" : "Logo pour cette vidéo"}
                </button>
                {draft.logoMode !== "signature" && (
                  <button type="button" onClick={() => setLogoMode("signature")} disabled={locked} className={buttonSecondary}>
                    <RotateCcw className="size-4" aria-hidden />
                    Logo de la signature
                  </button>
                )}
                {draft.logoMode !== "none" && (logoUrl || draft.logoMode === "own") && (
                  <button type="button" onClick={() => setLogoMode("none")} disabled={locked} className={buttonSecondary}>
                    <ImageOff className="size-4" aria-hidden />
                    Sans logo
                  </button>
                )}
              </div>
              <p className="text-xs text-quiet">PNG, JPEG ou WebP, 2 Mo au plus.</p>
              <input ref={fileInput} type="file" accept={LOGO_TYPES.join(",")} onChange={chooseLogo} className="hidden" />
            </div>

            <div className="flex flex-col-reverse gap-2 border-t border-line pt-5 sm:flex-row sm:justify-end">
              {(customized || dirty) && (
                <button type="button" onClick={customized ? restore : () => commit(saved)} disabled={locked} className={buttonSecondary}>
                  <RotateCcw className="size-4" aria-hidden />
                  {customized ? "Revenir à la signature" : "Annuler les modifications"}
                </button>
              )}
              <button type="button" onClick={save} disabled={locked || !dirty} className={buttonPrimary}>
                {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />}
                Enregistrer pour cette vidéo
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Aperçu</span>
            <SignaturePreview
              content={{ displayName: base.displayName, website: base.website, handle: base.handle, ...shown, logoUrl }}
              className="w-full max-w-[180px]"
            />
            <p className="text-xs text-quiet">Fixe ici ; animée dans la vidéo.</p>
          </div>
        </div>
      )}
    </div>
  );
}
