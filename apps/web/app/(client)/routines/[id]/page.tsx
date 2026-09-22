import Link from "next/link";
import { notFound } from "next/navigation";
import { canChangeVisibility, canCopyProgram, circuitSegments, estimateMinutes } from "@healthapp/shared";
import { getRoutineAssignees, getRoutineDetail, getRoutineUsage } from "@/lib/routine-data";
import { currentActorId } from "@/lib/actor";
import { hasActiveCoach } from "@/lib/client-data";
import { getRoster } from "@/lib/data";
import { fill } from "@/lib/i18n";
import { Card } from "@/components/ui";
import { NavIcon } from "@/components/client-nav";
import { RoutineActions, RoutineDetailsForm } from "@/components/routine-actions-ui";
import { SaveButton } from "@/components/routine-card";
import { getI18n } from "@/lib/i18n/server";

/**
 * One routine, front to back: what it is, who wrote it, every day and every
 * prescribed set — and the buttons that let you take it.
 *
 * RLS decides whether this page exists at all for a given reader: a private
 * routine returns nothing from getRoutineDetail even with a valid id, so the
 * 404 here is the policy speaking, not a check written in this file.
 */
export default async function RoutineDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { t } = await getI18n();
  const r = t.clientApp.routines;
  const { id } = await params;

  const detail = await getRoutineDetail(id);
  if (!detail) notFound();
  const { card, days } = detail;

  const viewerId = await currentActorId();
  if (!viewerId) notFound();
  const coached = await hasActiveCoach();
  const viewer = { id: viewerId, has_active_coach: coached };
  const mayCopy = canCopyProgram(card, viewer);
  const mayEdit = card.is_mine && (card.coach_id !== null || !coached);
  const mayPublish = canChangeVisibility(card, viewer);

  // Assign is a coach's move, so the client list is only fetched for one.
  // program_assignees() returns nothing to anyone but the authoring coach.
  const [clients, assignees, usage] = await Promise.all([
    card.coach_id === viewerId || card.is_mine ? myClients() : Promise.resolve([]),
    getRoutineAssignees(card.id),
    getRoutineUsage(card.id),
  ]);

  const totalMinutes = days.length
    ? Math.round(days.reduce((sum, d) => sum + estimateMinutes(d.exercises), 0) / days.length)
    : 0;

  const facts = [
    fill(r.daysCount, { count: card.days }),
    fill(r.exercisesCount, { count: card.exercises }),
    card.total_sets > 0 ? fill(r.setsCount, { count: card.total_sets }) : null,
    totalMinutes > 0 ? fill(r.aboutMinutes, { count: totalMinutes }) : null,
  ].filter((x): x is string => Boolean(x));

  const tags = [
    card.level ? r.level[card.level] : null,
    card.goal ? r.goal[card.goal] : null,
    card.visibility !== "private" ? r.visibility[card.visibility] : null,
  ].filter((x): x is string => Boolean(x));

  return (
    <div className="mx-auto max-w-[1600px]">
      <Link
        href="/routines"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-faint hover:text-accent-ink"
      >
        <NavIcon d="m15 6-6 6 6 6" className="h-3.5 w-3.5" />
        {r.title}
      </Link>

      <header className="mt-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-extrabold leading-tight tracking-tight sm:text-[28px]">
              {card.name}
            </h1>
            <p className="mt-1.5 text-[13px] text-ink-soft">{fill(r.by, { author: card.author_name })}</p>
          </div>
          <SaveButton card={card} withLabel />
        </div>

        {card.assigned_by_coach ? (
          <p className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1 text-[12px] font-semibold text-accent-ink">
            <NavIcon d="m5 12 5 5 9-10" className="h-3.5 w-3.5" />
            {r.assignedByCoach}
          </p>
        ) : null}

        {card.description ? <p className="mt-3 max-w-[70ch] text-[13.5px] text-ink-soft">{card.description}</p> : null}

        <p className="mt-3 text-[12.5px] tabular-nums text-ink-faint">{facts.join(" · ")}</p>
        {card.muscle_groups.length > 0 ? (
          <p className="mt-1 text-[12.5px] text-ink-faint">{card.muscle_groups.join(" · ")}</p>
        ) : null}
        {tags.length > 0 ? (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <span key={tag} className="rounded-full bg-surface px-2.5 py-0.5 text-[11px] font-semibold text-ink-soft">
                {tag}
              </span>
            ))}
          </div>
        ) : null}

        <RoutineActions card={card} canCopy={mayCopy} clients={clients} />
        {mayEdit ? <RoutineDetailsForm card={card} canPublish={mayPublish} /> : null}
      </header>

      {usage && (usage.copies > 0 || usage.completed > 0) ? (
        <p className="mt-5 text-[12.5px] tabular-nums text-ink-faint">
          {[
            usage.copies > 0 ? fill(r.copiesCount, { count: usage.copies }) : null,
            usage.users > 1 ? fill(r.peopleTraining, { count: usage.users }) : null,
            usage.completed > 0 ? fill(r.sessionsLogged, { count: usage.completed }) : null,
          ].filter(Boolean).join(" · ")}
        </p>
      ) : null}

      {assignees.length > 0 ? (
        <section className="mt-5">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{r.usedBy}</h2>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {assignees.map((a) => (
              <li key={a.program_id}>
                <Link
                  href={`/programs/${a.program_id}`}
                  className="inline-flex h-9 items-center rounded-full bg-surface px-3.5 text-[12.5px] font-semibold text-ink-soft hover:text-accent-ink"
                >
                  {a.client_name}
                  {a.status === "draft" ? <span className="ml-1.5 text-[10.5px] text-ink-faint">{r.draft}</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-6">
        <h2 className="font-display text-lg font-bold tracking-tight">{r.structure}</h2>
        {days.length === 0 ? (
          <p className="mt-2 text-sm text-ink-faint">{r.noDays}</p>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-[repeat(auto-fill,minmax(320px,1fr))]">
            {days.map((day, index) => (
              <Card plain key={day.id}>
                <div className="flex items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                      {fill(r.dayN, { n: index + 1 })}
                    </p>
                    <p className="mt-0.5 truncate font-display text-[17px] font-bold tracking-tight">{day.name}</p>
                  </div>
                  <span className="shrink-0 text-[11.5px] tabular-nums text-ink-faint">
                    {fill(r.aboutMinutes, { count: estimateMinutes(day.exercises) })}
                  </span>
                </div>

                {/* Circuits keep their bracket here too — a superset reads as a
                    superset on the shelf, not as three unrelated rows. */}
                <ul className="mt-3 space-y-2">
                  {circuitSegments(day.exercises).map((segment, si) => (
                    <li
                      key={segment.circuit ?? `solo-${si}`}
                      className={segment.circuit !== null ? "rounded-xl border-l-[3px] border-accent bg-accent-soft/40 py-1.5 pl-2.5" : ""}
                    >
                      <ul className="space-y-1.5">
                        {segment.exercises.map((e) => (
                          <li key={e.id} className="flex items-baseline justify-between gap-2">
                            <span className="min-w-0 truncate text-[13.5px]">{e.name}</span>
                            <span className="shrink-0 text-[12px] tabular-nums text-ink-faint">
                              {e.target_sets} × {e.target_reps}
                              {e.target_rpe !== null
                                ? ` · ${detail.intensity_mode === "rir" ? t.clientWidgets.setLogger.rir : t.clientWidgets.setLogger.rpe} ${e.target_rpe}`
                                : ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
                {day.exercises.length === 0 ? (
                  <p className="mt-2 text-[12.5px] text-ink-faint">—</p>
                ) : null}
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * A coach's active clients, for the Assign picker. Empty for anyone who is not
 * a coach — trainer_clients has no rows where they are the coach — so the
 * button simply is not drawn.
 */
async function myClients(): Promise<{ id: string; name: string }[]> {
  try {
    return await getRoster();
  } catch {
    return [];
  }
}
