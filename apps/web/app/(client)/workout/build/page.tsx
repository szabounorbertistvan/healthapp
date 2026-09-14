import Link from "next/link";
import { getProgram } from "@/lib/data";
import { hasActiveCoach } from "@/lib/client-data";
import { exerciseFacets } from "@/lib/exercise-library";
import { getMySoloProgramId } from "@/app/builder-actions";
import { SoloProgramBuilder } from "@/components/solo-program-builder";
import { Card, PageTitle } from "@/components/ui";
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
      <div className="space-y-4">
        <PageTitle title={t.clientApp.builder.title} />
        <Card className="space-y-2">
          <p className="font-bold">{c.coachManagesTitle}</p>
          <p className="text-sm text-ink-soft">{c.coachManagesBody}</p>
          <Link href="/workout" className="inline-block rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-fg">
            {t.clientApp.workoutDay.backToTraining}
          </Link>
        </Card>
      </div>
    );
  }
  const programId = await getMySoloProgramId();
  const program = programId ? await getProgram(programId) : null;

  return (
    <div className="space-y-4">
      <PageTitle title={t.clientApp.builder.title}>
        <Link href="/exercises" className="text-xs font-semibold text-accent-ink hover:underline">
          {t.clientApp.library.title}
        </Link>
      </PageTitle>
      <SoloProgramBuilder program={program} equipment={exerciseFacets().equipment} />
    </div>
  );
}
