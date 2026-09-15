import Link from "next/link";
import { notFound } from "next/navigation";
import { getNutritionPlan } from "@/lib/data";
import { NavIcon } from "@/components/client-nav";
import { NutritionBuilder } from "@/components/nutrition-builder";
import { getI18n } from "@/lib/i18n/server";

export default async function NutritionPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { t } = await getI18n();
  const { id } = await params;
  const plan = await getNutritionPlan(id);
  if (!plan) notFound();
  // The back label ships with its own arrow glyph; the chevron icon replaces it.

  return (
    <div className="mx-auto max-w-[1600px]">
      <Link
        href="/nutrition"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-faint hover:text-accent-ink"
      >
        <NavIcon d="m15 6-6 6 6 6" className="h-3.5 w-3.5" />
        {t.coachApp.nutrition.back}
      </Link>
      <h1 className="mt-3 font-display text-2xl font-extrabold leading-none tracking-tight sm:text-[28px]">
        {plan.name}
      </h1>
      <div className="mt-5 sm:mt-6">
        <NutritionBuilder plan={plan} />
      </div>
    </div>
  );
}
