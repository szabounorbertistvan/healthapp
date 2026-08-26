import Link from "next/link";
import { notFound } from "next/navigation";
import { getProgram } from "@/lib/data";
import { exerciseFacets } from "@/lib/exercise-library";
import { PageTitle } from "@/components/ui";
import { ProgramBuilder } from "@/components/program-builder";
import { getI18n } from "@/lib/i18n/server";

export default async function ProgramPage({ params }: { params: Promise<{ id: string }> }) {
  const { t } = await getI18n();
  const { id } = await params;
  const program = await getProgram(id);
  if (!program) notFound();

  const facets = exerciseFacets();

  return (
    <div>
      <Link href="/programs" className="text-sm text-accent-ink hover:underline">
        {t.coachApp.programBuilderPage.back}
      </Link>
      <PageTitle title={program.name} />
      <ProgramBuilder program={program} muscles={facets.muscles} equipment={facets.equipment} />
    </div>
  );
}
