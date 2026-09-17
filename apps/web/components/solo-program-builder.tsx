"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { addSoloProgramDay, createSoloProgram, publishProgram, removeProgramDay } from "@/app/builder-actions";
import { SwipeToDelete } from "@/components/swipe-to-delete";
import { fill } from "@/lib/i18n";
import { ProgramDayEditor } from "@/components/program-day-editor";
import { MuscleGroupPicker, MUSCLE_GROUPS } from "@/components/muscle-group-picker";
import { NavIcon } from "@/components/client-nav";
import { Card } from "@/components/ui";
import { useI18n } from "@/lib/i18n/client";
import type { ProgramDetail } from "@/lib/types";

/** `equipment` is the library's facet list, so "create exercise" suggests the same gear names the coach sees. */
export function SoloProgramBuilder({
  program,
  programs = [],
  equipment = [],
}: {
  program: ProgramDetail | null;
  /** Every program this client owns, so they can switch between them. */
  programs?: { id: string; name: string; status: string; days: number }[];
  equipment?: string[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  // The create form is always reachable, not only when there are no programs.
  const [creating, setCreating] = useState(false);
  const [dayName, setDayName] = useState("");
  const [groups, setGroups] = useState<string[]>([]);

  function run(action: () => Promise<{ ok: boolean; message?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.message ?? "Something went wrong");
      router.refresh();
    });
  }

  const createForm = (
    <Card plain className="space-y-3 sm:p-5">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t.clientApp.builder.namePlaceholder}
          className="w-full rounded-xl border border-line bg-bg px-3 py-2.5 text-sm outline-none placeholder:text-ink-faint focus:border-accent"
        />
      <button
        type="button"
        disabled={pending || !name.trim()}
        onClick={() =>
          run(async () => {
            const result = await createSoloProgram({ name, intensityMode: "rir" });
            if (result.ok) {
              setName("");
              setCreating(false);
              // Open the one just made rather than leaving the old program on
              // screen, which would read as "nothing happened".
              if (result.id) router.push(`/workout/build?program=${result.id}`);
            }
            return result;
          })
        }
        className="flex h-11 w-full items-center justify-center rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90 disabled:opacity-40"
      >
        {t.clientApp.builder.create}
      </button>
      {error ? <p className="text-sm font-semibold text-risk">{error}</p> : null}
    </Card>
  );

  if (!program) return createForm;

  return (
    <div className="space-y-4">
      {/* Which program is open, and the way to another one. Hidden while there
          is only one and nothing is being created, so a client with a single
          program sees exactly what they saw before. */}
      {programs.length > 1 || creating ? (
        <Card plain className="sm:p-5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            {t.clientApp.builder.yourPrograms}
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {programs.map((p) => (
              <Link
                key={p.id}
                href={`/workout/build?program=${p.id}`}
                className={`inline-flex flex-col rounded-2xl px-3.5 py-2 text-left ${
                  p.id === program.id ? "bg-accent-soft text-accent-ink" : "bg-bg text-ink-soft hover:text-ink"
                }`}
              >
                <span className="font-display text-[13.5px] font-bold">{p.name}</span>
                <span className="text-[11.5px] text-ink-faint">
                  {p.days === 1 ? t.clientApp.builder.dayCountOne : fill(t.clientApp.builder.dayCount, { count: p.days })}
                  {p.status === "draft" ? ` · ${t.clientApp.builder.draft}` : ""}
                </span>
              </Link>
            ))}
          </div>
        </Card>
      ) : null}

      {creating ? (
        <div className="space-y-2">
          {createForm}
          <button
            type="button"
            onClick={() => setCreating(false)}
            className="text-[12.5px] font-semibold text-ink-faint hover:text-ink"
          >
            {t.clientApp.builder.cancel}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-surface px-5 py-3 font-display text-[13.5px] font-bold text-ink-soft transition hover:bg-accent-soft/40 hover:text-ink"
          title={t.clientApp.builder.newProgramHint}
        >
          <NavIcon d="M12 5v14M5 12h14" className="h-4 w-4 [stroke-width:2.4]" />
          {t.clientApp.builder.newProgram}
        </button>
      )}

      {program.days.length === 0 ? (
        <p className="text-sm text-ink-faint">{t.clientApp.builder.noDays}</p>
      ) : null}

      {program.days.map((day, i) => (
        <SwipeToDelete
          key={day.id}
          confirmText={fill(t.clientApp.workout.deleteDayConfirm, { name: day.name })}
          onDelete={() =>
            new Promise<void>((resolve) => {
              run(async () => {
                const r = await removeProgramDay(program.id, day.id);
                resolve();
                return r;
              });
            })
          }
        >
          {/* The trash sits in the day header, where the coach builder keeps
              it too; SwipeToDelete's floating one would land on "+ Exercise". */}
          {(trigger) => (
            <ProgramDayEditor
              program={program}
              day={day}
              index={i}
              total={program.days.length}
              muscles={[...MUSCLE_GROUPS]}
              equipment={equipment}
              run={run}
              pending={pending}
              actions={trigger}
            />
          )}
        </SwipeToDelete>
      ))}
      {program.days.length > 0 ? (
        <p className="text-[11px] text-ink-faint sm:hidden">{t.clientApp.workout.swipeHint}</p>
      ) : null}

      <Card plain className="space-y-3 sm:p-5">
        <input
          value={dayName}
          onChange={(e) => setDayName(e.target.value)}
          placeholder={t.clientApp.builder.dayNamePlaceholder}
          className="w-full rounded-xl border border-line bg-bg px-3 py-2.5 text-sm outline-none placeholder:text-ink-faint focus:border-accent"
        />
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          {t.clientApp.builder.muscleGroups}
        </p>
        <MuscleGroupPicker selected={groups} onChange={setGroups} />
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            run(async () => {
              const r = await addSoloProgramDay(program.id, dayName, groups);
              if (r.ok) {
                setDayName("");
                setGroups([]);
              }
              return r;
            })
          }
          className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-line text-sm font-semibold hover:border-accent hover:text-accent-ink disabled:opacity-40"
        >
          <NavIcon d="M12 5v14M5 12h14" className="h-4 w-4 [stroke-width:2.2]" />
          {t.clientApp.builder.addDay}
        </button>
      </Card>

      <button
        type="button"
        disabled={pending || program.status === "published" || program.days.every((d) => d.exercises.length === 0)}
        onClick={() => run(() => publishProgram(program.id))}
        className="flex h-11 w-full items-center justify-center rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90 disabled:opacity-40"
      >
        {program.status === "published" ? t.clientApp.builder.published : t.clientApp.builder.publish}
      </button>
      <p className="text-[12.5px] text-ink-faint">{t.clientApp.builder.publishHint}</p>
      {error ? <p className="text-sm font-semibold text-risk">{error}</p> : null}
      <HaveACoach />
    </div>
  );
}

/**
 * The way back for a solo client who later gets an invitation code: the same
 * accept_invite() flow as onboarding, on the Coach page. Once the relationship
 * is active this builder turns read-only (can_edit_program) — the coach owns
 * the program from then on.
 */
export function HaveACoach() {
  const { t } = useI18n();
  const c = t.clientApp.coachConnect;
  // Full content width on the Training page, so the two halves must wrap: the
  // label keeps the row, the pill drops under it when there is no room.
  return (
    <Card plain className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 sm:p-5">
      <div className="min-w-0 flex-1">
        <p className="font-display text-lg font-bold tracking-tight">{c.haveCoach}</p>
        <p className="mt-0.5 text-[12.5px] leading-snug text-ink-faint">{c.haveCoachBody}</p>
      </div>
      <Link
        href="/coach"
        className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-bg px-4 text-[12.5px] font-semibold text-ink-soft hover:text-ink"
      >
        {c.enterCode}
        <NavIcon d="m9 6 6 6-6 6" className="h-[15px] w-[15px] [stroke-width:2.2]" />
      </Link>
    </Card>
  );
}
