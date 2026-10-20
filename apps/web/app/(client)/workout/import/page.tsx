import Link from "next/link";
import { getProfile } from "@/lib/data";
import { getImportLibrary } from "@/lib/import/library-data";
import { WorkoutImport } from "@/components/workout-import";
import { NavIcon } from "@/components/client-nav";
import { getI18n } from "@/lib/i18n/server";

/**
 * Bringing training history over from Hevy or Strong. The file never leaves
 * the browser whole: it is parsed there and the sessions are written through
 * app/import-actions.ts, owner-scoped like any logged set. Open to anyone who
 * trains — a coach's own training is under (client) too.
 */
export default async function WorkoutImportPage() {
  const [{ t }, library, profile] = await Promise.all([getI18n(), getImportLibrary(), getProfile()]);
  const m = t.clientApp.workoutImport;
  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/workout" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink-soft hover:text-ink">
        <NavIcon d="m15 6-6 6 6 6" className="h-4 w-4 [stroke-width:2.2]" />
        {t.clientApp.workoutDay.backToTraining}
      </Link>
      <h1 className="mt-3 font-display text-2xl font-extrabold leading-none tracking-tight sm:text-[28px]">{m.title}</h1>
      <div className="mt-5 sm:mt-6">
        <WorkoutImport library={library} defaultUnit={profile?.weight_unit ?? "kg"} />
      </div>
    </div>
  );
}
