import type { AchievementsV1 } from "@healthapp/api/v1";
import { categoriesPresent, isAchievementRarity, summarizeAchievements } from "@healthapp/shared";
import { apiJson, v1Route } from "@/lib/api/v1";
import { progressText, requirementText } from "@/lib/achievement-format";
import { getMyAchievements } from "@/lib/achievements-data";
import { getI18n } from "@/lib/i18n/server";

// The app's achievements: /achievements' one RPC (achievement_progress), worded
// here by the web's own helpers so both say the same thing. Earned first, then
// the catalog's order — what is left reads as a list of next steps.
export const dynamic = "force-dynamic";

export const GET = v1Route(async () => {
  const [{ t, locale }, rows] = await Promise.all([getI18n(), getMyAchievements()]);
  const a = t.common.achievements;
  const summary = summarizeAchievements(rows.map((r) => ({ ...r, earned: r.awarded_at !== null })));
  const sorted = [...rows].sort((x, y) => Number(y.awarded_at !== null) - Number(x.awarded_at !== null) || x.sort - y.sort);
  return apiJson<AchievementsV1>({
    earned: summary.earned,
    total: summary.total,
    categories: categoriesPresent(rows).map((c) => ({ key: c, label: a.categories[c] })),
    rows: sorted.map((r) => {
      const p = progressText(a, r.metric, r.current_value, r.target, locale);
      return {
        slug: r.slug,
        name: locale === "ro" ? r.name_ro : r.name_en,
        icon: r.icon,
        category: r.category,
        rarity: r.rarity,
        rarity_label: isAchievementRarity(r.rarity) ? a.rarities[r.rarity] : null,
        requirement: requirementText(a, r.metric, r.target, locale),
        awarded_at: r.awarded_at,
        target: r.target,
        percent: p.percent,
        progress_line: p.line,
      };
    }),
  });
});
