import Link from "next/link";
import type { Locale } from "@/lib/i18n";
import { fill, type Dictionary } from "@/lib/i18n";
import type { TimelineEvent } from "@/lib/admin/types";
import { fmtDateTime } from "./ui";

type Kinds = Dictionary["admin"]["user"]["timeline"]["kinds"];

/** One event: when, what, and the detail the row's kind carries. Kinds map straight to dictionary keys. */
function describe(e: TimelineEvent, t: Dictionary["admin"]["user"]["timeline"]): { label: string; title: string | null; detail: string | null } {
  const label = (t.kinds as Record<string, string>)[e.kind as keyof Kinds] ?? e.kind;
  const parts = (e.detail ?? "").split("|");
  switch (e.kind) {
    case "set_logged":
      return { label, title: e.title, detail: fill(t.set, { kg: parts[0] ?? "0", reps: parts[1] ?? "0" }) + (parts[2] ? ` · RPE ${parts[2]}` : "") };
    case "food_logged":
      return { label, title: e.title, detail: fill(t.food, { g: parts[0] ?? "", kcal: parts[1] ?? "" }) + (parts[2] ? ` · ${parts[2]}` : "") };
    case "workout_completed":
      return { label, title: e.title, detail: e.detail ? fill(t.duration, { n: e.detail }) : null };
    case "rest_timer":
      return { label, title: e.title ? fill(t.rest, { n: e.title }) : null, detail: e.detail };
    case "measurement":
      return { label, title: e.title ? fill(t.weight, { kg: e.title }) : null, detail: e.detail };
    default:
      return { label, title: e.title || null, detail: e.detail || null };
  }
}

function entityHref(e: TimelineEvent): string | null {
  if (!e.entity_id) return null;
  if (e.entity_type === "user") return `/admin/users/${e.entity_id}`;
  if (e.entity_type === "post") return `/admin/social/${e.entity_id}`;
  if (e.entity_type === "challenge") return `/admin/challenges/${e.entity_id}`;
  return null;
}

export function Timeline({ events, locale, t, moreHref }: { events: TimelineEvent[]; locale: Locale; t: Dictionary["admin"]["user"]["timeline"]; moreHref: string | null }) {
  if (events.length === 0) return <p className="text-[13px] text-ink-faint">{t.empty}</p>;
  return (
    <div>
      <ol className="relative ml-2 border-l border-line/70 pl-4">
        {events.map((e, i) => {
          const d = describe(e, t);
          const href = entityHref(e);
          const admin = e.kind.startsWith("user_suspended") || e.kind.startsWith("user_reactivated") || e.kind === "admin_action" || e.kind === "login_failed";
          return (
            <li key={`${i}-${e.kind}-${e.entity_id ?? ""}`} className="relative py-2">
              <span className={`absolute -left-[21px] top-[15px] h-2.5 w-2.5 rounded-full ${admin ? "bg-warn" : e.kind === "workout_completed" || e.kind === "challenge_completed" ? "bg-accent" : "bg-line"}`} />
              <p className="text-[11px] tabular-nums text-ink-faint">{fmtDateTime(e.occurred_at, locale)}</p>
              <p className="text-[13.5px] font-semibold leading-snug">
                {d.label}
                {d.title ? <span className="font-medium text-ink-soft"> · {href ? <Link href={href} className="hover:text-accent-ink">{d.title}</Link> : d.title}</span> : null}
              </p>
              {d.detail ? <p className="text-[12.5px] text-ink-soft">{d.detail}</p> : null}
            </li>
          );
        })}
      </ol>
      {moreHref ? (
        <Link href={moreHref} className="mt-3 inline-flex h-9 items-center rounded-full bg-surface px-4 text-[12.5px] font-semibold text-ink-soft hover:text-ink">{t.more}</Link>
      ) : null}
    </div>
  );
}
