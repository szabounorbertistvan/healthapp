-- pgTAP · workout streaks: workout_days() rolls completed sessions up by
-- local day, social_streak() mirrors packages/shared/streaks, and neither
-- reads more than it should.
--
-- Run with a local stack up:  npm run db:test

begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

create or replace function pg_temp.authenticate_as(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$fn$;

-- ---------- fixtures ----------
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-0000-0000-0000000000a1', 'runner@streak.local',   '{"full_name":"Runner","username":"runner"}'),
  ('b0000000-0000-0000-0000-0000000000b1', 'watcher@streak.local',  '{"full_name":"Watcher","username":"watcher"}');

update public.users set timezone = 'Europe/Bucharest' where id = 'a0000000-0000-0000-0000-0000000000a1';

-- Runner: three consecutive local days ending yesterday (two sessions on one
-- of them), an abandoned session today, and an older 5-day streak.
-- Timestamps are local noon in Bucharest (UTC+3 in September), so a plain
-- date arithmetic on now() is safe here.
insert into public.logged_sessions (user_id, client_generated_id, started_at, completed_at)
select 'a0000000-0000-0000-0000-0000000000a1', gen_random_uuid(),
       (((now() at time zone 'Europe/Bucharest')::date - d) || ' 12:00') ::timestamp at time zone 'Europe/Bucharest',
       (((now() at time zone 'Europe/Bucharest')::date - d) || ' 13:00') ::timestamp at time zone 'Europe/Bucharest'
from unnest(array[1, 2, 2, 3, 20, 21, 22, 23, 24]) as d;
-- today, not finished: not a workout day
insert into public.logged_sessions (user_id, client_generated_id, started_at, completed_at)
values ('a0000000-0000-0000-0000-0000000000a1', gen_random_uuid(), now(), null);
-- a late-evening session: 23:30 UTC is 02:30 the NEXT day in Bucharest — 40 days ago, on its own
insert into public.logged_sessions (user_id, client_generated_id, started_at, completed_at)
values ('a0000000-0000-0000-0000-0000000000a1', gen_random_uuid(),
        (((now() at time zone 'Europe/Bucharest')::date - 40) || ' 23:30')::timestamp at time zone 'UTC',
        (((now() at time zone 'Europe/Bucharest')::date - 40) || ' 23:59')::timestamp at time zone 'UTC');

-- ---------- own days ----------
select pg_temp.authenticate_as('a0000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from public.workout_days(null)), 9,
  'one row per local workout day: 3 + 5 + the late one; the abandoned session is not a day');
select is((select workouts from public.workout_days(null) where day = to_char((now() at time zone 'Europe/Bucharest')::date - 2, 'YYYY-MM-DD')),
  2, 'two sessions on one day are one day with a count of 2');
select is((select day from public.workout_days(null) order by day limit 1),
  to_char((now() at time zone 'Europe/Bucharest')::date - 39, 'YYYY-MM-DD'),
  'a session at 23:30 UTC lands on the next local day in Bucharest');
select ok((select bool_and(prev < day) from (
    select day, lag(day) over (order by day) as prev from public.workout_days(null)) x where prev is not null),
  'days come back oldest first');

-- ---------- someone's streak, numbers only ----------
select is((select current_days from public.social_streak('a0000000-0000-0000-0000-0000000000a1')), 3,
  'current streak: three days ending yesterday (today still open)');
select is((select longest_days from public.social_streak('a0000000-0000-0000-0000-0000000000a1')), 5,
  'longest streak: the older five-day run');

select pg_temp.authenticate_as('b0000000-0000-0000-0000-0000000000b1');
select is((select current_days from public.social_streak('a0000000-0000-0000-0000-0000000000a1')), 3,
  'another user reads the same current streak');
select is((select longest_days from public.social_streak('a0000000-0000-0000-0000-0000000000a1')), 5,
  'another user reads the same longest streak');
select is((select count(*)::int from public.workout_days(null)), 0,
  'workout_days(null) is only ever the caller''s own days');
select is((select count(*)::int from public.workout_days('a0000000-0000-0000-0000-0000000000a1')), 0,
  'asking for someone else''s days returns nothing unless RLS lets you read their sessions');
select is((select count(*)::int from public.logged_sessions where user_id = 'a0000000-0000-0000-0000-0000000000a1'), 0,
  'the sessions behind the streak stay invisible to others');
select is((select current_days from public.social_streak('b0000000-0000-0000-0000-0000000000b1')), 0,
  'no workouts → streak 0');

-- ---------- streak posts ----------
select pg_temp.authenticate_as('a0000000-0000-0000-0000-0000000000a1');
select lives_ok($$
  insert into public.social_posts (user_id, type, payload, visibility)
  values ('a0000000-0000-0000-0000-0000000000a1', 'streak',
          '{"kind":"streak","streak_days":7,"milestone":7,"achieved_at":"2026-09-12","streak_start":"2026-09-06","title":"7 Day Streak"}', 'public')
$$, 'a streak milestone can be shared');
select throws_ok($$
  insert into public.social_posts (user_id, type, payload, visibility)
  values ('a0000000-0000-0000-0000-0000000000a1', 'streak',
          '{"kind":"streak","streak_days":8,"milestone":7,"achieved_at":"2026-09-12","streak_start":"2026-09-06","title":"7 Day Streak"}', 'public')
$$, '23505', null, 'the same milestone of the same streak is shared once');

select * from finish();
rollback;
