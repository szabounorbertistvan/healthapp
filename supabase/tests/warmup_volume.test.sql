-- pgTAP · one volume rule (20261202100000): a set prescribed as a warm-up adds
-- no volume in SQL, exactly as totalVolume() / trainingLoad() leave it out in
-- the app — and is still a set.
--
-- One completed session, today, for one person, one exercise, RPE 8:
--   2 × 40 kg × 10  warm-ups   (program_exercises.set_type = 'warmup')   →    0 kg
--   3 × 100 kg × 10 working    (set_type 'normal', the column default)   → 3000 kg
--   1 × 60 kg × 10  logged outside a program (program_exercise_id null)   →  600 kg
-- = 3600 kg over 6 sets. packages/shared/src/warmup-volume-parity.test.ts
-- feeds the same six sets to the app's functions and expects the same 3600.
--
-- Run with a local stack up:  npm run db:test   (or offline: npm run db:test:offline)

begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

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
  ('7a000000-0000-0000-0000-000000000001', 'warm@wv.local', '{"full_name":"Warm Up","username":"warmup_wv"}');
update public.users set timezone = 'Europe/Bucharest', created_at = '2026-01-01'
 where id = '7a000000-0000-0000-0000-000000000001';
insert into public.exercises (id, name_en, name_ro, source) values
  ('7a000000-0000-0000-0000-0000000000e1', 'Bench press', 'Împins la piept', 'custom');
insert into public.programs (id, coach_id, client_id, name, status) values
  ('7a000000-0000-0000-0000-0000000000a1', null, '7a000000-0000-0000-0000-000000000001', 'Block', 'published');
insert into public.program_days (id, program_id, week_index, day_index, name) values
  ('7a000000-0000-0000-0000-0000000000d1', '7a000000-0000-0000-0000-0000000000a1', 1, 0, 'Push');
insert into public.program_exercises (id, program_day_id, exercise_id, position, target_sets, target_reps, set_type) values
  ('7a000000-0000-0000-0000-0000000000f1', '7a000000-0000-0000-0000-0000000000d1', '7a000000-0000-0000-0000-0000000000e1', 0, 2, '10', 'warmup');
insert into public.program_exercises (id, program_day_id, exercise_id, position, target_sets, target_reps) values
  ('7a000000-0000-0000-0000-0000000000f2', '7a000000-0000-0000-0000-0000000000d1', '7a000000-0000-0000-0000-0000000000e1', 1, 3, '10');

-- Today, from a minute past local midnight, an hour long: inside today's week,
-- month and every challenge window below whatever time the suite runs.
insert into public.logged_sessions (id, user_id, client_generated_id, started_at, completed_at)
select '7a000000-0000-0000-0000-0000000000c1', '7a000000-0000-0000-0000-000000000001', gen_random_uuid(), t, t + interval '60 minutes'
  from (select ((now() at time zone 'Europe/Bucharest')::date + time '00:01') at time zone 'Europe/Bucharest' as t) x;
insert into public.logged_sets (session_id, user_id, exercise_id, program_exercise_id, set_index, weight_kg, reps, rpe, client_generated_id) values
  ('7a000000-0000-0000-0000-0000000000c1', '7a000000-0000-0000-0000-000000000001', '7a000000-0000-0000-0000-0000000000e1', '7a000000-0000-0000-0000-0000000000f1', 1, 40, 10, 8, gen_random_uuid()),
  ('7a000000-0000-0000-0000-0000000000c1', '7a000000-0000-0000-0000-000000000001', '7a000000-0000-0000-0000-0000000000e1', '7a000000-0000-0000-0000-0000000000f1', 2, 40, 10, 8, gen_random_uuid()),
  ('7a000000-0000-0000-0000-0000000000c1', '7a000000-0000-0000-0000-000000000001', '7a000000-0000-0000-0000-0000000000e1', '7a000000-0000-0000-0000-0000000000f2', 3, 100, 10, 8, gen_random_uuid()),
  ('7a000000-0000-0000-0000-0000000000c1', '7a000000-0000-0000-0000-000000000001', '7a000000-0000-0000-0000-0000000000e1', '7a000000-0000-0000-0000-0000000000f2', 4, 100, 10, 8, gen_random_uuid()),
  ('7a000000-0000-0000-0000-0000000000c1', '7a000000-0000-0000-0000-000000000001', '7a000000-0000-0000-0000-0000000000e1', '7a000000-0000-0000-0000-0000000000f2', 5, 100, 10, 8, gen_random_uuid()),
  ('7a000000-0000-0000-0000-0000000000c1', '7a000000-0000-0000-0000-000000000001', '7a000000-0000-0000-0000-0000000000e1', null,                                   6, 60, 10, 8, gen_random_uuid());

insert into public.challenges (id, title_en, title_ro, type, target_value, start_date, end_date, visibility, exercise_id, creator_id) values
  ('7a000000-0000-0000-0000-0000000000b1', 'Volume', 'Volum', 'volume', 100000, current_date - 7, current_date + 7, 'public', null, null),
  ('7a000000-0000-0000-0000-0000000000b2', 'Load', 'Încărcare', 'training_load', 100000, current_date - 7, current_date + 7, 'public', null, null);
insert into public.challenge_participants (challenge_id, user_id) values
  ('7a000000-0000-0000-0000-0000000000b1', '7a000000-0000-0000-0000-000000000001');

