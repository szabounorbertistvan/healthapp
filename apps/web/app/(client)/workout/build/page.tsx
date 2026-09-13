import Link from "next/link";
import { getProgram } from "@/lib/data";
import { exerciseFacets } from "@/lib/exercise-library";
import { getMySoloProgramId } from "@/app/builder-actions";
import { SoloProgramBuilder } from "@/components/solo-program-builder";
import { PageTitle } from "@/components/ui";
import { getI18n } from "@/lib/i18n/server";

export default async function BuildProgramPage() {
  const { t } = await getI18n();
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
