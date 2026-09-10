import Link from "next/link";
import { redirect } from "next/navigation";
import { getProfile } from "@/lib/data";
import { FOOD_TRANSLATION_PAGE, getFoodsForTranslation } from "@/lib/food-admin-data";
import { Card, PageTitle } from "@/components/ui";
import { FoodTranslateRow } from "@/components/food-translate-row";
import { getI18n } from "@/lib/i18n/server";
import { fill } from "@/lib/i18n";

// Admin · Romanian names for the shared food library.
//
// The generic ingredient list is the USDA import, English only. This page lists
// shared foods (USDA and Open Food Facts rows, not anyone's custom foods) and
// lets an admin type the Romanian name inline. Same GET-form search as /admin,
// so a filter is a URL that can be shared or reloaded.
export default async function AdminFoodsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; all?: string }>;
}) {
  const { t } = await getI18n();
  const m = t.coachApp.admin.foods;
  const profile = await getProfile();
  if (profile?.role !== "admin") redirect("/dashboard");

  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const onlyMissing = params.all !== "1";
  const { rows, missing } = await getFoodsForTranslation({ q, onlyMissing });

  const toggleHref = `/admin/foods?${new URLSearchParams({
    ...(q ? { q } : {}),
    ...(onlyMissing ? { all: "1" } : {}),
  }).toString()}`;

  return (
    <div>
      <PageTitle title={m.title}>
        <Link href="/admin" className="text-sm text-ink-soft hover:underline">
          ← {t.common.nav.admin}
        </Link>
      </PageTitle>

      <p className="mb-4 max-w-2xl text-sm text-ink-soft">{m.intro}</p>

      <Card className="overflow-x-auto p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            {fill(m.missingCount, { n: missing })}
          </p>
          <form action="/admin/foods" method="GET" className="flex items-center gap-2">
            {!onlyMissing ? <input type="hidden" name="all" value="1" /> : null}
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder={m.searchPlaceholder}
              aria-label={m.searchPlaceholder}
              className="w-64 rounded-lg border border-line bg-bg px-3 py-1.5 text-sm outline-none focus:border-accent"
            />
            <button
              type="submit"
              className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg hover:opacity-90"
            >
              {t.coachApp.admin.searchButton}
            </button>
            <Link href={toggleHref} className="text-xs text-ink-soft hover:underline">
              {onlyMissing ? m.showAll : m.onlyMissing}
            </Link>
          </form>
        </div>

        {rows.length === 0 ? (
          <p className="px-4 py-6 text-sm text-ink-soft">
            {q ? fill(m.noResults, { q }) : fill(m.missingCount, { n: missing })}
          </p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="border-b-2 border-line text-left text-[11px] uppercase tracking-wider text-ink-faint">
                <th className="px-4 py-2">{m.thEnglish}</th>
                <th className="px-4 py-2">{m.thRomanian}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((food) => (
                <FoodTranslateRow
                  key={food.id}
                  id={food.id}
                  nameEn={food.name_en}
                  nameRo={food.name_ro}
                  kcal={food.kcal_100g}
                />
              ))}
            </tbody>
          </table>
        )}
        {rows.length >= FOOD_TRANSLATION_PAGE ? (
          <p className="px-4 py-3 text-xs text-ink-faint">{fill(m.capped, { n: FOOD_TRANSLATION_PAGE })}</p>
        ) : null}
      </Card>
    </div>
  );
}
