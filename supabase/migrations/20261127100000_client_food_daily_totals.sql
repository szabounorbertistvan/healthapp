-- HealthApp schema · a client's food_logs summed per day, for their coach
--
-- food_daily_totals() (20260929100000) answers for auth.uid() only, on
-- purpose: it has no user argument. The coach's client page now shows the
-- client's measurable goals, and two of them ("calories on target", "protein
-- a day") are folded from these day totals. Reading the raw rows instead
-- would run past PostgREST's 1000-row cap within weeks and silently move the
-- averages, which is why the function exists in the first place.
--
-- Same body, one argument more, and a gate: the rows come back only when the
-- caller is the client's active coach (is_active_coach_of, the single point of
-- truth every coach policy uses). Security invoker, so food_logs_coach_read
-- answers the read as well — the gate does not widen anything RLS would not
-- already show the coach row by row. The client themself, a stranger, a
-- paused or former coach: zero rows. A person's own totals stay on
-- food_daily_totals().

create or replace function public.client_food_daily_totals(p_client uuid, p_from date default null)
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
  where f.user_id = p_client
    and public.is_active_coach_of(p_client)
    and (p_from is null or f.date >= p_from)
  group by f.date
  order by f.date desc;
$$;

comment on function public.client_food_daily_totals(uuid, date) is
  'A client''s food_logs summed per day (snapshotted macros), newest first — for their active coach only. The caller''s own totals: food_daily_totals().';

revoke execute on function public.client_food_daily_totals(uuid, date) from public, anon;
grant execute on function public.client_food_daily_totals(uuid, date) to authenticated;
