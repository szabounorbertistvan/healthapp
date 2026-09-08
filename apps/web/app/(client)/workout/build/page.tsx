import { getProgram } from "@/lib/data";
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
      <PageTitle title={t.clientApp.builder.title} />
      <SoloProgramBuilder program={program} />
    </div>
  );
}
