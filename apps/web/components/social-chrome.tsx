"use client";

// The small pieces every shell needs: an avatar, who-can-see, and how a time
// reads. They used to live in social.tsx, which also holds the feed, so a
// layout that only drew a photo pulled the composer in with it — and
// social-v2.tsx imported them back, so the two files could not be split.
import type { PostVisibility } from "@healthapp/shared";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { parseDay } from "@/lib/week";
import { durationLabel } from "@/lib/share-card";
import { postAge } from "@/lib/post-card";

export function Avatar({ name, url, size = "h-9 w-9", initialClassName = "text-sm" }: {
  name: string;
  url: string | null;
  size?: string;
  /** The initial's type when there is no photo; a large avatar needs a larger letter. */
  initialClassName?: string;
}) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" className={`${size} shrink-0 rounded-full object-cover`} />
  ) : (
    <span className={`${size} flex shrink-0 items-center justify-center rounded-full bg-accent-soft ${initialClassName} font-bold text-accent-ink`}>
      {initial}
    </span>
  );
}

export function useSocialFormat() {
  const { t, locale } = useI18n();
  const tag = locale === "ro" ? "ro-RO" : "en-GB";
  const nf = new Intl.NumberFormat(tag);
  const df = new Intl.DateTimeFormat(tag, { day: "numeric", month: "short" });
  const dtf = new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const s = t.common.social;
  return {
    n: (v: number) => nf.format(v),
    day: (d: string) => df.format(parseDay(d)),
    /** "2m ago", "1h ago", "Yesterday", "3d ago", then the date — computed once, never ticking. */
    when: (iso: string) => {
      const age = postAge(iso, Date.now());
      switch (age.unit) {
        case "now": return s.justNow;
        case "minutes": return fill(s.minutesAgo, { m: age.n });
        case "hours": return fill(s.hoursAgo, { h: age.n });
        case "yesterday": return s.yesterday;
        case "days": return fill(s.daysAgo, { d: age.n });
        default: return dtf.format(new Date(iso));
      }
    },
    /** The exact moment, for a hover title next to the relative label. */
    at: (iso: string) => dtf.format(new Date(iso)),
    duration: durationLabel,
  };
}

export function VisibilityPicker({ value, onChange }: { value: PostVisibility; onChange: (v: PostVisibility) => void }) {
  const { t } = useI18n();
  const s = t.common.social;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{s.visibilityLabel}</span>
      <div className="inline-flex gap-1 rounded-full bg-bg p-1">
        {(["public", "followers", "private"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            className={`h-8 rounded-full px-3 text-[12.5px] font-semibold transition-colors ${
              value === v ? "bg-accent text-accent-fg" : "text-ink-soft hover:text-ink"
            }`}
          >
            {s.visibility[v]}
          </button>
        ))}
      </div>
    </div>
  );
}
