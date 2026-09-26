-- HealthApp schema · food_logs summed per day, for the nutrition trends view
--
-- The trends view (/food?view=trends) averages logged days over 7 days up to
-- all time. Reading raw food_logs for that runs past PostgREST's 1000-row cap
-- within a few months (a day is 5–15 entries), and a truncated read would
-- quietly drop days and move every average. So the rows are summed here, one
-- per day, and the folding (averages, adherence, insights) stays in
-- packages/shared/src/nutrition-progress.ts.
--
-- It sums the macros SNAPSHOTTED on food_logs at log time, never foods: logged
-- history must not change when a food row does (the reason those columns
-- exist). `meals` is distinct slots; `entries` is rows.
--
-- Privacy: security invoker, and it answers for auth.uid() only — there is no
-- user argument, so a coach (who may read a client's logs through
-- food_logs_coach_read) still gets only their own. RLS on food_logs applies.

create or replace function public.food_daily_totals(p_from date default null)
returns table (
  day text,
  kcal numeric,
  protein numeric,
  carbs numeric,
  fat numeric,
  entries int,
  meals int
)
language sql stable security invoker set search_path = public as $$
  select
    to_char(f.date, 'YYYY-MM-DD') as day,
    sum(f.kcal)       as kcal,
    sum(f.protein_g)  as protein,
    sum(f.carbs_g)    as carbs,
    sum(f.fat_g)      as fat,
    count(*)::int     as entries,
    count(distinct f.slot)::int as meals
  from public.food_logs f
  where f.user_id = auth.uid()
    and (p_from is null or f.date >= p_from)
  group by f.date
  order by f.date desc;
$$;

comment on function public.food_daily_totals(date) is
  'The caller''s food_logs summed per day (snapshotted macros), newest first. Folded by packages/shared/nutrition-progress.';

revoke execute on function public.food_daily_totals(date) from public, anon;
grant execute on function public.food_daily_totals(date) to authenticated;
