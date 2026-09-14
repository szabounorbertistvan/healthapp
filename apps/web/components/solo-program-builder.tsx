"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { addSoloProgramDay, createSoloProgram, publishProgram, removeProgramDay } from "@/app/builder-actions";
import { SwipeToDelete } from "@/components/swipe-to-delete";
import { fill } from "@/lib/i18n";
import { ProgramDayEditor } from "@/components/program-day-editor";
import { MuscleGroupPicker, MUSCLE_GROUPS } from "@/components/muscle-group-picker";
import { Card } from "@/components/ui";
import { useI18n } from "@/lib/i18n/client";
import type { ProgramDetail } from "@/lib/types";

/** `equipment` is the library's facet list, so "create exercise" suggests the same gear names the coach sees. */
export function SoloProgramBuilder({ program, equipment = [] }: { program: ProgramDetail | null; equipment?: string[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
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

  if (!program) {
    return (
      <Card className="space-y-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t.clientApp.builder.namePlaceholder}
          className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <button
          type="button"
          disabled={pending || !name.trim()}
          onClick={() => run(() => createSoloProgram({ name, intensityMode: "rir" }))}
          className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-accent-fg disabled:opacity-40"
        >
          {t.clientApp.builder.create}
        </button>
        {error ? <p className="text-sm text-risk">{error}</p> : null}
      </Card>
    );
  }

  return (
    <div className="space-y-4">
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
          <ProgramDayEditor
            program={program}
            day={day}
            index={i}
            total={program.days.length}
            muscles={[...MUSCLE_GROUPS]}
            equipment={equipment}
            run={run}
            pending={pending}
          />
        </SwipeToDelete>
      ))}
      {program.days.length > 0 ? (
        <p className="text-[11px] text-ink-faint sm:hidden">{t.clientApp.workout.swipeHint}</p>
      ) : null}

      <Card className="space-y-3">
        <input
          value={dayName}
          onChange={(e) => setDayName(e.target.value)}
          placeholder={t.clientApp.builder.dayNamePlaceholder}
          className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
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
          className="w-full rounded-lg border border-line px-4 py-2 text-sm font-semibold hover:border-accent disabled:opacity-40"
        >
          {t.clientApp.builder.addDay}
        </button>
      </Card>

      <button
        type="button"
        disabled={pending || program.status === "published" || program.days.every((d) => d.exercises.length === 0)}
        onClick={() => run(() => publishProgram(program.id))}
        className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-accent-fg disabled:opacity-40"
      >
        {program.status === "published" ? t.clientApp.builder.published : t.clientApp.builder.publish}
      </button>
      <p className="text-xs text-ink-faint">{t.clientApp.builder.publishHint}</p>
      {error ? <p className="text-sm text-risk">{error}</p> : null}
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
  return (
    <Card className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="font-semibold">{c.haveCoach}</p>
        <p className="text-xs text-ink-soft">{c.haveCoachBody}</p>
      </div>
      <Link href="/coach" className="min-h-11 shrink-0 rounded-lg border border-line px-4 py-2.5 text-sm font-semibold hover:border-accent">
        {c.enterCode}
      </Link>
    </Card>
  );
}
