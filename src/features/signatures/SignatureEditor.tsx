"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ImageOff, ImagePlus, LoaderCircle } from "lucide-react";
import { buttonPrimary, buttonSecondary } from "@/ui/buttons";
import { fieldErrorClass, inputClass } from "@/ui/fields";
import { useModal } from "@/ui/modal/ModalProvider";
import {
  checkLogoFile,
  createSignature,
  removeLogo,
  signatureErrorMessage,
  updateSignature,
  uploadLogo,
} from "./api";
import { SignaturePreview } from "./SignaturePreview";
import {
  LOGO_TYPES,
  SIGNATURE_LIMITS,
  validateSignatureInput,
  type SignatureInput,
  type SignatureView,
} from "./schema";

type Field = keyof SignatureInput;
type Errors = Partial<Record<Field, string>>;

const FIELDS: { id: Field; label: string; max: number; placeholder: string; optional: boolean; hint?: string }[] = [
  { id: "name", label: "Nom de la signature", max: SIGNATURE_LIMITS.nameMax, placeholder: "Ex. : JavaChrist principale", optional: false, hint: "Visible seulement dans le studio." },
  { id: "displayName", label: "Nom affiché", max: SIGNATURE_LIMITS.displayNameMax, placeholder: "Ex. : Chris", optional: true },
  { id: "tagline", label: "Accroche", max: SIGNATURE_LIMITS.taglineMax, placeholder: "Ex. : Développeur web et mobile", optional: true },
  { id: "website", label: "Site", max: SIGNATURE_LIMITS.websiteMax, placeholder: "Ex. : javachrist.fr", optional: true },
  { id: "handle", label: "Pseudo", max: SIGNATURE_LIMITS.handleMax, placeholder: "Ex. : @javachrist", optional: true },
  { id: "qrUrl", label: "Lien du QR code", max: SIGNATURE_LIMITS.qrUrlMax, placeholder: "https://…", optional: true, hint: "Vide : pas de QR code." },
];

const EMPTY: SignatureInput = { name: "", displayName: "", tagline: "", website: "", handle: "", qrUrl: "" };

const pick = (signature: SignatureView | null): SignatureInput =>
  signature
    ? {
        name: signature.name,
        displayName: signature.displayName,
        tagline: signature.tagline,
        website: signature.website,
        handle: signature.handle,
        qrUrl: signature.qrUrl,
      }
    : EMPTY;

/** Logo choisi dans ce formulaire, pas encore envoyé : l'aperçu passe par une URL locale. */
type LocalLogo = { file: File; url: string };

