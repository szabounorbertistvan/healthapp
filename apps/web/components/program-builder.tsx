"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ProgramDetail } from "@/lib/types";
import { addProgramDay, duplicateProgramDay, publishProgram, removeProgramDay } from "@/app/builder-actions";
import { ProgramDayEditor } from "@/components/program-day-editor";
import { NavIcon } from "@/components/client-nav";
import { Card, EmptyState } from "@/components/ui";
import { useI18n } from "@/lib/i18n/client";
import { fill } from "@/lib/i18n";

// W4 · Program builder. The wireframe puts the library in a left rail and the
// days as columns; here the library opens as a panel next to the day being
// edited, which keeps the same two-region shape on a laptop screen.

type Props = {
  program: ProgramDetail;
  muscles: string[];
  equipment: string[];
};

export function ProgramBuilder({ program, muscles, equipment }: Props) {
  const router = useRouter();
  const { t } = useI18n();
  const m = t.coachWidgets.programBuilder;
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<{ ok: boolean; message?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.message ?? m.somethingWentWrong);
      router.refresh();
    });
  }

  const isEmpty = program.days.every((d) => d.exercises.length === 0);

  return (
    <div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={program.status} />
          <span className="text-[12.5px] text-ink-soft">
            {program.client_name} ·{" "}
            {fill(
              program.weeks === 1 ? m.weeksOne : program.weeks < 20 ? m.weeksFew : m.weeksMany,
              { n: program.weeks },
            )}{" "}
            · {program.intensity_mode.toUpperCase()}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* The label already carries its own "+", so no icon next to it. */}
          <button
            onClick={() =>
              run(() =>
                addProgramDay(program.id, fill(m.dayDefaultName, { n: program.days.length + 1 })),
              )
            }
            disabled={pending}
            className="inline-flex h-11 items-center rounded-full bg-surface px-4 text-[12.5px] font-semibold text-ink-soft hover:text-ink disabled:opacity-50"
          >
            {m.addDay}
          </button>
          <button
            onClick={() => run(() => publishProgram(program.id))}
            disabled={pending || isEmpty || program.status === "published"}
            title={isEmpty ? m.publishHint : undefined}
            className="flex h-11 items-center justify-center rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90 disabled:opacity-50"
          >
            {program.status === "published" ? m.published : m.publish}
          </button>
        </div>
      </div>

      {/* Its own row rather than squeezed next to the buttons: a server message
          is a sentence, not a chip. */}
      {error ? (
        <Card plain className="mt-3 bg-risk-soft">
          <p className="text-sm font-semibold text-risk">{error}</p>
        </Card>
      ) : null}

      {program.status !== "published" ? (
        <p className="mt-3 rounded-2xl bg-warn-soft px-4 py-3 text-[12.5px] font-medium text-warn">
          {fill(m.draftNotice, { name: program.client_name })}
        </p>
      ) : null}

      <div className="mt-5 space-y-4 sm:mt-6">
        {program.days.length === 0 ? <EmptyState plain title={m.noDaysTitle} hint={m.noDaysBody} /> : null}

        {program.days.map((day, i) => (
          <ProgramDayEditor
            key={day.id}
            program={program}
            day={day}
            index={i}
            total={program.days.length}
            muscles={muscles}
            equipment={equipment}
            run={run}
            pending={pending}
            actions={
              <>
                <button
                  onClick={() => run(() => duplicateProgramDay(program.id, day.id))}
                  disabled={pending}
                  className="inline-flex h-9 items-center rounded-full bg-bg px-3.5 text-[12.5px] font-semibold text-ink-soft hover:text-ink disabled:opacity-50"
                >
                  {m.duplicate}
                </button>
                <button
                  onClick={() => { if (window.confirm(fill(t.clientApp.workout.deleteDayConfirm, { name: day.name }))) run(() => removeProgramDay(program.id, day.id)); }}
                  disabled={pending}
                  title={t.clientApp.workout.deleteDay}
                  aria-label={t.clientApp.workout.deleteDay}
                  className="grid h-9 w-9 place-items-center rounded-full bg-bg text-ink-faint hover:bg-risk-soft hover:text-risk disabled:opacity-50"
                >
                  <NavIcon d="M5 7h14M10 11v6M14 11v6M9 7V4h6v3M6 7l1 13h10l1-13" className="h-[17px] w-[17px]" />
                </button>
              </>
            }
          />
        ))}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: ProgramDetail["status"] }) {
  const { t } = useI18n();
  const styles =
    status === "published" ? "bg-accent-soft text-accent-ink" : "bg-surface text-ink-faint";
  return (
    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${styles}`}>
      {t.coachWidgets.programBuilder.status[status]}
    </span>
  );
}
