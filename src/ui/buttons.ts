const base =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

export const buttonPrimary = `${base} bg-ink text-black hover:bg-white`;
export const buttonSecondary = `${base} border border-line-strong bg-black text-ink hover:bg-hover`;
export const buttonDanger = `${base} bg-danger text-white hover:bg-danger/85`;
