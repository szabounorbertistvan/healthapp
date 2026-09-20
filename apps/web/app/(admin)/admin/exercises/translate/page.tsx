import Link from "next/link";
import { redirect } from "next/navigation";
import { getProfile } from "@/lib/data";
import { EXERCISE_TRANSLATION_PAGE, getExercisesForTranslation } from "@/lib/exercise-admin-data";
import { Card } from "@/components/ui";
import { NavIcon } from "@/components/client-nav";
import { ExerciseTranslateRow } from "@/components/exercise-translate-row";
import { exerciseImage } from "@/lib/exercise-images";
import { getI18n } from "@/lib/i18n/server";
import { fill } from "@/lib/i18n";

// Admin · Romanian names and instructions for the shared exercise library.
//
// The Free Exercise DB import is English only. This page lists library rows
// (owner_id null, never anyone's custom exercise) a page at a time and lets an
// admin type the Romanian ones inline. Search and paging are a GET form and
// plain links, so any view is a URL that can be shared or reloaded.
export default async function AdminExercisesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; all?: string; page?: string }>;
}) {
  const { t } = await getI18n();
  const m = t.coachApp.admin.exercises;
  const profile = await getProfile();
  if (profile?.role !== "admin") redirect("/dashboard");

  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const onlyMissing = params.all !== "1";
  const page = Number(params.page) || 1;
  const { rows, missing, total, pages } = await getExercisesForTranslation({ q, onlyMissing, page });

  const href = (next: { page?: number; all?: boolean }) =>
    `/admin/exercises/translate?${new URLSearchParams({
      ...(q ? { q } : {}),
      ...((next.all ?? !onlyMissing) ? { all: "1" } : {}),
      ...((next.page ?? page) > 1 ? { page: String(next.page ?? page) } : {}),
    }).toString()}`;

  const first = total === 0 ? 0 : (page - 1) * EXERCISE_TRANSLATION_PAGE + 1;
  const last = Math.min(total, page * EXERCISE_TRANSLATION_PAGE);

  return (
    <div className="mx-auto max-w-[1600px]">
      <h1 className="font-display text-2xl font-extrabold leading-none tracking-tight sm:text-[28px]">
        {m.title}
      </h1>
      <p className="mt-2 max-w-2xl text-[13px] text-ink-soft">{m.intro}</p>

      <Card plain className="mt-5 overflow-hidden p-0 sm:mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
          <p className="text-[11px] font-semibold uppercase tracking-wider tabular-nums text-ink-faint">
            {fill(m.missingCount, { n: missing })}
          </p>
          <form action="/admin/exercises/translate" method="GET" className="flex flex-wrap items-center gap-2">
            {!onlyMissing ? <input type="hidden" name="all" value="1" /> : null}
            <label className="flex h-[42px] w-64 min-w-0 items-center gap-2.5 rounded-2xl bg-bg px-3.5 text-ink-faint">
              <NavIcon d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16M21 21l-4.3-4.3" className="h-4 w-4 shrink-0" />
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
              className="flex h-[42px] items-center justify-center rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90"
            >
              {t.common.actions.search}
            </button>
            <Link
              href={href({ all: onlyMissing, page: 1 })}
              className="inline-flex h-[42px] items-center rounded-full bg-bg px-4 text-[12.5px] font-semibold text-ink-soft hover:text-ink"
            >
              {onlyMissing ? m.showAll : m.onlyMissing}
            </Link>
          </form>
        </div>

        {rows.length === 0 ? (
          <p className="px-5 py-8 text-sm text-ink-soft">{q ? fill(m.noResults, { q }) : m.allDone}</p>
        ) : (
          <ul className="mt-3 divide-y divide-line/60">
            {rows.map((e) => (
              <ExerciseTranslateRow
                key={e.id}
                id={e.id}
                nameEn={e.name_en}
                nameRo={e.name_ro}
                instructionsEn={e.instructions_en}
                instructionsRo={e.instructions_ro}
                muscles={e.primary_muscles}
                image={e.images[0] ? exerciseImage(e.images[0]) : null}
              />
            ))}
          </ul>
        )}

        {/* Paging: plain links, so back/forward and a shared URL both work. */}
        {total > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line/60 px-5 py-4">
            <p className="text-[12.5px] tabular-nums text-ink-faint">
              {fill(m.showing, { first, last, total })}
            </p>
            <div className="flex items-center gap-2">
              <PageLink href={href({ page: page - 1 })} disabled={page <= 1} label={m.previous}>
                <NavIcon d="m15 6-6 6 6 6" className="h-4 w-4 [stroke-width:2.2]" />
              </PageLink>
              <span className="text-[12.5px] font-semibold tabular-nums text-ink-soft">
                {fill(m.pageOf, { page, pages })}
              </span>
              <PageLink href={href({ page: page + 1 })} disabled={page >= pages} label={m.next}>
                <NavIcon d="m9 6 6 6-6 6" className="h-4 w-4 [stroke-width:2.2]" />
              </PageLink>
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

/** One paging arrow. A disabled edge is a span, not a link, so it cannot be tabbed into. */
function PageLink({
  href,
  disabled,
  label,
  children,
}: {
  href: string;
  disabled: boolean;
  label: string;
  children: React.ReactNode;
}) {
  const className = "grid h-10 w-10 place-items-center rounded-full bg-bg text-ink-soft";
  if (disabled) {
    return (
      <span aria-hidden className={`${className} opacity-40`}>
        {children}
      </span>
    );
  }
  return (
    <Link href={href} aria-label={label} title={label} className={`${className} hover:text-ink`}>
      {children}
    </Link>
  );
}
