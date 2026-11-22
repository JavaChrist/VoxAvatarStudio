// Styles partagés des champs de formulaire.
export const inputClass =
  "h-10 w-full rounded-lg border border-line bg-black px-3 text-sm text-ink placeholder:text-quiet transition-colors duration-150 hover:border-line-strong focus:border-accent focus:outline-none aria-invalid:border-danger";

export const textareaClass = inputClass.replace("h-10", "min-h-28 py-2 leading-6");

/** Carte cliquable pour un choix (radio ou case à cocher) : l'input réel est masqué, la carte reflète son état. */
export const choiceClass =
  "flex cursor-pointer items-center gap-3 rounded-lg border border-line bg-black px-3 py-2.5 text-sm transition-colors duration-150 hover:border-line-strong has-checked:border-accent has-checked:bg-hover has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent";

export const fieldErrorClass = "text-sm text-danger";
