import Link from "next/link";
import { notFound } from "next/navigation";
import { getProgram } from "@/lib/data";
import { Card, PageTitle } from "@/components/ui";

export default async function ProgramPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const program = await getProgram(id);
  if (!program) notFound();

  return (
    <div>
      <Link href="/programs" className="text-sm text-accent-ink hover:underline">← Programs</Link>
      <PageTitle title={program.name}>
        <span className="text-sm text-ink-soft">
          {program.client_name} · week {program.week} of {program.weeks} · {program.intensity_mode.toUpperCase()}
        </span>
      </PageTitle>

      <div className="grid gap-4 lg:grid-cols-2">
        {program.days.map((day) => (
          <Card key={day.id} className="overflow-x-auto">
            <p className="mb-2 font-bold">{day.name}</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-line text-left text-[11px] uppercase tracking-wider text-ink-faint">
                  <th className="py-2 pr-3">Exercise</th>
                  <th className="py-2 pr-3">Sets×Reps</th>
                  <th className="py-2 pr-3">Load</th>
                  <th className="py-2 pr-3">{program.intensity_mode === "rpe" ? "RPE" : "RIR"}</th>
                  <th className="py-2">Rest</th>
                </tr>
              </thead>
              <tbody>
                {day.exercises.map((e) => (
                  <tr key={e.id} className="border-b border-line last:border-0">
                    <td className="py-2 pr-3 font-medium">{e.exercise}</td>
                    <td className="py-2 pr-3 tabular-nums">{e.sets}×{e.reps}</td>
                    <td className="py-2 pr-3 tabular-nums">{e.weight}</td>
                    <td className="py-2 pr-3 tabular-nums">{e.rpe}</td>
                    <td className="py-2 tabular-nums">{e.rest}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ))}
      </div>
      <p className="mt-4 text-xs text-ink-faint">
        Read-only preview — the drag-and-drop builder with the exercise library ships in Sprint 3 (see PRODUCT_SPEC §10).
      </p>
    </div>
  );
}
