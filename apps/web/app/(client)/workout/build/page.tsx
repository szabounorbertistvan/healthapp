import Link from "next/link";
import { getProgram } from "@/lib/data";
import { hasActiveCoach } from "@/lib/client-data";
import { exerciseFacets } from "@/lib/exercise-library";
import { getMySoloProgramId } from "@/app/builder-actions";
import { SoloProgramBuilder } from "@/components/solo-program-builder";
import { NavIcon } from "@/components/client-nav";
import { Card } from "@/components/ui";
import { getI18n } from "@/lib/i18n/server";

/**
 * The client's own program builder. A client with an active coach does not
 * edit programs — theirs or the coach's — so the builder is not rendered for
 * them and the policies (can_edit_program) refuse any write that reaches the
 * database anyway. A solo client edits freely and is shown the way to a coach.
 */
export default async function BuildProgramPage() {
  const { t } = await getI18n();
  const coached = await hasActiveCoach();
  if (coached) {
    const c = t.clientApp.coachConnect;
    return (
      /* One form, one column: a readable width rather than a page-wide sprawl. */
      <div className="mx-auto max-w-3xl">
        <h1 className="font-display text-2xl font-extrabold leading-none tracking-tight sm:text-[28px]">{t.clientApp.builder.title}</h1>
        <Card plain className="mt-5 sm:mt-6 sm:p-5">
          <p className="font-display text-lg font-bold tracking-tight">{c.coachManagesTitle}</p>
          <p className="mt-1 text-sm text-ink-soft">{c.coachManagesBody}</p>
          <Link
            href="/workout"
            className="mt-4 inline-flex h-11 items-center gap-2 rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90"
          >
            <NavIcon d="m15 6-6 6 6 6" className="h-4 w-4 [stroke-width:2.2]" />
            {t.clientApp.workoutDay.backToTraining}
          </Link>
        </Card>
      </div>
    );
  }
  const programId = await getMySoloProgramId();
  const program = programId ? await getProgram(programId) : null;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-extrabold leading-none tracking-tight sm:text-[28px]">{t.clientApp.builder.title}</h1>
        <Link
          href="/exercises"
          className="inline-flex h-9 items-center gap-2 rounded-full bg-surface px-3.5 text-xs font-semibold text-ink-soft hover:text-ink sm:h-10 sm:px-4 sm:text-[13px]"
        >
          <NavIcon d="M4 4h12a2 2 0 0 1 2 2v14H6a2 2 0 0 0-2 2zM4 4v18M8 8h6" className="h-[17px] w-[17px]" />
          {t.clientApp.library.title}
        </Link>
      </div>

      <div className="mt-5 sm:mt-6">
        <SoloProgramBuilder program={program} equipment={exerciseFacets().equipment} />
      </div>
    </div>
  );
}
