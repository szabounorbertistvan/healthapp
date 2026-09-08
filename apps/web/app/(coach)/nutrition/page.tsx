import Link from "next/link";
import { getNutritionPlans } from "@/lib/data";
import { Card, EmptyState, PageTitle } from "@/components/ui";
import { getI18n } from "@/lib/i18n/server";

export default async function NutritionPage() {
  const { t } = await getI18n();
  const plans = await getNutritionPlans();
  return (
    <div>
      <PageTitle title={t.coachApp.nutrition.title}>
        <Link
          href="/nutrition/new"
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg hover:opacity-90"
        >
          {t.coachApp.nutrition.newPlan}
        </Link>
      </PageTitle>
      {plans.length === 0 ? (
        <EmptyState title={t.coachApp.nutrition.emptyTitle} hint={t.coachApp.nutrition.emptyHint} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {plans.map((p) => (
            <Link key={p.id} href={`/nutrition/${p.id}`}>
            <Card className="h-full transition hover:border-accent">
              <div className="flex items-start justify-between gap-2">
                <p className="font-bold">{p.name}</p>
                <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
                  p.status === "published" ? "bg-accent-soft text-accent-ink" : "bg-bg text-ink-faint"
                }`}>{t.coachApp.nutrition.status[p.status] ?? p.status}</span>
              </div>
              <p className="mt-1 text-sm text-ink-soft">{p.client_name}</p>
              <div className="mt-3 flex flex-wrap gap-4 text-sm tabular-nums">
                <span><b>{p.kcal_target}</b> {t.coachApp.nutrition.kcal}</span>
                <span className="text-ink-soft">{t.coachApp.nutrition.proteinShort} <b className="text-ink">{p.protein_target_g}g</b></span>
                <span className="text-ink-soft">{t.coachApp.nutrition.carbsShort} <b className="text-ink">{p.carbs_target_g}g</b></span>
                <span className="text-ink-soft">{t.coachApp.nutrition.fatShort} <b className="text-ink">{p.fat_target_g}g</b></span>
              </div>
            </Card>
            </Link>
          ))}
        </div>
      )}
      <p className="mt-4 text-xs text-ink-faint">
        {t.coachApp.nutrition.demoFootnote}
      </p>
    </div>
  );
}
