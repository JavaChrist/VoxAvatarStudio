"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Check, LoaderCircle, UserRound } from "lucide-react";
import { OUTFITS, POSES, POSE_LABELS, sameAppearance, type Appearance, type Pose } from "@/features/projects/appearance";
import { hasActiveAvatar, isAvatarOtherAppearance, type AvatarVideos } from "@/features/projects/video";
import { useModal } from "@/ui/modal/ModalProvider";

/** Messages affichés pour chaque code d'erreur renvoyé par l'API. */
const APPEARANCE_ERRORS: Record<string, string> = {
  pose_invalid: "Cette pose n'existe pas.",
  outfit_invalid: "Cette tenue n'existe plus. Recharge la page.",
  pose_unavailable: "Cette tenue n'existe pas dans cette pose.",
  video_in_progress: "Une vidéo de Chris est en cours. Attends qu'elle soit terminée pour changer de tenue.",
  not_found: "Ce projet n'existe plus.",
};

interface Props {
  projectId: string;
  appearance: Appearance;
  avatars: AvatarVideos;
}

/** Tenue et pose de Chris pour ce projet. Gratuit, mais une vidéo de Chris faite avec une autre apparence est à refaire. */
export function CharacterPanel({ projectId, appearance, avatars }: Props) {
  const router = useRouter();
  const modal = useModal();
  const [pose, setPose] = useState<Pose>(appearance.pose);
  const [saving, setSaving] = useState<string | null>(null);
  const busy = hasActiveAvatar(avatars);

  const choose = async (outfit: string) => {
    const next: Appearance = { outfit, pose };
    if (sameAppearance(next, appearance)) return;
    // Les vidéos de Chris déjà faites avec l'apparence actuelle deviendront périmées.
    const affected = Object.values(avatars).filter((video) => video.state === "done" && !isAvatarOtherAppearance(video, appearance));
    if (affected.length > 0) {
      const name = OUTFITS.find((o) => o.id === outfit)?.name ?? outfit;
      const ok = await modal.confirm({
        title: `Passer à « ${name} », ${POSE_LABELS[pose].toLowerCase()} ?`,
        body: [
          affected.length > 1
            ? `Les ${affected.length} vidéos de Chris de ce projet ont été faites avec l'apparence actuelle : elles deviendront périmées.`
            : "La vidéo de Chris de ce projet a été faite avec l'apparence actuelle : elle deviendra périmée.",
          "Pour le montage, il faudra regénérer Chris avec Kling, un appel facturé sur ton compte fal.",
          "Tu peux revenir à l'apparence actuelle plus tard : les vidéos redeviendront utilisables.",
        ].join(" "),
        confirmLabel: "Changer",
        cancelLabel: "Annuler",
      });
      if (!ok) return;
    }

    setSaving(outfit);
    try {
      const response = await fetch(`/api/projects/${projectId}/appearance`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next),
      });
      if (response.status === 401) return router.replace("/connexion");
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.project) {
        await modal.error({
          title: "Tenue non enregistrée",
          body: APPEARANCE_ERRORS[data?.error] ?? "Le choix n'a pas pu être enregistré. Réessaie dans un instant.",
        });
        return;
      }
      // Les panneaux Vidéo et Montage relisent l'apparence du projet.
      router.refresh();
    } catch {
      await modal.error({ title: "Tenue non enregistrée", body: "La connexion au serveur a échoué. Vérifie ta connexion et réessaie." });
    } finally {
      setSaving(null);
    }
  };

  const current = OUTFITS.find((o) => o.id === appearance.outfit);

  return (
    <section className="mt-10 flex flex-col gap-4" aria-busy={saving !== null}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <UserRound className="size-4 text-quiet" aria-hidden />
          Personnage
        </h2>
        <div role="radiogroup" aria-label="Pose de Chris" className="inline-flex rounded-lg border border-line p-0.5">
          {POSES.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={pose === option}
              onClick={() => setPose(option)}
              className={`min-h-9 rounded-md px-4 text-sm transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                pose === option ? "bg-hover text-ink" : "text-muted hover:text-ink"
              }`}
            >
              {POSE_LABELS[option]}
            </button>
          ))}
        </div>
      </div>

      <p className="text-sm text-muted">
        Actuellement : <span className="text-ink">{current?.name ?? appearance.outfit}</span>, {POSE_LABELS[appearance.pose].toLowerCase()}.
        {" "}Choisis une tenue pour l&apos;appliquer à ce projet.
      </p>

      {busy && (
        <p className="text-sm text-accent-soft">Une vidéo de Chris est en cours : la tenue pourra changer une fois terminée.</p>
      )}

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {OUTFITS.map((outfit) => {
          const spec = outfit.poses[pose];
          const selected = outfit.id === appearance.outfit && pose === appearance.pose;
          const disabled = !spec || busy || saving !== null;
          return (
            <li key={outfit.id}>
              <button
                type="button"
                onClick={() => choose(outfit.id)}
                disabled={disabled}
                aria-pressed={selected}
                className={`group relative flex w-full flex-col overflow-hidden rounded-lg border text-left transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed ${
                  selected ? "border-accent" : "border-line enabled:hover:border-line-strong"
                }`}
              >
                <span className="relative block h-40 bg-hover">
                  {spec ? (
                    <Image
                      src={spec.thumbnail}
                      alt=""
                      fill
                      sizes="200px"
                      className={`object-contain object-bottom ${busy && !selected ? "opacity-50" : ""}`}
                    />
                  ) : (
                    <span className="flex size-full items-center justify-center px-3 text-center text-xs text-quiet">
                      Pas disponible {POSE_LABELS[pose].toLowerCase()}
                    </span>
                  )}
                  {selected && (
                    <span className="absolute top-2 right-2 inline-flex size-6 items-center justify-center rounded-full bg-accent text-black">
                      <Check className="size-3.5" aria-hidden />
                    </span>
                  )}
                  {saving === outfit.id && (
                    <span className="absolute inset-0 flex items-center justify-center bg-black/50">
                      <LoaderCircle className="size-5 animate-spin text-ink" aria-hidden />
                    </span>
                  )}
                </span>
                <span className={`px-3 py-2 text-sm ${spec ? "text-ink" : "text-quiet"}`}>{outfit.name}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <p className="text-xs text-quiet">
        Le changement est gratuit. Une vidéo de Chris faite avec une autre tenue ou une autre pose est à regénérer avant le montage (Kling, payant).
      </p>
    </section>
  );
}
