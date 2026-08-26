import type { Locale } from "@/lib/i18n";

const TIME_WORDS: Record<Locale, { never: string; today: string; oneDay: string; days: (n: number) => string }> = {
  en: { never: "never", today: "today", oneDay: "1d ago", days: (n) => `${n}d ago` },
  ro: { never: "niciodată", today: "azi", oneDay: "acum 1 zi", days: (n) => `acum ${n} zile` },
};

export function timeAgo(iso: string | null, locale: Locale = "en"): string {
  const w = TIME_WORDS[locale];
  if (!iso) return w.never;
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days <= 0) return w.today;
  if (days === 1) return w.oneDay;
  return w.days(days);
}

export function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}
