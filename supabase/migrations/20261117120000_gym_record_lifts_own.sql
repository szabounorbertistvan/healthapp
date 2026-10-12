-- HealthApp schema · gym records: a caller off the boards still sees their own lifts
--
-- 20261117110000 promised "until you are on the boards you see your own best"
-- — gym_records() keeps it, but gym_record_lifts() returned nothing at all
-- for such a caller, so the page had no lift to open and showed no record.
-- Now it lists the lifts the caller has at the gym, counting only the people
-- the caller may see (themselves, and listed people once they are on the
-- boards themselves).

-- gym_record_lifts from 20261117110000; the caller's own lifts count without the opt-in.
create or replace function public.gym_record_lifts(p_gym uuid)
returns table (exercise_id uuid, name_en text, name_ro text, lifters int)
language sql stable security definer set search_path = public as $$
  select x.exercise_id, e.name_en, e.name_ro, count(distinct x.user_id)::int
  from public.gym_sets(p_gym) x
  join public.exercises e on e.id = x.exercise_id
  where auth.uid() is not null
    and exists (select 1 from public.gyms g where g.id = p_gym and g.status = 'active')
    and (x.user_id = auth.uid() or (public.gym_boards_open() and public.gym_board_listed(x.user_id)))
  group by x.exercise_id, e.name_en, e.name_ro
  order by count(distinct x.user_id) desc, e.name_en
  limit 30;
$$;
revoke execute on function public.gym_record_lifts(uuid) from public, anon;
grant execute on function public.gym_record_lifts(uuid) to authenticated;
