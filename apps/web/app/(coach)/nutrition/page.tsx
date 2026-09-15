import Link from "next/link";
import { getNutritionPlans } from "@/lib/data";
import { Card, EmptyState } from "@/components/ui";
import { NavIcon } from "@/components/client-nav";
import { getI18n } from "@/lib/i18n/server";

export default async function NutritionPage() {
  const { t } = await getI18n();
  const n = t.coachApp.nutrition;
  const plans = await getNutritionPlans();
  return (
    <div className="mx-auto max-w-[1600px]">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-2xl font-extrabold leading-none tracking-tight sm:text-[28px]">
          {n.title}
        </h1>
        <Link
          href="/nutrition/new"
          className="inline-flex h-11 items-center gap-2 rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90"
        >
          <NavIcon d="M12 5v14M5 12h14" className="h-4 w-4 [stroke-width:2.2]" />
          {n.newPlan}
        </Link>
      </div>

      {plans.length === 0 ? (
        <div className="mt-5 sm:mt-6">
          <EmptyState plain title={n.emptyTitle} hint={n.emptyHint} />
        </div>
      ) : (
        <div className="mt-5 grid gap-3.5 sm:mt-6 sm:grid-cols-[repeat(auto-fill,minmax(380px,1fr))]">
          {plans.map((p) => (
            <Link key={p.id} href={`/nutrition/${p.id}`} className="group">
              <Card plain className="h-full sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <NavIcon
                      d="M3 12h18a9 9 0 0 1-18 0zM8 12c0-3 2-5 5-6 2 2 3 4 1 6"
                      className="h-9 w-9 shrink-0 text-accent-ink"
                    />
                    <div className="min-w-0">
                      <h2 className="truncate font-display text-lg font-bold tracking-tight">{p.name}</h2>
                      <p className="mt-1 truncate text-[12.5px] text-ink-faint">{p.client_name}</p>
                    </div>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider ${
                      p.status === "published" ? "bg-accent-soft text-accent-ink" : "bg-bg text-ink-faint"
                    }`}
                  >
                    {n.status[p.status] ?? p.status}
                  </span>
                </div>

                <div className="mt-4 flex items-end justify-between gap-3 rounded-2xl bg-bg px-4 py-3.5">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{n.kcal}</p>
                    <p className="mt-1 font-display text-[28px] font-extrabold tabular-nums leading-none">
                      {p.kcal_target}
                    </p>
                  </div>
                  <dl className="flex gap-4 text-right">
                    <Macro label={n.proteinShort} value={p.protein_target_g} />
                    <Macro label={n.carbsShort} value={p.carbs_target_g} />
                    <Macro label={n.fatShort} value={p.fat_target_g} />
                  </dl>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/** One macro target beside the calorie figure. */
function Macro({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{label}</dt>
      <dd className="mt-1 font-display text-base font-bold tabular-nums leading-none">
        {value}
        <span className="ml-0.5 font-sans text-[11px] font-medium text-ink-faint">g</span>
      </dd>
    </div>
  );
}
