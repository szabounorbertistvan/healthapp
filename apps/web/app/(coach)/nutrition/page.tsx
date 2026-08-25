import Link from "next/link";
import { getNutritionPlans } from "@/lib/data";
import { Card, EmptyState, PageTitle } from "@/components/ui";

export default async function NutritionPage() {
  const plans = await getNutritionPlans();
  return (
    <div>
      <PageTitle title="Nutrition plans">
        <Link
          href="/nutrition/new"
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
        >
          New plan
        </Link>
      </PageTitle>
      {plans.length === 0 ? (
        <EmptyState title="No plans yet" hint="Create one, then compose meals from foods with grams." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {plans.map((p) => (
            <Link key={p.id} href={`/nutrition/${p.id}`}>
            <Card className="h-full transition hover:border-accent">
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
            </Link>
          ))}
        </div>
      )}
      <p className="mt-4 text-xs text-ink-faint">
        Demo mode uses a local food table; live search comes from Open Food Facts through the
        food-search edge function once a backend is connected.
      </p>
    </div>
  );
}
