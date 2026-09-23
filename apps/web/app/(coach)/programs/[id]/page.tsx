import Link from "next/link";
import { notFound } from "next/navigation";
import { getActiveClientNames, getProgram } from "@/lib/data";
import { exerciseFacets } from "@/lib/exercise-library";
import { NavIcon } from "@/components/client-nav";
import { ProgramBuilder } from "@/components/program-builder";
import { getI18n } from "@/lib/i18n/server";

export default async function ProgramPage({ params }: { params: Promise<{ id: string }> }) {
  const { t } = await getI18n();
  const { id } = await params;
  const [program, clients] = await Promise.all([getProgram(id), getActiveClientNames()]);
  if (!program) notFound();

  const facets = exerciseFacets();

  // The builder is a work surface: it gets the full coach desk width.
  return (
    <div className="mx-auto max-w-[1600px]">
      <Link
        href="/programs"
        className="inline-flex h-9 items-center gap-1.5 rounded-full bg-surface px-3.5 text-[12.5px] font-semibold text-ink-soft hover:text-ink"
      >
        <NavIcon d="m15 6-6 6 6 6" className="h-[15px] w-[15px]" />
        {t.coachApp.programBuilderPage.back}
      </Link>
      <h1 className="mt-3 font-display text-2xl font-extrabold leading-tight tracking-tight sm:text-[28px]">
        {program.name}
      </h1>
      <ProgramBuilder program={program} clients={clients} muscles={facets.muscles} equipment={facets.equipment} />
    </div>
  );
}
