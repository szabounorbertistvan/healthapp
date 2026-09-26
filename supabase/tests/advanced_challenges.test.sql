-- pgTAP · advanced challenges (20261001100000).
--
-- Every type's progress is computed in SQL from the rows people logged, on
-- each member's own calendar (users.timezone); completion and milestones are
-- stamped by the server once, whatever the number of requests; the leaderboard
-- ranks with ties and carries usernames and totals only; and nothing a
-- participant writes can move progress or completion.
--
-- Calendar facts the fixtures lean on: Europe/Bucharest is UTC+3 until
-- 2026-10-25 and UTC+2 after (DST ends inside the window); America/New_York is
-- UTC-4 through October.
--
-- Run with a local stack up:  npm run db:test   (or: npm run db:test:offline)

begin;
create extension if not exists pgtap with schema extensions;
select plan(40);

create or replace function pg_temp.authenticate_as(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$fn$;

-- A's own card for one challenge, as the app reads it.
create or replace function pg_temp.mine(p_challenge uuid)
returns table (value numeric, completed boolean, milestones smallint[])
language sql as $fn$
  select c.value, c.completed_at is not null, c.milestones
  from public.challenge_cards(p_challenge) c;
$fn$;

-- ---------- people ----------
insert into auth.users (id, email, raw_user_meta_data) values
  ('a5000000-0000-0000-0000-00000000000a', 'alice@ch.local', '{"full_name":"alice@private.example","username":"alice"}'),
  ('a5000000-0000-0000-0000-00000000000b', 'bob@ch.local',   '{"full_name":"Bob Secret","username":"bob"}'),
  ('a5000000-0000-0000-0000-00000000000c', 'carol@ch.local', '{"full_name":"Carol","username":"carol"}');
update public.users set timezone = 'Europe/Bucharest' where id in ('a5000000-0000-0000-0000-00000000000a', 'a5000000-0000-0000-0000-00000000000c');
update public.users set timezone = 'America/New_York' where id = 'a5000000-0000-0000-0000-00000000000b';

insert into public.exercises (id, source, external_id, name_en, primary_muscles) values
  ('b5000000-0000-0000-0000-000000000001', 'custom', 'adv-squat', 'Squat', '{quadriceps}'),
  ('b5000000-0000-0000-0000-000000000002', 'custom', 'adv-row',   'Row',   '{lats}');

-- ---------- challenges: all of October 2026, platform-owned unless noted ----------
insert into public.challenges (id, title_en, title_ro, type, target_value, start_date, end_date, visibility, exercise_id, creator_id) values
  ('c5000000-0000-0000-0000-000000000001', 'Workouts', 'Antrenamente', 'workouts',          3,    '2026-10-01', '2026-10-31', 'public', null, null),
  ('c5000000-0000-0000-0000-000000000002', 'Volume',   'Volum',        'volume',            1000, '2026-10-01', '2026-10-31', 'public', null, null),
  ('c5000000-0000-0000-0000-000000000003', 'Squats',   'Genuflexiuni', 'exercise_sessions', 2,    '2026-10-01', '2026-10-31', 'public', 'b5000000-0000-0000-0000-000000000001', null),
  ('c5000000-0000-0000-0000-000000000004', 'Squat +5%','Genuflexiuni +5%', 'strength_gain', 5,    '2026-10-01', '2026-10-31', 'public', 'b5000000-0000-0000-0000-000000000001', null),
  ('c5000000-0000-0000-0000-000000000005', 'Check-ins','Check-in-uri', 'check_ins',         2,    '2026-10-01', '2026-10-31', 'public', null, null),
  ('c5000000-0000-0000-0000-000000000006', 'Food',     'Mâncare',      'nutrition_days',    2,    '2026-10-01', '2026-10-31', 'public', null, null),
  ('c5000000-0000-0000-0000-000000000007', 'Habits',   'Obiceiuri',    'habit_completions', 3,    '2026-10-01', '2026-10-31', 'public', null, null),
  ('c5000000-0000-0000-0000-000000000008', 'Bob only', 'Doar Bob',     'workouts',          1,    '2026-10-01', '2026-10-31', 'private', null, 'a5000000-0000-0000-0000-00000000000b'),
  ('c5000000-0000-0000-0000-000000000009', 'Load',     'Încărcare',    'training_load',     30,   '2026-10-01', '2026-10-31', 'public', null, null),
  ('c5000000-0000-0000-0000-000000000010', 'Rows',     'Ramat',        'exercise_sessions', 1,    '2026-10-01', '2026-10-31', 'public', 'b5000000-0000-0000-0000-000000000002', null);

insert into public.challenge_participants (challenge_id, user_id)
select c, 'a5000000-0000-0000-0000-00000000000a'::uuid
from unnest(array[
  'c5000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002', 'c5000000-0000-0000-0000-000000000003',
  'c5000000-0000-0000-0000-000000000004', 'c5000000-0000-0000-0000-000000000005', 'c5000000-0000-0000-0000-000000000006',
  'c5000000-0000-0000-0000-000000000007', 'c5000000-0000-0000-0000-000000000009', 'c5000000-0000-0000-0000-000000000010']::uuid[]) c;
insert into public.challenge_participants (challenge_id, user_id) values
  ('c5000000-0000-0000-0000-000000000001', 'a5000000-0000-0000-0000-00000000000b'),
  ('c5000000-0000-0000-0000-000000000008', 'a5000000-0000-0000-0000-00000000000b'),
  ('c5000000-0000-0000-0000-000000000001', 'a5000000-0000-0000-0000-00000000000c');

-- ---------- Alice's training (Bucharest) ----------
insert into public.logged_sessions (id, user_id, client_generated_id, started_at, completed_at) values
  -- baseline, before the window
  ('f5000000-0000-0000-0000-000000000000', 'a5000000-0000-0000-0000-00000000000a', gen_random_uuid(), '2026-09-20T10:00:00Z', '2026-09-20T11:00:00Z'),
  -- 00:30 local on Oct 1 = 21:30 UTC on Sep 30: IN (the local day decides)
  ('f5000000-0000-0000-0000-000000000001', 'a5000000-0000-0000-0000-00000000000a', gen_random_uuid(), '2026-09-30T21:30:00Z', '2026-09-30T22:30:00Z'),
  -- 23:30 local on Sep 30: OUT
  ('f5000000-0000-0000-0000-000000000002', 'a5000000-0000-0000-0000-00000000000a', gen_random_uuid(), '2026-09-30T20:30:00Z', '2026-09-30T21:30:00Z'),
  -- 23:30 local on Oct 31, after DST ended (UTC+2): IN
  ('f5000000-0000-0000-0000-000000000003', 'a5000000-0000-0000-0000-00000000000a', gen_random_uuid(), '2026-10-31T21:30:00Z', '2026-10-31T22:30:00Z'),
  -- 00:10 local on Nov 1 = 22:10 UTC on Oct 31: OUT
  ('f5000000-0000-0000-0000-000000000004', 'a5000000-0000-0000-0000-00000000000a', gen_random_uuid(), '2026-10-31T22:10:00Z', '2026-10-31T23:10:00Z'),
  -- abandoned inside the window: never counts
  ('f5000000-0000-0000-0000-000000000005', 'a5000000-0000-0000-0000-00000000000a', gen_random_uuid(), '2026-10-10T10:00:00Z', null);
insert into public.logged_sets (session_id, user_id, exercise_id, set_index, reps, weight_kg, client_generated_id) values
  ('f5000000-0000-0000-0000-000000000000', 'a5000000-0000-0000-0000-00000000000a', 'b5000000-0000-0000-0000-000000000001', 1, 5, 100, gen_random_uuid()),
  ('f5000000-0000-0000-0000-000000000001', 'a5000000-0000-0000-0000-00000000000a', 'b5000000-0000-0000-0000-000000000001', 1, 5, 105, gen_random_uuid()),
  -- a row set: before the start, so it must not become the squat's baseline
  ('f5000000-0000-0000-0000-000000000002', 'a5000000-0000-0000-0000-00000000000a', 'b5000000-0000-0000-0000-000000000002', 1, 5, 300, gen_random_uuid()),
  ('f5000000-0000-0000-0000-000000000003', 'a5000000-0000-0000-0000-00000000000a', 'b5000000-0000-0000-0000-000000000001', 1, 10, 50, gen_random_uuid()),
  ('f5000000-0000-0000-0000-000000000004', 'a5000000-0000-0000-0000-00000000000a', 'b5000000-0000-0000-0000-000000000001', 1, 1, 200, gen_random_uuid()),
  ('f5000000-0000-0000-0000-000000000005', 'a5000000-0000-0000-0000-00000000000a', 'b5000000-0000-0000-0000-000000000001', 1, 1, 300, gen_random_uuid());

-- ---------- Bob's training (New York) ----------
insert into public.logged_sessions (id, user_id, client_generated_id, started_at, completed_at) values
  -- 23:30 local on Sep 30 though it is Oct 1 in UTC: OUT
  ('f5000000-0000-0000-0000-000000000011', 'a5000000-0000-0000-0000-00000000000b', gen_random_uuid(), '2026-10-01T03:30:00Z', '2026-10-01T04:30:00Z'),
  ('f5000000-0000-0000-0000-000000000012', 'a5000000-0000-0000-0000-00000000000b', gen_random_uuid(), '2026-10-02T12:00:00Z', '2026-10-02T13:00:00Z'),
  ('f5000000-0000-0000-0000-000000000013', 'a5000000-0000-0000-0000-00000000000b', gen_random_uuid(), '2026-10-03T12:00:00Z', '2026-10-03T13:00:00Z');

-- ---------- Alice's check-ins, food and habits ----------
insert into public.check_ins (user_id, week_start, submitted_at) values
  ('a5000000-0000-0000-0000-00000000000a', '2026-10-05', '2026-10-05T10:00:00Z'),
  -- 00:10 local on Nov 1: OUT
  ('a5000000-0000-0000-0000-00000000000a', '2026-10-26', '2026-10-31T22:10:00Z');
insert into public.food_logs (user_id, date, slot, food_name, grams, kcal, client_generated_id) values
  ('a5000000-0000-0000-0000-00000000000a', '2026-10-02', 'lunch', 'Rice', 150, 500, gen_random_uuid()),
  -- a day with only zero-calorie entries is not a logged day (the nutrition rule)
  ('a5000000-0000-0000-0000-00000000000a', '2026-10-03', 'snack', 'Water', 500, 0, gen_random_uuid());
insert into public.habits (id, user_id, created_by, name) values
  ('a6000000-0000-0000-0000-000000000001', 'a5000000-0000-0000-0000-00000000000a', 'a5000000-0000-0000-0000-00000000000a', 'Walk');
insert into public.habit_logs (habit_id, user_id, date, client_generated_id) values
  ('a6000000-0000-0000-0000-000000000001', 'a5000000-0000-0000-0000-00000000000a', '2026-10-05', gen_random_uuid()),
  ('a6000000-0000-0000-0000-000000000001', 'a5000000-0000-0000-0000-00000000000a', '2026-10-06', gen_random_uuid()),
  ('a6000000-0000-0000-0000-000000000001', 'a5000000-0000-0000-0000-00000000000a', '2026-10-07', gen_random_uuid());

-- =================== progress, per type, as Alice ===================
select pg_temp.authenticate_as('a5000000-0000-0000-0000-00000000000a');

select is((select value from pg_temp.mine('c5000000-0000-0000-0000-000000000001')), 2::numeric,
  'workouts: local midnight and the post-DST last evening count; the evening before and 00:10 after do not; abandoned never');
select is((select value from pg_temp.mine('c5000000-0000-0000-0000-000000000002')), 1025::numeric,
  'volume: 105×5 + 50×10, exact; the out-of-window 300 kg and 200 kg sets are not in it');
select is((select value from pg_temp.mine('c5000000-0000-0000-0000-000000000003')), 2::numeric,
  'exercise sessions: sessions in the window that trained the squat');
select is((select value from pg_temp.mine('c5000000-0000-0000-0000-000000000010')), 0::numeric,
  'exercise sessions: zero for a lift never trained');
select is((select value from pg_temp.mine('c5000000-0000-0000-0000-000000000004')), 5::numeric,
  'strength gain: best e1RM in the window (105×5) vs before it (100×5) is exactly +5 %');
select is((select value from pg_temp.mine('c5000000-0000-0000-0000-000000000005')), 1::numeric,
  'check-ins: counted on the local day submitted; 00:10 on Nov 1 is outside');
select is((select value from pg_temp.mine('c5000000-0000-0000-0000-000000000006')), 1::numeric,
  'nutrition days: only days with calories');
select is((select value from pg_temp.mine('c5000000-0000-0000-0000-000000000007')), 3::numeric,
  'habit completions: every logged habit day in the window');
select is((select value from pg_temp.mine('c5000000-0000-0000-0000-000000000009')), 34::numeric,
  'training load: the sum of the shared training_load_score per session (17 + 17, as trainingLoadFromStats gives)');

-- =================== milestones and completion ===================
select is((select milestones from pg_temp.mine('c5000000-0000-0000-0000-000000000001')), '{25,50}'::smallint[],
  'partial progress: 2 of 3 reaches 25 % and 50 %, not 75 %');
select is((select completed from pg_temp.mine('c5000000-0000-0000-0000-000000000001')), false,
  'and is not complete');
select is((select milestones from pg_temp.mine('c5000000-0000-0000-0000-000000000002')), '{25,50,75,100}'::smallint[],
  'over target: every milestone');
select is((select completed from pg_temp.mine('c5000000-0000-0000-0000-000000000002')), true,
  'over target: complete');
select is((select milestones from pg_temp.mine('c5000000-0000-0000-0000-000000000010')), '{}'::smallint[],
  'zero progress: no milestones');

reset role;
select is(
  (select count(*)::int from public.notifications where user_id = 'a5000000-0000-0000-0000-00000000000a' and category = 'challenge_milestone'),
  8, 'one notification per challenge that moved — the highest step reached, never one per step');
select is(
  (select count(*)::int from public.challenge_participants where user_id = 'a5000000-0000-0000-0000-00000000000a' and completed_at is not null),
  5, 'five complete: volume, squats, strength, habits, load');

create temp table stamps as
  select challenge_id, completed_at from public.challenge_participants
  where user_id = 'a5000000-0000-0000-0000-00000000000a' and completed_at is not null;

-- read again, twice: nothing new is stamped or sent
select pg_temp.authenticate_as('a5000000-0000-0000-0000-00000000000a');
select count(*) from public.challenge_cards();
select count(*) from public.challenge_cards();
reset role;
select is(
  (select count(*)::int from public.notifications where user_id = 'a5000000-0000-0000-0000-00000000000a' and category = 'challenge_milestone'),
  8, 'reading again sends nothing new');
select is(
  (select count(*)::int from public.challenge_participants p join stamps s using (challenge_id)
   where p.user_id = 'a5000000-0000-0000-0000-00000000000a' and p.completed_at = s.completed_at),
  5, 'and every completion keeps its first timestamp');
select is(
  (select count(*)::int from public.user_badges ub join public.badges b on b.id = ub.badge_id
   where ub.user_id = 'a5000000-0000-0000-0000-00000000000a' and b.slug = 'first-challenge'),
  1, 'the first-challenge badge is awarded once');

-- =================== nobody writes progress directly ===================
select pg_temp.authenticate_as('a5000000-0000-0000-0000-00000000000a');
select throws_ok(
  $$ update public.challenge_participants set completed_at = now()
     where challenge_id = 'c5000000-0000-0000-0000-000000000001' and user_id = auth.uid() $$,
  '42501', null, 'a participant cannot mark themselves complete');
select throws_ok(
  $$ insert into public.challenge_milestones (participant_id, milestone)
     select id, 100 from public.challenge_participants
     where challenge_id = 'c5000000-0000-0000-0000-000000000001' and user_id = auth.uid() $$,
  '42501', null, 'nor write a milestone');
select throws_ok(
  $$ select public.challenge_value('c5000000-0000-0000-0000-000000000001', 'a5000000-0000-0000-0000-00000000000b') $$,
  '42501', null, 'nor compute somebody else''s progress directly');
select throws_ok(
  $$ select * from public.challenge_progress_rows('c5000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'the old per-session rollup RPC is closed to the app');

-- =================== leaderboard ===================
select pg_temp.authenticate_as('a5000000-0000-0000-0000-00000000000c');
select is(
  (select string_agg(rank || ':' || username || ':' || value::text, ',' order by rank, username)
   from public.challenge_leaderboard('c5000000-0000-0000-0000-000000000001')),
  '1:alice:2,1:bob:2,3:carol:0', 'ties share a rank and the next rank skips (1, 1, 3)');
select is(
  (select max(participant_count) from public.challenge_leaderboard('c5000000-0000-0000-0000-000000000001')),
  3, 'the participant count travels with the board');
select is(
  (select count(*)::int from public.challenge_leaderboard('c5000000-0000-0000-0000-000000000001') where is_me),
  1, 'the caller''s own row is flagged');
select is(
  (select count(*)::int from public.challenge_leaderboard('c5000000-0000-0000-0000-000000000001', 1)),
  2, 'a short board still includes the caller''s own row (top 1 + me)');
select is(
  (select count(*)::int from public.challenge_leaderboard('c5000000-0000-0000-0000-000000000008')),
  0, 'a private challenge''s board is empty to an outsider');
select is(
  (select count(*)::int from information_schema.columns
   where table_schema = 'public' and table_name = 'challenge_participants' and column_name = 'full_name')
  + (select count(*)::int from public.challenge_leaderboard('c5000000-0000-0000-0000-000000000001') where username like '%@%'),
  0, 'no full name or e-mail reaches the board');
select is(
  (select count(*)::int from public.challenge_participants where challenge_id = 'c5000000-0000-0000-0000-000000000001'),
  1, 'a participant sees only their own participant row, not who else joined');

-- =================== cards / discovery ===================
select is(
  (select count(*)::int from public.challenge_cards() where id = 'c5000000-0000-0000-0000-000000000008'),
  0, 'the card list never carries a private challenge you are not in');
select is(
  (select participant_count || '/' || joined::text || '/' || coalesce(value::text, 'null')
   from public.challenge_cards('c5000000-0000-0000-0000-000000000002')),
  '1/false/null', 'a card you have not joined shows the count, not anyone''s progress');

-- =================== creators and the platform ===================
select pg_temp.authenticate_as('a5000000-0000-0000-0000-00000000000b');
select lives_ok(
  $$ update public.challenges set title_en = 'Bob only (edited)', description_en = 'x'
     where id = 'c5000000-0000-0000-0000-000000000008' $$,
  'a creator edits the words of their own challenge');
select throws_ok(
  $$ update public.challenges set target_value = 0.5 where id = 'c5000000-0000-0000-0000-000000000008' $$,
  '42501', null, 'but never its target');
select throws_ok(
  $$ update public.challenges set end_date = '2027-01-01' where id = 'c5000000-0000-0000-0000-000000000008' $$,
  '42501', null, 'nor its dates');
update public.challenges set title_en = 'hijacked' where id = 'c5000000-0000-0000-0000-000000000001';
select is(
  (select title_en from public.challenges where id = 'c5000000-0000-0000-0000-000000000001'),
  'Workouts', 'a platform challenge cannot be edited by a user (the update reaches no row)');
select throws_ok(
  $$ insert into public.challenges (title_en, title_ro, type, target_value, start_date, end_date, creator_id)
     values ('Official', 'Oficial', 'workouts', 1, '2026-10-01', '2026-10-31', null) $$,
  '42501', null, 'nobody creates a platform challenge from the app');
select throws_ok(
  $$ insert into public.challenges (title_en, title_ro, type, target_value, start_date, end_date, creator_id)
     values ('Squats', 'Genuflexiuni', 'exercise_sessions', 3, '2026-10-01', '2026-10-31', auth.uid()) $$,
  '23514', null, 'an exercise challenge needs its exercise');
select throws_ok(
  $$ insert into public.challenge_participants (challenge_id, user_id, completed_at)
     values ('c5000000-0000-0000-0000-000000000002', auth.uid(), now()) $$,
  '42501', null, 'joining cannot smuggle in a completion');
select lives_ok(
  $$ insert into public.challenges (title_en, title_ro, type, target_value, start_date, end_date, creator_id, difficulty)
     values ('Mine', 'Al meu', 'nutrition_days', 10, '2026-10-01', '2026-10-31', auth.uid(), 'medium') $$,
  'a user creates their own challenge of a new type, with a difficulty');

select * from finish();
rollback;
