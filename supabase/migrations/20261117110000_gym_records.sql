-- HealthApp schema · gym records: who lifts the most at a gym
--
-- 1. RECORDS AT A GYM. Per exercise, the best lift of each person at that
--    gym, ranked — by the heaviest weight moved for at least one rep, or by
--    the estimated 1RM under the app's one rule (relevantOneRm in
--    packages/shared/exercise-analytics, the ×30 key of
--    exercise_best_sets(): completed sessions, weight > 0, 1..12 reps, one
--    rep at face value, otherwise Epley). The functions return the SET; the
--    app computes the number, so the formula keeps living in one place.
--
--    "At the gym" = a completed session tagged with that gym
--    (logged_sessions.gym_id, 20261117100000), or an untagged session of a
--    member whose home gym it is. A session tagged with another gym never
--    counts here.
--
-- 2. CONSENT. A name on a gym board says where a person trains, so the
--    records use the same opt-in as the gym leaderboard: users.gym_board, and
--    never someone whose leaderboard_visibility is private, suspended, being
--    deleted, or behind a block. Reciprocal, like the gym board: the caller
--    sees the records once they are on the boards themselves (gym_board), and
--    always sees their own best.
--
-- 3. GYM-VS-GYM TOPS ARE ADMIN-ONLY for now (owner, 2026-10-12: too little
--    data to show people). gym_tops() loses its grant to `authenticated`;
--    admin_gym_tops() is the admin's door. gym_stats() keeps using gym_tops()
--    internally (it runs as the owner).

-- ============================================================================
-- 1 + 2. records
-- ============================================================================

-- The caller may see gym boards: signed in and opted in.
create or replace function public.gym_boards_open()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.users u where u.id = auth.uid() and u.gym_board);
$$;
revoke execute on function public.gym_boards_open() from public, anon;
grant execute on function public.gym_boards_open() to authenticated;

