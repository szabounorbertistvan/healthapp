"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ProgramDetail } from "@/lib/types";
import { addProgramDay, duplicateProgramDay, publishProgram, removeProgramDay } from "@/app/builder-actions";
import { ProgramDayEditor } from "@/components/program-day-editor";
import { Card } from "@/components/ui";
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
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <StatusBadge status={program.status} />
          <span className="text-sm text-ink-soft">
            {program.client_name} ·{" "}
            {fill(
              program.weeks === 1 ? m.weeksOne : program.weeks < 20 ? m.weeksFew : m.weeksMany,
              { n: program.weeks },
            )}{" "}
            · {program.intensity_mode.toUpperCase()}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {error ? <span className="text-sm text-risk">{error}</span> : null}
          <button
            onClick={() =>
              run(() =>
                addProgramDay(program.id, fill(m.dayDefaultName, { n: program.days.length + 1 })),
              )
            }
            disabled={pending}
            className="rounded-lg border border-line px-3 py-2 text-sm font-semibold hover:border-accent disabled:opacity-50"
          >
            {m.addDay}
          </button>
          <button
            onClick={() => run(() => publishProgram(program.id))}
            disabled={pending || isEmpty || program.status === "published"}
            title={isEmpty ? m.publishHint : undefined}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg hover:opacity-90 disabled:opacity-50"
          >
            {program.status === "published" ? m.published : m.publish}
          </button>
        </div>
      </div>

      {program.status !== "published" ? (
        <p className="mb-4 rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">
          {fill(m.draftNotice, { name: program.client_name })}
        </p>
      ) : null}

      <div className="space-y-4">
        {program.days.length === 0 ? (
          <Card className="py-10 text-center">
            <p className="font-semibold">{m.noDaysTitle}</p>
            <p className="mt-1 text-sm text-ink-soft">{m.noDaysBody}</p>
          </Card>
        ) : null}

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
                  className="min-h-9 rounded-lg border border-line px-2.5 hover:border-accent disabled:opacity-50"
                >
                  {m.duplicate}
                </button>
                <button
                  onClick={() => { if (window.confirm(fill(t.clientApp.workout.deleteDayConfirm, { name: day.name }))) run(() => removeProgramDay(program.id, day.id)); }}
                  disabled={pending}
                  title={t.clientApp.workout.deleteDay}
                  aria-label={t.clientApp.workout.deleteDay}
                  className="min-h-9 rounded-lg border border-line px-2.5 text-ink-faint hover:border-risk hover:text-risk disabled:opacity-50"
                >
                  ×
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
    status === "published" ? "bg-accent-soft text-accent-ink" : "bg-bg text-ink-faint";
  return (
    <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${styles}`}>
      {t.coachWidgets.programBuilder.status[status]}
    </span>
  );
}
