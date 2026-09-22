"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { RoutineCard } from "@healthapp/shared";
import { toggleRoutineSave } from "@/app/routine-actions";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { Card } from "./ui";
import { NavIcon } from "./client-nav";

/**
 * One routine on a shelf. The same card in My programs, Discover and Saved —
 * what changes is which badge it wears, not its shape.
 *
 * Everything on it is already in the row: program_card_rows() counts the days
 * and exercises and collects the muscle groups, so a grid of twenty of these
 * costs one query, not eighty.
 */
export function RoutineCardView({ card, href }: { card: RoutineCard; href?: string }) {
  const { t } = useI18n();
  const r = t.clientApp.routines;

  const facts = [
    fill(r.daysCount, { count: card.days }),
    fill(r.exercisesCount, { count: card.exercises }),
    card.est_minutes > 0 ? fill(r.aboutMinutes, { count: card.est_minutes }) : null,
  ].filter((x): x is string => Boolean(x));

  const tags = [
    card.level ? r.level[card.level] : null,
    card.goal ? r.goal[card.goal] : null,
  ].filter((x): x is string => Boolean(x));

  return (
    <Card plain className="flex h-full flex-col sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Link href={href ?? `/routines/${card.id}`} className="block min-w-0">
            <p className="truncate font-display text-lg font-bold leading-tight tracking-tight hover:text-accent-ink">
              {card.name}
            </p>
          </Link>
          <p className="mt-1 truncate text-[12.5px] text-ink-soft">{fill(r.by, { author: card.author_name })}</p>
        </div>
        <Badges card={card} />
      </div>

      <p className="mt-2.5 text-[12.5px] tabular-nums text-ink-faint">{facts.join(" · ")}</p>
      {card.muscle_groups.length > 0 ? (
        <p className="mt-1 line-clamp-1 text-[12px] text-ink-faint">{card.muscle_groups.join(" · ")}</p>
      ) : null}

      {tags.length > 0 ? (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <span key={tag} className="rounded-full bg-bg px-2.5 py-0.5 text-[11px] font-semibold text-ink-soft">
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      <div className="mt-auto flex items-center justify-between gap-2 pt-4">
        <div className="flex items-center gap-1.5">
          <SaveButton card={card} />
          {card.copy_count > 0 ? (
            <span className="text-[11.5px] tabular-nums text-ink-faint">
              {fill(r.copiesCount, { count: card.copy_count })}
            </span>
          ) : null}
        </div>
        <Link
          href={href ?? `/routines/${card.id}`}
          className="inline-flex h-9 shrink-0 items-center gap-1 rounded-full bg-accent-soft px-3.5 text-xs font-bold text-accent-ink hover:opacity-90"
        >
          {r.open}
          <NavIcon d="m9 6 6 6-6 6" className="h-[15px] w-[15px]" />
        </Link>
      </div>
    </Card>
  );
}

/** Who this routine belongs to, and how far it reaches. */
function Badges({ card }: { card: RoutineCard }) {
  const { t } = useI18n();
  const r = t.clientApp.routines;
  const badges: { text: string; tone: string }[] = [];
  if (card.assigned_by_coach) badges.push({ text: r.assignedByCoach, tone: "bg-accent-soft text-accent-ink" });
  if (card.visibility !== "private") {
    badges.push({ text: r.visibility[card.visibility], tone: "bg-bg text-ink-soft" });
  }
  if (card.is_mine && card.status === "draft") badges.push({ text: r.draft, tone: "bg-bg text-ink-faint" });
  if (badges.length === 0) return null;
  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      {badges.map((b) => (
        <span key={b.text} className={`rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold ${b.tone}`}>
          {b.text}
        </span>
      ))}
    </div>
  );
}

/**
 * The bookmark. Optimistic, because a heart that waits for a round trip feels
 * broken — and safe to be optimistic about, because the unique pair in the
 * database settles any race: a second tap that loses is reported as already
 * saved, not as an error.
 */
export function SaveButton({ card, withLabel = false }: { card: RoutineCard; withLabel?: boolean }) {
  const { t } = useI18n();
  const r = t.clientApp.routines;
  const router = useRouter();
  const [saved, setSaved] = useState(card.saved);
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      aria-pressed={saved}
      aria-label={saved ? r.unsave : r.save}
      onClick={() =>
        startTransition(async () => {
          const next = !saved;
          setSaved(next);
          const result = await toggleRoutineSave(card.id, saved);
          if (!result.ok) {
            setSaved(!next);
            return;
          }
          if (result.saved !== undefined) setSaved(result.saved);
          router.refresh();
        })
      }
      className={`inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold disabled:opacity-50 ${
        saved ? "bg-accent-soft text-accent-ink" : "bg-bg text-ink-soft hover:text-ink"
      }`}
    >
      <NavIcon
        d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"
        className={`h-[15px] w-[15px] ${saved ? "fill-current" : ""}`}
      />
      {withLabel ? (saved ? r.unsave : r.save) : null}
    </button>
  );
}
