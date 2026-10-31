import { pluralCategory } from "@healthapp/i18n/plural";

/**
 * An adherence share (0..1, as packages/shared computes it and /api/v1 sends it)
 * as a whole percentage — the web's pct() in apps/web/lib/format.ts.
 */
export function percent(share: number): string {
  return `${Math.round((Number.isFinite(share) ? share : 0) * 100)}%`;
}

// The web's lib/format.ts timeAgo, word for word, so "3d ago" / "acum 3 zile"
// reads the same on both.

const TIME_WORDS = {
  en: { never: "never", today: "today", oneDay: "1d ago", days: (n: number) => `${n}d ago` },
  ro: { never: "niciodată", today: "azi", oneDay: "acum 1 zi", days: (n: number) => `acum ${n}${pluralCategory("ro", n) === "other" ? " de" : ""} zile` },
} as const;

export function timeAgo(iso: string | null, locale: "en" | "ro" = "en", now = Date.now()): string {
  const w = TIME_WORDS[locale];
  if (!iso) return w.never;
  const days = Math.floor((now - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return w.today;
  if (days === 1) return w.oneDay;
  return w.days(days);
}
