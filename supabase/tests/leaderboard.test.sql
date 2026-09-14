-- pgTAP · leaderboards: training_load_score() matches the TypeScript formula,
-- social_leaderboard() ranks the way packages/shared/leaderboard.ts does,
-- refuses bad input, honours the visibility setting, and shows nothing that
-- is not a name, a handle, an avatar and a number.
--
-- Run with a local stack up:  npm run db:test

begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

create or replace function pg_temp.authenticate_as(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$fn$;

-- ---------- 1. training load parity ----------
-- The same table as LOAD_PARITY in packages/shared/src/leaderboard.test.ts.
select is(public.training_load_score(0, 0, null, null, 0), 0, 'parity: no sets → 0');
select is(public.training_load_score(4200, 11, 61, 8, 3), 50, 'parity: 4200 kg · 11 sets · 61 min · rpe 8 · 3 ex');
select is(public.training_load_score(12450, 28, 72, 8.5, 12), 78, 'parity: 12450 kg · 28 sets · 72 min · rpe 8.5 · 12 ex');
select is(public.training_load_score(9586, 10, 60, null, 3), 59, 'parity: no intensity drops out and renormalises');
select is(public.training_load_score(640, 1, null, 7, 1), 15, 'parity: no duration');
select is(public.training_load_score(20000, 30, 400, 10, 8), 89, 'parity: a 400 min session is not timed');
select is(public.training_load_score(3000, 12, 45, 3, 4), 35, 'parity: rpe 3 is below the warm-up floor');

-- ---------- fixtures ----------
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-0000-0000-0000000000a2', 'maria@lb.local',   '{"full_name":"Maria D.","username":"maria"}'),
  ('b0000000-0000-0000-0000-0000000000b2', 'andrei@lb.local',  '{"full_name":"Andrei P.","username":"andrei"}'),
  ('c0000000-0000-0000-0000-0000000000c2', 'norbert@lb.local', '{"full_name":"Norbert S.","username":"norbert"}'),
  ('d0000000-0000-0000-0000-0000000000d2', 'quiet@lb.local',   '{"full_name":"Quiet","username":"quiet"}'),
  ('e0000000-0000-0000-0000-0000000000e2', 'hidden@lb.local',  '{"full_name":"Hidden","username":"hidden"}'),
  ('f0000000-0000-0000-0000-0000000000f2', 'late@lb.local',    '{"full_name":"Late","username":"late"}');

update public.users set timezone = 'Europe/Bucharest', created_at = '2026-01-01'
  where id in ('a0000000-0000-0000-0000-0000000000a2', 'b0000000-0000-0000-0000-0000000000b2',
               'c0000000-0000-0000-0000-0000000000c2', 'd0000000-0000-0000-0000-0000000000d2',
               'e0000000-0000-0000-0000-0000000000e2');
-- Late lives on UTC: the same instants fall on different days for them.
update public.users set timezone = 'UTC', created_at = '2026-01-01' where id = 'f0000000-0000-0000-0000-0000000000f2';
-- Norbert joined later than Andrei: the seniority tie-breaker below relies on it.
update public.users set created_at = '2026-03-01' where id = 'c0000000-0000-0000-0000-0000000000c2';
update public.users set leaderboard_visibility = 'private' where id = 'e0000000-0000-0000-0000-0000000000e2';
insert into public.exercises (id, name_en, name_ro, source) values
  ('e0000000-0000-0000-0000-0000000000ee', 'Squat', 'Genuflexiuni', 'custom');

-- A completed session `p_days` ago at local noon with `p_sets` sets of 100 kg × 10 (1000 kg each).
create or replace function pg_temp.session(p_user uuid, p_days int, p_sets int, p_hour int default 12)
returns uuid language plpgsql as $fn$
declare v_id uuid; v_start timestamptz; i int;
begin
  v_start := (((now() at time zone 'Europe/Bucharest')::date - p_days) || ' ' || p_hour || ':00')::timestamp at time zone 'Europe/Bucharest';
  insert into public.logged_sessions (user_id, client_generated_id, started_at, completed_at)
  values (p_user, gen_random_uuid(), v_start, v_start + interval '60 minutes') returning id into v_id;
  for i in 1..p_sets loop
    insert into public.logged_sets (session_id, user_id, exercise_id, set_index, weight_kg, reps, rpe, client_generated_id)
    values (v_id, p_user, 'e0000000-0000-0000-0000-0000000000ee', i, 100, 10, 8, gen_random_uuid());
  end loop;
  return v_id;
end;
$fn$;

-- Everything "this week" sits on today, so the file passes on a Monday too;
-- older rows are 40+ days back, always outside the current month.
-- Maria: 2 sessions today (same day → 1 active day), 10 sets each; one 40 days ago.
select pg_temp.session('a0000000-0000-0000-0000-0000000000a2', 0, 10, 7);
select pg_temp.session('a0000000-0000-0000-0000-0000000000a2', 0, 10, 18);
select pg_temp.session('a0000000-0000-0000-0000-0000000000a2', 40, 10);
-- Andrei and Norbert: identical — one session today, 10 sets. Tie → seniority.
select pg_temp.session('b0000000-0000-0000-0000-0000000000b2', 0, 10);
select pg_temp.session('c0000000-0000-0000-0000-0000000000c2', 0, 10);
-- Norbert also trained 40 days ago, three days in a row: all-time streak 3.
select pg_temp.session('c0000000-0000-0000-0000-0000000000c2', 40, 5);
select pg_temp.session('c0000000-0000-0000-0000-0000000000c2', 41, 5);
select pg_temp.session('c0000000-0000-0000-0000-0000000000c2', 42, 5);
-- Hidden trains hardest of all but is private.
select pg_temp.session('e0000000-0000-0000-0000-0000000000e2', 0, 30);
-- Late (UTC): 40 days ago, a session at 02:30 Bucharest time — 23:30 UTC the
-- day before — and one at noon. One day for a Bucharest clock, two for a UTC one.
select pg_temp.session('f0000000-0000-0000-0000-0000000000f2', 40, 5, 2);
select pg_temp.session('f0000000-0000-0000-0000-0000000000f2', 40, 5, 12);
-- Quiet: an abandoned session only — not eligible anywhere.
insert into public.logged_sessions (user_id, client_generated_id, started_at, completed_at)
values ('d0000000-0000-0000-0000-0000000000d2', gen_random_uuid(), now(), null);

-- ---------- 2. validation ----------
select pg_temp.authenticate_as('a0000000-0000-0000-0000-0000000000a2');
select throws_ok($$ select * from public.social_leaderboard('bench_press', 'week') $$, '22023', null, 'an unknown metric is refused');
select throws_ok($$ select * from public.social_leaderboard('workouts', 'year') $$, '22023', null, 'an unknown period is refused');
select throws_ok($$ select * from public.social_leaderboard('workouts', 'week', 'club') $$, '22023', null, 'only the global scope exists yet');

-- ---------- 3. ranking ----------
select is((select array_agg(username order by rank) from public.social_leaderboard('workouts', 'week')),
  array['maria', 'andrei', 'norbert'], 'workouts this week: Maria 2, then the tie broken by seniority (Andrei before Norbert)');
select is((select score from public.social_leaderboard('workouts', 'week') where username = 'maria'), 2::numeric, 'Maria completed two workouts this week');
select is((select score from public.social_leaderboard('active_days', 'week') where username = 'maria'), 1::numeric,
  'two workouts on one day are one active day');
select is((select score from public.social_leaderboard('active_days', 'all') where username = 'maria'), 2::numeric,
  'a workout on another day is a second active day');
select is((select score from public.social_leaderboard('active_days', 'all') where username = 'late'), 2::numeric,
  'timezone boundary: 23:30 UTC is the day before for a UTC user, so two active days');
select is((select score from public.social_leaderboard('volume', 'week') where username = 'maria'), 20000::numeric,
  'volume is Σ weight × reps over the week');
select is((select score from public.social_leaderboard('training_load', 'week') where username = 'maria'),
  (2 * public.training_load_score(10000, 10, 60, 8, 1))::numeric,
  'training load is the sum of the mirrored per-session score');
select is((select rank from public.social_leaderboard('training_load', 'week') where is_current_user), 1, 'the caller is flagged on their own row');
select is((select count(*)::int from public.social_leaderboard('workouts', 'week') where username = 'quiet'), 0,
  'an abandoned session does not put you on the board');
select is((select count(*)::int from public.social_leaderboard('workouts', 'week') where username = 'hidden'), 0,
  'a private person is not shown to others');

-- ---------- 4. periods ----------
select is((select score from public.social_leaderboard('workouts', 'all') where username = 'norbert'), 4::numeric, 'all time counts every completed session');
select is((select score from public.social_leaderboard('workouts', 'week') where username = 'norbert'), 1::numeric, 'this week counts only the week');
select is((select score from public.social_leaderboard('streak', 'all') where username = 'norbert'), 3::numeric, 'streak all time = the longest run ever');
select is((select score from public.social_leaderboard('streak', 'week') where username = 'norbert'), 1::numeric,
  'streak this week = the longest run touching the week');
select is((select score from public.social_leaderboard('streak', 'all') where username = 'maria'), 1::numeric, 'two single days are a streak of 1');

-- ---------- 5. the caller outside the top, and only the top ----------
select is((select count(*)::int from public.social_leaderboard('workouts', 'week', 'global', 1)), 1,
  'limit 1 for the leader herself is one row, not a duplicate');
select pg_temp.authenticate_as('c0000000-0000-0000-0000-0000000000c2');
select is((select array_agg(rank order by rank) from public.social_leaderboard('workouts', 'week', 'global', 1)), array[1, 3],
  'Norbert, ranked third, still gets his row under a top-1 board');

-- ---------- 6. privacy ----------
select pg_temp.authenticate_as('e0000000-0000-0000-0000-0000000000e2');
select is((select count(*)::int from public.social_leaderboard('workouts', 'week') where is_current_user), 1,
  'a private person still sees their own row');
select is((select count(*)::int from public.users where id <> 'e0000000-0000-0000-0000-0000000000e2'), 0,
  'the board did not widen users_select: other profiles stay unreadable');
select is((select count(*)::int from public.logged_sessions where user_id <> 'e0000000-0000-0000-0000-0000000000e2'), 0,
  'and other people''s sessions stay unreadable');
select is(
  (select string_agg(x.col, ',' order by x.col) from (
     select unnest(proargnames[5:]) as col from pg_proc where proname = 'social_leaderboard') x),
  'avatar_url,display_name,is_current_user,rank,score,secondary_score,user_id,username',
  'the row carries a name, a handle, an avatar and numbers — no weight, no calories, no sets');

-- ---------- 7. signed out ----------
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from public.social_leaderboard('workouts', 'week')), 0, 'no session → no board');

select * from finish();
rollback;