-- ---------- 1. the rule ----------
select is(public.is_warmup_set('7a000000-0000-0000-0000-0000000000f1'), true, 'a set prescribed as a warm-up is a warm-up');
select is(public.is_warmup_set('7a000000-0000-0000-0000-0000000000f2'), false, 'a normal prescription is a working set');
select is(public.is_warmup_set(null), false, 'a set logged outside a program is a working set');
select is(public.is_warmup_set(gen_random_uuid()), false, 'an unknown or deleted prescription is a working set');
select is(has_function_privilege('anon', 'public.is_warmup_set(uuid)', 'execute'), false, 'anon cannot call the helper');

-- ---------- 2. every rollup that sums volume ----------
select is((select total_volume from public.fitness_score_of('7a000000-0000-0000-0000-000000000001')), 3600::double precision,
  'fitness_score_of: warm-ups add no volume, working and unprescribed sets do');
select is(public.challenge_value('7a000000-0000-0000-0000-0000000000b1', '7a000000-0000-0000-0000-000000000001'), 3600::numeric,
  'challenge_value (volume): 3600, not 4400');
select is(public.challenge_value('7a000000-0000-0000-0000-0000000000b2', '7a000000-0000-0000-0000-000000000001'),
  public.training_load_score(3600, 6, 60, 8, 1)::numeric,
  'challenge_value (training load): the warm-ups are sets, but not volume');
-- These two are engine functions, closed to `authenticated`: read as the owner, as the engine does.
select is((public.achievement_facts('7a000000-0000-0000-0000-000000000001', array['volume_kg']) ->> 'volume_kg')::numeric, 3600::numeric,
  'achievement_facts (volume_kg): 3600');
select is((select sum(r.volume_kg) from public.challenge_progress_rows('7a000000-0000-0000-0000-0000000000b1') r
            where r.user_id = '7a000000-0000-0000-0000-000000000001'), 3600::numeric,
  'challenge_progress_rows: 3600');

select pg_temp.authenticate_as('7a000000-0000-0000-0000-000000000001');
select is((select score from public.social_leaderboard('volume', 'week') where is_current_user), 3600::numeric,
  'social_leaderboard (volume): 3600');
select is((select score from public.social_leaderboard('training_load', 'week') where is_current_user),
  public.training_load_score(3600, 6, 60, 8, 1)::numeric,
  'social_leaderboard (training load): 6 sets, 3600 kg');
select lives_ok($$
  insert into public.social_posts (id, user_id, type, payload, visibility, activity_id)
  values ('7a000000-0000-0000-0000-0000000000a9', '7a000000-0000-0000-0000-000000000001', 'workout',
          '{"kind":"workout","volume_kg":99999,"sets":999}', 'public', '7a000000-0000-0000-0000-0000000000c1') $$,
  'a workout post for the session is accepted');
reset role;
select is((select (payload ->> 'volume_kg')::numeric from public.social_posts where activity_id = '7a000000-0000-0000-0000-0000000000c1'), 3600::numeric,
  'social_posts_guard: the post carries 3600 kg');
select is((select (payload ->> 'sets')::int from public.social_posts where activity_id = '7a000000-0000-0000-0000-0000000000c1'), 6,
  '…and still six sets: a warm-up is a set');

-- ---------- 3. nothing else moved ----------
select is((select completed_workouts from public.fitness_score_of('7a000000-0000-0000-0000-000000000001')), 1,
  'the session still counts as a workout');

-- ---------- 4. the rewrite changed bodies, not access ----------
-- create or replace keeps grants; these hold the grants the functions had before 20261202100000.
select is(has_function_privilege('authenticated', 'public.social_leaderboard(text, text, text, int)', 'execute'), true, 'social_leaderboard: still callable by authenticated');
select is(has_function_privilege('anon', 'public.social_leaderboard(text, text, text, int)', 'execute'), false, 'social_leaderboard: still closed to anon');
select is(has_function_privilege('authenticated', 'public.fitness_score_of(uuid)', 'execute'), false, 'fitness_score_of: still closed to authenticated');
select is(has_function_privilege('authenticated', 'public.challenge_progress_rows(uuid)', 'execute'), false, 'challenge_progress_rows: still closed to authenticated');
select is(has_function_privilege('authenticated', 'public.challenge_value(uuid, uuid)', 'execute'), false, 'challenge_value: still closed to authenticated');
select is(has_function_privilege('authenticated', 'public.achievement_facts(uuid, text[])', 'execute'), false, 'achievement_facts: still closed to authenticated');
select is(has_function_privilege('anon', 'public.fitness_score_of(uuid)', 'execute'), false, 'fitness_score_of: still closed to anon');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and p.proname in ('fitness_score_of', 'social_leaderboard', 'challenge_progress_rows', 'challenge_value', 'achievement_facts', 'social_posts_guard')),
  6, 'all six are still security definer');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('fitness_score_of', 'social_leaderboard', 'challenge_progress_rows', 'challenge_value', 'achievement_facts', 'social_posts_guard')),
  6, '…and each still has exactly one overload');
select is(has_function_privilege('authenticated', 'public.is_warmup_set(uuid)', 'execute'), true, 'is_warmup_set: callable by authenticated (a security-invoker caller needs it)');

select * from finish();
rollback;
