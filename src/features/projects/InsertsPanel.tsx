"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ImageIcon, ImagePlus, Images, LoaderCircle, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { SHOT_LABELS, shotNeedsImage, type Script } from "@/features/projects/script";
import { isVoiceStale, type Voice } from "@/features/projects/voice";
import { buttonSecondary } from "@/ui/buttons";
import { useModal } from "@/ui/modal/ModalProvider";
import { checkInsertFile, fetchInserts, generateInsert, insertErrorMessage, removeInsert, uploadInsert } from "./inserts-api";
import { GENERATED_IMAGE_COST_LABEL, IMAGE_DESCRIPTION, INSERT_EXTENSIONS, INSERT_TYPES, type InsertView } from "./inserts";

/** Types et extensions acceptés par le sélecteur de fichier. */
const ACCEPT = [...INSERT_TYPES, ...Object.values(INSERT_EXTENSIONS).map((ext) => `.${ext}`), ".jpeg"].join(",");

const formatSeconds = (seconds: number) => `${seconds.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} s`;
const formatSize = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024)).toLocaleString("fr-FR")} Ko`
    : `${(bytes / (1024 * 1024)).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`;

const iconButton = `${buttonSecondary} px-3`;

interface Props {
  projectId: string;
  script: Script | null;
  voice: Voice | null;
  /** Null si la liste n'a pas pu être lue côté serveur. */
  initialInserts: InsertView[] | null;
}

/**
 * Images insérées : une image par scène du script, montrée selon le plan de la scène (carte au-dessus de Chris ou plein
 * écran). Envoi d'un fichier, remplacement et retrait sont gratuits ; la génération d'une image est facturée par fal et
 * toujours confirmée. L'image n'apparaît dans la vidéo qu'au prochain rendu.
 */
export function InsertsPanel({ projectId, script, voice, initialInserts }: Props) {
  const router = useRouter();
  const modal = useModal();
  const fileInput = useRef<HTMLInputElement>(null);
  const pendingScene = useRef<number | null>(null);
  // Un seul renouvellement automatique des liens d'aperçu, pour ne pas boucler si un fichier est absent.
  const refreshed = useRef(false);
  const [inserts, setInserts] = useState<InsertView[] | null>(initialInserts);
  const [busyScene, setBusyScene] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);

  if (!script) {
    return (
      <section className="mt-10 rounded-lg border border-line px-6 py-8 text-center">
        <Images className="mx-auto size-6 text-quiet" aria-hidden />
        <p className="mt-3 text-sm font-medium">Images</p>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted">Les images se placent sur les scènes du script, une fois celui-ci écrit.</p>
      </section>
    );
  }

  const byScene = new Map((inserts ?? []).map((insert) => [insert.scene, insert]));
  // Images posées sur des scènes qui n'existent plus (script raccourci) : ignorées au rendu, on propose de les retirer.
  const orphans = (inserts ?? []).filter((insert) => insert.scene >= script.scenes.length);
  const timings = voice && !isVoiceStale(voice, script) ? voice.scenes : null;
  const locked = busyScene !== null;

  const handleError = async (title: string, error: string) => {
    if (error === "unauthorized") return router.replace("/connexion");
    await modal.error({ title, body: insertErrorMessage(error) });
  };

  const pick = (scene: number) => {
    pendingScene.current = scene;
    fileInput.current?.click();
  };

  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    const scene = pendingScene.current;
    pendingScene.current = null;
    if (!file || scene === null) return;
    setBusyScene(scene);
    try {
      const checked = await checkInsertFile(file);
      if (!checked.ok) return void (await handleError("Image refusée", checked.error));
      const result = await uploadInsert(projectId, scene, file, checked.type);
      if (!result.ok) return void (await handleError("Envoi impossible", result.error));
      setInserts(result.inserts);
      refreshed.current = false;
    } finally {
      setBusyScene(null);
    }
  };

  /** Génération facturée : la description est relue et le prix confirmé avant tout appel. */
  const generate = async (scene: number, visualIntent: string) => {
    const replaced = byScene.has(scene) ? " L'image actuelle de la scène sera remplacée et supprimée définitivement." : "";
    const framing =
      script.scenes[scene]?.shot === "image_close"
        ? " Plan « Gros plan sur l'image » : elle est créée au format de la vidéo, pour remplir l'écran."
        : "";
    const description = await modal.ask({
      title: `Générer l'image de la scène ${scene + 1}`,
      body: `Décris ce qui doit apparaître. Le style cartoon 3D est ajouté automatiquement, sans texte ni présentateur.${framing} Coût : ${GENERATED_IMAGE_COST_LABEL}, facturé par fal.${replaced}`,
      field: {
        label: "Description de l'image",
        initialValue: visualIntent,
        minLength: IMAGE_DESCRIPTION.min,
        maxLength: IMAGE_DESCRIPTION.max,
        placeholder: "Un sujet concret : objet, lieu, personnes en situation",
      },
      confirmLabel: `Générer (${GENERATED_IMAGE_COST_LABEL})`,
      cancelLabel: "Annuler",
    });
    if (description === null) return;
    setBusyScene(scene);
    setGenerating(true);
    try {
      const result = await generateInsert(projectId, scene, description);
      if (result.ok) {
        setInserts(result.inserts);
        refreshed.current = false;
        return;
      }
      // La réponse a pu se perdre alors que l'image est arrivée : on relit la liste avant d'annoncer l'échec.
      const fresh = await fetchInserts(projectId);
      if (fresh.ok) setInserts(fresh.inserts);
      await handleError("Génération impossible", result.error);
    } finally {
      setBusyScene(null);
      setGenerating(false);
    }
  };

  const remove = async (insert: InsertView) => {
    const ok = await modal.destructive({
      title: "Retirer cette image ?",
      body: `L'image de la scène ${insert.scene + 1} sera supprimée définitivement. Les vidéos déjà montées ne changent pas. Cette action est irréversible.`,
      confirmLabel: "Retirer l'image",
      cancelLabel: "Annuler",
    });
    if (!ok) return;
    setBusyScene(insert.scene);
    try {
      const result = await removeInsert(projectId, insert.scene);
      if (result.ok) {
        setInserts(result.inserts);
        return;
      }
      // Déjà retirée ailleurs : on recharge simplement la liste.
      if (result.error === "not_found") {
        const fresh = await fetchInserts(projectId);
        if (fresh.ok) return setInserts(fresh.inserts);
      }
      await handleError("Retrait impossible", result.error);
    } finally {
      setBusyScene(null);
    }
  };

  /** Lien d'aperçu expiré (15 min) : on redemande la liste une fois. */
  const onThumbError = async () => {
    if (refreshed.current) return;
    refreshed.current = true;
    const fresh = await fetchInserts(projectId);
    if (fresh.ok) setInserts(fresh.inserts);
  };

  const thumbnail = (insert: InsertView | undefined, scene: number) => (
    <div className="flex aspect-video w-full shrink-0 items-center justify-center overflow-hidden rounded-md border border-line bg-hover sm:w-32">
      {busyScene === scene ? (
        <LoaderCircle className="size-5 animate-spin text-quiet" aria-hidden />
      ) : insert?.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- lien signé temporaire de Storage, hors optimiseur d'images
        <img key={insert.imageUrl} src={insert.imageUrl} alt={`Image de la scène ${scene + 1}`} onError={onThumbError} className="size-full object-contain" />
      ) : (
        <ImageIcon className="size-5 text-quiet" aria-hidden />
      )}
    </div>
  );

  return (
    <section className="mt-10 flex flex-col gap-4" aria-busy={locked}>
      <div>
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <Images className="size-4 text-quiet" aria-hidden />
          Images
        </h2>
        <p className="mt-2 text-sm text-muted">
          Une image par scène. Le plan de la scène, choisi dans le script, dit comment elle apparaît : en carte au-dessus de Chris, ou en
          grand à sa place. Ajoute un fichier (PNG, JPEG ou WebP, 10 Mo au plus) ou génère l&apos;image à partir d&apos;une description (
          {GENERATED_IMAGE_COST_LABEL} par image). Pour un gros plan, l&apos;image générée est au format de la vidéo ; une image d&apos;une
          autre forme est montrée entière sur un fond flou. Tout apparaît au prochain montage.
        </p>
      </div>

      {inserts === null && (
        <p className="flex items-center gap-2 rounded-lg border border-danger/60 px-4 py-3 text-sm text-danger">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          Les images n&apos;ont pas pu être chargées. Recharge la page avant d&apos;en ajouter.
        </p>
      )}

      {!timings && (
        <p className="text-xs text-quiet">
          {voice
            ? "La voix est périmée : le minutage des images suivra la voix régénérée."
            : "Le minutage de chaque image viendra de la voix, une fois générée."}
        </p>
      )}

      <ol className="flex flex-col gap-3">
        {script.scenes.map((scene, index) => {
          const insert = byScene.get(index);
          const timing = timings?.[index];
          return (
            <li key={index} className="flex flex-col gap-3 rounded-lg border border-line p-3 sm:flex-row sm:items-center">
              {thumbnail(insert, index)}
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-quiet">
                  <span className="font-medium text-ink">Scène {index + 1}</span>
                  <span>{scene.shot ? SHOT_LABELS[scene.shot] : "Plan automatique"}</span>
                  {timing && (
                    <span className="tabular-nums">
                      {formatSeconds(timing.start)} → {formatSeconds(timing.end)}
                    </span>
                  )}
                  {insert && (
                    <span>
                      {INSERT_EXTENSIONS[insert.contentType].toUpperCase()} · {formatSize(insert.sizeBytes)}
                    </span>
                  )}
                </p>
                <p className="mt-1 line-clamp-2 text-sm" title={scene.spokenText}>
                  {scene.spokenText}
                </p>
                {scene.visualIntent && (
                  <p className="mt-1 line-clamp-2 text-xs text-quiet" title={scene.visualIntent}>
                    Idée visuelle : {scene.visualIntent}
                  </p>
                )}
                {!insert && inserts !== null && shotNeedsImage(scene.shot) && (
                  <p className="mt-1 flex items-start gap-1.5 text-xs text-danger">
                    <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
                    Aucune image : Chris restera en cadrage normal.
                  </p>
                )}
                {insert && scene.shot && !shotNeedsImage(scene.shot) && (
                  <p className="mt-1 text-xs text-quiet">Ce plan ne montre pas l&apos;image.</p>
                )}
                {generating && busyScene === index && (
                  <p className="mt-1 text-xs text-accent-soft" aria-live="polite">
                    Génération de l&apos;image en cours…
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {insert ? (
                  <>
                    <button
                      type="button"
                      onClick={() => generate(index, scene.visualIntent)}
                      disabled={locked || inserts === null}
                      className={iconButton}
                      aria-label={`Générer une nouvelle image pour la scène ${index + 1}`}
                      title="Générer une nouvelle image"
                    >
                      <Sparkles className="size-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => pick(index)}
                      disabled={locked || inserts === null}
                      className={iconButton}
                      aria-label={`Remplacer l'image de la scène ${index + 1}`}
                      title="Remplacer"
                    >
                      <RefreshCw className="size-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(insert)}
                      disabled={locked}
                      className={`${iconButton} hover:border-danger/60 hover:text-danger`}
                      aria-label={`Retirer l'image de la scène ${index + 1}`}
                      title="Retirer"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => generate(index, scene.visualIntent)}
                      disabled={locked || inserts === null}
                      className={buttonSecondary}
                    >
                      <Sparkles className="size-4" aria-hidden />
                      Générer l&apos;image
                    </button>
                    <button type="button" onClick={() => pick(index)} disabled={locked || inserts === null} className={buttonSecondary}>
                      <ImagePlus className="size-4" aria-hidden />
                      Ajouter
                    </button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {orphans.length > 0 && (
        <div className="flex flex-col gap-3 rounded-lg border border-danger/60 p-3">
          <p className="flex items-center gap-2 text-sm text-danger">
            <AlertTriangle className="size-4 shrink-0" aria-hidden />
            Ces images sont posées sur des scènes qui n&apos;existent plus dans le script : elles ne seront pas montées.
          </p>
          <ul className="flex flex-col gap-3">
            {orphans.map((insert) => (
              <li key={insert.scene} className="flex flex-col gap-3 sm:flex-row sm:items-center">
                {thumbnail(insert, insert.scene)}
                <p className="flex-1 text-sm text-muted">Ancienne scène {insert.scene + 1}</p>
                <button
                  type="button"
                  onClick={() => remove(insert)}
                  disabled={locked}
                  className={`${iconButton} hover:border-danger/60 hover:text-danger`}
                  aria-label={`Retirer l'image de l'ancienne scène ${insert.scene + 1}`}
                  title="Retirer"
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <input ref={fileInput} type="file" accept={ACCEPT} onChange={choose} className="hidden" />
    </section>
  );
}
