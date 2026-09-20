import Link from "next/link";
import { redirect } from "next/navigation";
import { getProfile } from "@/lib/data";
import { FOOD_TRANSLATION_PAGE, getFoodsForTranslation } from "@/lib/food-admin-data";
import { Card } from "@/components/ui";
import { NavIcon } from "@/components/client-nav";
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
    <div className="mx-auto max-w-[1600px]">
      <h1 className="font-display text-2xl font-extrabold leading-none tracking-tight sm:text-[28px]">
        {m.title}
      </h1>
      <p className="mt-2 max-w-2xl text-[13px] text-ink-soft">{m.intro}</p>

      <Card plain className="mt-5 overflow-x-auto p-0 sm:mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
          <p className="text-[11px] font-semibold uppercase tracking-wider tabular-nums text-ink-faint">
            {fill(m.missingCount, { n: missing })}
          </p>
          <form action="/admin/foods" method="GET" className="flex flex-wrap items-center gap-2">
            {!onlyMissing ? <input type="hidden" name="all" value="1" /> : null}
            <label className="flex h-[42px] w-64 min-w-0 items-center gap-2.5 rounded-2xl bg-bg px-3.5 text-ink-faint">
              <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
              </svg>
              <input
                type="search"
                name="q"
                defaultValue={q}
                placeholder={m.searchPlaceholder}
                aria-label={m.searchPlaceholder}
                className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
              />
            </label>
            <button
              type="submit"
              className="flex h-[42px] items-center justify-center rounded-2xl bg-accent px-4 font-display text-[13px] font-bold text-accent-fg hover:opacity-90"
            >
              {t.coachApp.admin.searchButton}
            </button>
            <Link
              href={toggleHref}
              className="inline-flex h-[42px] items-center rounded-full bg-bg px-4 text-[12.5px] font-semibold text-ink-soft hover:text-ink"
            >
              {onlyMissing ? m.showAll : m.onlyMissing}
            </Link>
          </form>
        </div>

        {rows.length === 0 ? (
          <p className="px-5 py-8 text-[13px] text-ink-soft">
            {q ? fill(m.noResults, { q }) : fill(m.missingCount, { n: missing })}
          </p>
        ) : (
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="border-b border-line/60 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                <th className="px-5 py-2.5 font-semibold">{m.thEnglish}</th>
                <th className="px-5 py-2.5 font-semibold">{m.thRomanian}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
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
          <p className="px-5 py-3.5 text-[12.5px] tabular-nums text-ink-faint">
            {fill(m.capped, { n: FOOD_TRANSLATION_PAGE })}
          </p>
        ) : null}
      </Card>
    </div>
  );
}
