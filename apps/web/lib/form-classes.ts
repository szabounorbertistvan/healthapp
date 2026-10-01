/**
 * The settings-style form controls, in one place. These strings were copied
 * verbatim into account.tsx, rest-settings.tsx and challenge-create.tsx; the
 * coach profile wizard is the fourth user, so they live here now.
 */

/** A text input, select or textarea under its label. */
export const FIELD =
  "mt-1.5 h-11 w-full rounded-2xl bg-bg px-3.5 text-[14px] text-ink outline-none ring-accent/50 focus:ring-2";

/** The label wrapping a FIELD. */
export const LABEL = "block text-[13px] font-semibold text-ink-soft";

/** A hint line under a field. */
export const HINT = "mt-1.5 text-[12.5px] leading-relaxed text-ink-faint";

/** An error line under a field. */
export const FIELD_ERROR = "mt-1 block text-[12.5px] font-normal text-risk";

/** The primary action. */
export const BUTTON =
  "inline-flex h-11 items-center justify-center rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90 disabled:opacity-50";

/** A secondary action next to a field or a row. */
export const SMALL_BUTTON =
  "inline-flex h-9 items-center justify-center rounded-xl bg-bg px-3.5 text-[13px] font-semibold text-ink hover:bg-accent-soft/60 disabled:opacity-50";

/** SMALL_BUTTON for a row or panel that is itself `bg-bg` (where SMALL_BUTTON would vanish). */
export const SMALL_BUTTON_INSET =
  "inline-flex h-9 items-center justify-center rounded-xl bg-surface px-3.5 text-[13px] font-semibold text-ink hover:bg-accent-soft/60 disabled:opacity-50";

/** FIELD inside a `bg-bg` panel (a nested form): the input takes the surface colour instead. */
export const FIELD_INSET = FIELD.replace("bg-bg", "bg-surface");
