import Link from "next/link";
import { notFound } from "next/navigation";
import { getActiveClientNames, getProgram, getProgramActivation } from "@/lib/data";
import { exerciseFacets } from "@/lib/exercise-library";
import { NavIcon } from "@/components/client-nav";
import { ProgramBuilder } from "@/components/program-builder";
import { getI18n } from "@/lib/i18n/server";
import { canEdit } from "@/lib/can-edit";
import { ReadOnlyNotice } from "@/components/read-only-notice";
import { ProgramActivation } from "@/components/program-activation";

export default async function ProgramPage({ params }: { params: Promise<{ id: string }> }) {
  const { t } = await getI18n();
  const { id } = await params;
  const [program, clients, access, activation] = await Promise.all([
    getProgram(id), getActiveClientNames(), canEdit("can_edit_program", { p_program: id }), getProgramActivation(id),
  ]);
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
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-extrabold leading-tight tracking-tight sm:text-[28px]">
          {program.name}
        </h1>
        {/* Reuse, not a second copy of it: duplicating this program, assigning
            it to another client, renaming it and seeing who else is training
            it all live on the routine page, which already has those controls
            for every program. This page stays the structure editor. */}
        <Link
          href={`/routines/${id}`}
          className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-surface px-4 text-[12.5px] font-semibold text-ink-soft hover:text-accent-ink"
        >
          <NavIcon d="M8 8h11v11H8zM5 16V5h11" className="h-4 w-4" />
          {t.clientApp.routines.editDetails}
          <NavIcon d="m9 6 6 6-6 6" className="h-[15px] w-[15px]" />
        </Link>
      </div>
      {access === "edit" ? null
        : <ReadOnlyNotice text={access === "read-only" ? t.coachApp.programBuilderPage.readOnly : t.common.actions.editUnverified} />}
      {/* Which of this client's programs the next workout comes from. Duplicate
          and assign stay on the routine page (linked above). */}
      <div className="mt-4">
        <ProgramActivation
          programId={program.id}
          programName={program.name}
          activation={activation}
          canActivate={access === "edit"}
          detailsHref={`/routines/${id}`}
          forCoach
        />
      </div>
      {/* Disabled, not hidden: the coach keeps reading what they wrote; the
          database refuses the writes anyway (20261122100000). Editable only on
          a confirmed yes — a check that failed is read-only too (lib/edit-access.ts). */}
      <ProgramBuilder program={program} clients={clients} muscles={facets.muscles} equipment={facets.equipment} readOnly={access !== "edit"} />
    </div>
  );
}
