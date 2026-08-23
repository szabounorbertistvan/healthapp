import { getNutritionPlans } from "@/lib/data";
import { Card, EmptyState, PageTitle } from "@/components/ui";

export default async function NutritionPage() {
  const plans = await getNutritionPlans();
  return (
    <div>
      <PageTitle title="Nutrition plans" />
      {plans.length === 0 ? (
        <EmptyState title="No plans yet" hint="The meal builder ships in Sprint 6 — plans created there appear here." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {plans.map((p) => (
            <Card key={p.id}>
              <div className="flex items-start justify-between gap-2">
                <p className="font-bold">{p.name}</p>
                <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
                  p.status === "published" ? "bg-accent-soft text-accent-ink" : "bg-bg text-ink-faint"
                }`}>{p.status}</span>
              </div>
              <p className="mt-1 text-sm text-ink-soft">{p.client_name}</p>
              <div className="mt-3 flex flex-wrap gap-4 text-sm tabular-nums">
                <span><b>{p.kcal_target}</b> kcal</span>
                <span className="text-ink-soft">P <b className="text-ink">{p.protein_target_g}g</b></span>
                <span className="text-ink-soft">C <b className="text-ink">{p.carbs_target_g}g</b></span>
                <span className="text-ink-soft">F <b className="text-ink">{p.fat_target_g}g</b></span>
              </div>
            </Card>
          ))}
        </div>
      )}
      <p className="mt-4 text-xs text-ink-faint">
        Meal composition (foods with grams, live totals) ships in Sprint 6 with the Open Food Facts search.
      </p>
    </div>
  );
}