export function SignatureEditor({
  signature,
  onSaved,
  onCancel,
  onBusyChange,
  bare = false,
}: {
  /** null : nouvelle signature. */
  signature: SignatureView | null;
  onSaved: (signature: SignatureView) => void;
  onCancel: () => void;
  /** Prévient le conteneur pendant l'enregistrement (une fenêtre ne doit pas se fermer à ce moment-là). */
  onBusyChange?: (busy: boolean) => void;
  /** Sans cadre : le formulaire est déjà dans une fenêtre. */
  bare?: boolean;
}) {
  const router = useRouter();
  const modal = useModal();
  const [values, setValues] = useState<SignatureInput>(() => pick(signature));
  const [errors, setErrors] = useState<Errors>({});
  const [localLogo, setLocalLogo] = useState<LocalLogo | null>(null);
  const [dropLogo, setDropLogo] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const localUrl = useRef<string | null>(null);

  useEffect(() => onBusyChange?.(busy), [busy, onBusyChange]);

  // Libère l'image locale en quittant le formulaire.
  useEffect(() => () => {
    if (localUrl.current) URL.revokeObjectURL(localUrl.current);
  }, []);

  const replaceLocalLogo = (next: LocalLogo | null) => {
    if (localUrl.current) URL.revokeObjectURL(localUrl.current);
    localUrl.current = next?.url ?? null;
    setLocalLogo(next);
  };

  const setField = (field: Field, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      if (!current[field]) return current;
      const rest = { ...current };
      delete rest[field];
      return rest;
    });
  };

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
    setDropLogo(false);
  };

  const clearLogo = () => {
    replaceLocalLogo(null);
    setDropLogo(true);
  };

  const shownLogoUrl = localLogo?.url ?? (dropLogo ? null : (signature?.logoUrl ?? null));

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Même validation que le serveur : les erreurs s'affichent sans aller-retour.
    const local = validateSignatureInput(values);
    if (!local.ok) {
      setErrors(local.errors);
      document.getElementById(`signature-${Object.keys(local.errors)[0]}`)?.focus();
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const saved = signature ? await updateSignature(signature.id, local.value) : await createSignature(local.value);
      if (!saved.ok) {
        if (saved.error === "unauthorized") return router.replace("/connexion");
        if (saved.error === "invalid_input" && saved.fields) return setErrors(saved.fields);
        return void (await modal.error({ title: "Enregistrement impossible", body: signatureErrorMessage(saved.error) }));
      }

      // Les textes sont enregistrés ; le logo suit dans une seconde requête.
      let result = saved.signature;
      const logoStep = localLogo
        ? await uploadLogo(result.id, localLogo.file)
        : dropLogo && result.logo
          ? await removeLogo(result.id)
          : null;
      if (logoStep?.ok) result = logoStep.signature;
      onSaved(result);
      if (logoStep?.ok === false && logoStep.error === "unauthorized") return router.replace("/connexion");
      if (logoStep?.ok === false) {
        await modal.error({
          title: "Logo non enregistré",
          body: `Les textes sont enregistrés, mais pas le logo. ${signatureErrorMessage(logoStep.error)}`,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className={`grid gap-8 md:grid-cols-[1fr_220px] ${bare ? "" : "rounded-lg border border-line p-4 sm:p-6"}`}
    >
      <div className="flex flex-col gap-5">
        <h2 id={bare ? "signature-editor-title" : undefined} className="text-lg font-medium">
          {signature ? "Modifier la signature" : "Nouvelle signature"}
        </h2>

        {FIELDS.map((field) => {
          const id = `signature-${field.id}`;
          const error = errors[field.id];
          return (
            <div key={field.id} className="flex flex-col gap-2">
              <label htmlFor={id} className="text-sm font-medium">
                {field.label} {field.optional && <span className="font-normal text-quiet">(facultatif)</span>}
              </label>
              <input
                id={id}
                value={values[field.id]}
                onChange={(event) => setField(field.id, event.target.value)}
                maxLength={field.max}
                placeholder={field.placeholder}
                inputMode={field.id === "qrUrl" ? "url" : undefined}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? `${id}-error` : field.hint ? `${id}-hint` : undefined}
                className={inputClass}
              />
              {error ? (
                <p id={`${id}-error`} className={fieldErrorClass}>
                  {error}
                </p>
              ) : (
                field.hint && (
                  <p id={`${id}-hint`} className="text-xs text-quiet">
                    {field.hint}
                  </p>
                )
              )}
            </div>
          );
        })}

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">
            Logo <span className="font-normal text-quiet">(facultatif)</span>
          </span>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => fileInput.current?.click()} disabled={busy} className={buttonSecondary}>
              <ImagePlus className="size-4" aria-hidden />
              {shownLogoUrl ? "Changer le logo" : "Choisir un logo"}
            </button>
            {shownLogoUrl && (
              <button type="button" onClick={clearLogo} disabled={busy} className={buttonSecondary}>
                <ImageOff className="size-4" aria-hidden />
                Retirer
              </button>
            )}
          </div>
          <p className="text-xs text-quiet">PNG, JPEG ou WebP, 2 Mo au plus. Un fond transparent rend mieux sur la vidéo.</p>
          <input ref={fileInput} type="file" accept={LOGO_TYPES.join(",")} onChange={chooseLogo} className="hidden" />
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-line pt-5 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} disabled={busy} className={buttonSecondary}>
            Annuler
          </button>
          <button type="submit" disabled={busy} className={buttonPrimary}>
            {busy && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
            {signature ? "Enregistrer" : "Créer la signature"}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2 md:pt-11">
        <span className="text-sm font-medium">Aperçu</span>
        <SignaturePreview content={{ ...values, logoUrl: shownLogoUrl }} className="w-full max-w-[220px]" />
        <p className="text-xs text-quiet">Fixe ici ; animée dans la vidéo, après la voix.</p>
      </div>
    </form>
  );
}