-- A person who may be named on a gym board (or the caller themselves).
create or replace function public.gym_board_listed(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_user = auth.uid()
      or (exists (select 1 from public.users u
                  where u.id = p_user and u.gym_board and u.leaderboard_visibility <> 'private')
          and public.gym_countable(p_user)
          and not public.social_blocked_between(auth.uid(), p_user));
$$;
revoke execute on function public.gym_board_listed(uuid) from public, anon, authenticated;

-- Every eligible set lifted at a gym (section 1's rule), for the functions below.
create or replace function public.gym_sets(p_gym uuid, p_since timestamptz default null)
returns table (set_id uuid, user_id uuid, exercise_id uuid, weight_kg numeric, reps int, achieved_at timestamptz)
language sql stable security definer set search_path = public as $$
  select ls.id, ls.user_id, ls.exercise_id, ls.weight_kg, ls.reps, s.completed_at
  from public.logged_sessions s
  join public.logged_sets ls on ls.session_id = s.id
  where s.completed_at is not null
    and (p_since is null or s.started_at >= p_since)
    and ls.weight_kg > 0
    and ls.reps between 1 and 12
    and (s.gym_id = p_gym
         or (s.gym_id is null
             and exists (select 1 from public.users u where u.id = s.user_id and u.home_gym_id = p_gym)));
$$;
revoke execute on function public.gym_sets(uuid, timestamptz) from public, anon, authenticated;

/**
 * The lifts a gym has records on, most contested first — the chips above the
 * board. Empty for a caller who is not on the boards.
 */
create or replace function public.gym_record_lifts(p_gym uuid)
returns table (exercise_id uuid, name_en text, name_ro text, lifters int)
language sql stable security definer set search_path = public as $$
  select x.exercise_id, e.name_en, e.name_ro, count(distinct x.user_id)::int
  from public.gym_sets(p_gym) x
  join public.exercises e on e.id = x.exercise_id
  where public.gym_boards_open()
    and exists (select 1 from public.gyms g where g.id = p_gym and g.status = 'active')
    and public.gym_board_listed(x.user_id)
  group by x.exercise_id, e.name_en, e.name_ro
  order by count(distinct x.user_id) desc, e.name_en
  limit 30;
$$;
revoke execute on function public.gym_record_lifts(uuid) from public, anon;
grant execute on function public.gym_record_lifts(uuid) to authenticated;

/**
 * One lift's board at a gym: each listed person's best set, ranked.
 * p_kind 'weight' = heaviest weight for ≥ 1 rep (more reps break a tie);
 * 'e1rm' = the ×30 key. p_period: all | year | month (Bucharest calendar).
 * Top p_limit plus the caller's own row. Ties: earliest lift first.
 */
create or replace function public.gym_records(
  p_gym uuid,
  p_exercise uuid,
  p_kind text default 'e1rm',
  p_period text default 'all',
  p_limit int default 10
) returns table (
  rank int, user_id uuid, display_name text, username text, avatar_url text,
  weight_kg numeric, reps int, achieved_at timestamptz, is_me boolean
) language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_since timestamptz;
begin
  if p_kind not in ('weight', 'e1rm') then
    raise exception 'unknown record kind' using errcode = '22023';
  end if;
  if p_period not in ('all', 'year', 'month') then
    raise exception 'unknown record period' using errcode = '22023';
  end if;
  if auth.uid() is null
     or not exists (select 1 from public.gyms g where g.id = p_gym and g.status = 'active') then
    return;
  end if;
  v_since := case p_period
    when 'month' then date_trunc('month', now() at time zone 'Europe/Bucharest') at time zone 'Europe/Bucharest'
    when 'year' then date_trunc('year', now() at time zone 'Europe/Bucharest') at time zone 'Europe/Bucharest'
  end;

  return query
  with best as (
    select distinct on (x.user_id) x.user_id, x.weight_kg, x.reps, x.achieved_at, x.set_id,
           case when p_kind = 'weight' then x.weight_kg * 1000 + x.reps
                when x.reps = 1 then x.weight_kg * 30
                else x.weight_kg * (30 + x.reps) end as k
    from public.gym_sets(p_gym, v_since) x
    where x.exercise_id = p_exercise
      -- Reciprocal: a caller off the boards sees only their own best.
      and (x.user_id = auth.uid() or (public.gym_boards_open() and public.gym_board_listed(x.user_id)))
    order by x.user_id,
             case when p_kind = 'weight' then x.weight_kg * 1000 + x.reps
                  when x.reps = 1 then x.weight_kg * 30
                  else x.weight_kg * (30 + x.reps) end desc,
             x.achieved_at, x.set_id
  ),
  ranked as (
    select (row_number() over (order by b.k desc, b.achieved_at, b.user_id))::int as rnk, b.*
    from best b
  )
  select r.rnk, r.user_id, coalesce(u.username, u.full_name), u.username, u.avatar_url,
         r.weight_kg, r.reps, r.achieved_at, r.user_id = auth.uid()
  from ranked r
  join public.users u on u.id = r.user_id
  where r.rnk <= least(greatest(coalesce(p_limit, 10), 1), 50) or r.user_id = auth.uid()
  order by r.rnk;
end;
$$;
revoke execute on function public.gym_records(uuid, uuid, text, text, int) from public, anon;
grant execute on function public.gym_records(uuid, uuid, text, text, int) to authenticated;

-- ============================================================================
-- 3. gym-vs-gym tops: admin only
-- ============================================================================
revoke execute on function public.gym_tops(text, text, text, int) from authenticated;

create or replace function public.admin_gym_tops(
  p_metric text default 'workouts', p_period text default 'month', p_city text default null, p_limit int default 50
) returns table (
  rank int, gym_id uuid, name text, city text, score numeric, athletes int, workouts int, members int
) language plpgsql stable security definer set search_path = public as $$
begin
  perform public.admin_assert();
  return query select * from public.gym_tops(p_metric, p_period, p_city, p_limit);
end;
$$;
revoke execute on function public.admin_gym_tops(text, text, text, int) from public, anon;
grant execute on function public.admin_gym_tops(text, text, text, int) to authenticated;
