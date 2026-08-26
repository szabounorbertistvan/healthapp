import Link from "next/link";
import { notFound } from "next/navigation";
import { getNutritionPlan } from "@/lib/data";
import { PageTitle } from "@/components/ui";
import { NutritionBuilder } from "@/components/nutrition-builder";
import { getI18n } from "@/lib/i18n/server";

export default async function NutritionPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { t } = await getI18n();
  const { id } = await params;
  const plan = await getNutritionPlan(id);
  if (!plan) notFound();

  return (
    <div>
      <Link href="/nutrition" className="text-sm text-accent-ink hover:underline">
        {t.coachApp.nutrition.back}
      </Link>
      <PageTitle title={plan.name} />
      <NutritionBuilder plan={plan} />
    </div>
  );
}
