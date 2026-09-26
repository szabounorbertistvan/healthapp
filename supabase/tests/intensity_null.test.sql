-- pgTAP · a set with no RPE and no RIR has no intensity (20260930140000).
--
-- greatest(1, NULL) is 1 in Postgres, and every SQL training-load rollup used
-- to average least(10, greatest(1, coalesce(rpe, 10 - rir))) — so a set
-- logged without intensity counted as "RPE 1". The cases below are CASES in
-- apps/web/lib/intensity-parity.test.ts, transcribed; every number asserted
-- here is pinned there against packages/shared (effectiveRpe, trainingLoad).
--
-- Intermediates are asserted, not only the final load: the bug changed the
-- mean intensity first, and a wrong intermediate must not be able to hide
-- behind a final score that happens to round the same way.
--
-- Run with a local stack up:  npm run db:test
-- Or without Docker:          npm run db:test:offline

begin;
create extension if not exists pgtap with schema extensions;
select plan(36);

create or replace function pg_temp.authenticate_as(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$fn$;

create or replace function pg_temp.noon(k int)
returns timestamptz language sql stable as $fn$
  select (((now() at time zone 'Europe/Bucharest')::date - k) + time '12:00') at time zone 'Europe/Bucharest';
$fn$;

-- One person per case, so each leaderboard total is that case alone.
insert into auth.users (id, email, raw_user_meta_data) values
  ('6d000000-0000-0000-0000-000000000001', 'rpe@int.test',     '{"full_name":"Rpe","username":"int_rpe"}'),
  ('6d000000-0000-0000-0000-000000000002', 'rir@int.test',     '{"full_name":"Rir","username":"int_rir"}'),
  ('6d000000-0000-0000-0000-000000000003', 'none@int.test',    '{"full_name":"None","username":"int_none"}'),
  ('6d000000-0000-0000-0000-000000000004', 'mix@int.test',     '{"full_name":"Mix","username":"int_mix"}'),
  ('6d000000-0000-0000-0000-000000000005', 'sameday@int.test', '{"full_name":"Sameday","username":"int_sameday"}'),
  ('6d000000-0000-0000-0000-000000000006', 'window@int.test',  '{"full_name":"Window","username":"int_window"}');
update public.users set timezone = 'Europe/Bucharest' where id::text like '6d000000-%';

insert into public.exercises (id, name_en, source) values
  ('6de00000-0000-0000-0000-00000000000a', 'A INT', 'custom'),
  ('6de00000-0000-0000-0000-00000000000b', 'B INT', 'custom');

-- A training-load challenge over the last ten local days, everyone in it.
insert into public.challenges (id, title_en, title_ro, type, target_value, start_date, end_date, visibility) values
  ('6dc00000-0000-0000-0000-000000000001', 'Load INT', 'Load INT', 'training_load', 500,
   (now() at time zone 'Europe/Bucharest')::date - 10, (now() at time zone 'Europe/Bucharest')::date, 'public');
insert into public.challenge_participants (challenge_id, user_id)
select '6dc00000-0000-0000-0000-000000000001', id from auth.users where id::text like '6d000000-%';

-- (session, user, days ago, minutes, completed)
insert into public.logged_sessions (id, user_id, client_generated_id, started_at, completed_at)
select s, u, s, pg_temp.noon(k), case when done then pg_temp.noon(k) + make_interval(mins => m) end
from (values
  ('6d500000-0000-0000-0000-000000000001'::uuid, '6d000000-0000-0000-0000-000000000001'::uuid, 1, 50, true),
  ('6d500000-0000-0000-0000-000000000002', '6d000000-0000-0000-0000-000000000002', 1, 50, true),
  ('6d500000-0000-0000-0000-000000000003', '6d000000-0000-0000-0000-000000000003', 1, 50, true),
  ('6d500000-0000-0000-0000-000000000004', '6d000000-0000-0000-0000-000000000004', 2, 60, true),
  ('6d500000-0000-0000-0000-000000000051', '6d000000-0000-0000-0000-000000000005', 3, 40, true),
  ('6d500000-0000-0000-0000-000000000052', '6d000000-0000-0000-0000-000000000005', 3, 30, true),
  ('6d500000-0000-0000-0000-000000000061', '6d000000-0000-0000-0000-000000000006', 20, 50, true),
  ('6d500000-0000-0000-0000-000000000062', '6d000000-0000-0000-0000-000000000006', 1, 50, false)
) f(s, u, k, m, done);

-- (session, exercise, kg, reps, rpe, rir)
insert into public.logged_sets (session_id, user_id, exercise_id, client_generated_id, set_index, weight_kg, reps, rpe, rir)
select f.s, ses.user_id, ('6de00000-0000-0000-0000-00000000000' || f.ex)::uuid, gen_random_uuid(),
       row_number() over (partition by f.s order by f.ord), f.kg, f.reps, f.rpe, f.rir
from (values
  ('6d500000-0000-0000-0000-000000000001'::uuid, 1, 'a', 100::numeric, 5, 8::numeric, null::numeric),
  ('6d500000-0000-0000-0000-000000000001', 2, 'a', 100, 5, 9, null),
  ('6d500000-0000-0000-0000-000000000002', 1, 'a', 100, 5, null, 2),
  ('6d500000-0000-0000-0000-000000000002', 2, 'a', 100, 5, null, 1),
  ('6d500000-0000-0000-0000-000000000003', 1, 'a', 100, 5, null, null),
  ('6d500000-0000-0000-0000-000000000003', 2, 'a', 100, 5, null, null),
  ('6d500000-0000-0000-0000-000000000004', 1, 'a', 100, 5, 8, null),
  ('6d500000-0000-0000-0000-000000000004', 2, 'a', 100, 5, null, 2),
  ('6d500000-0000-0000-0000-000000000004', 3, 'a', 80, 5, 7, 1),
  ('6d500000-0000-0000-0000-000000000004', 4, 'a', 100, 5, null, null),
  ('6d500000-0000-0000-0000-000000000004', 5, 'a', 0, 12, null, null),
  ('6d500000-0000-0000-0000-000000000004', 6, 'a', 50, 0, 10, null),
  ('6d500000-0000-0000-0000-000000000004', 7, 'b', null, 10, 6, null),
  ('6d500000-0000-0000-0000-000000000004', 8, 'b', -5, 10, null, null),
  ('6d500000-0000-0000-0000-000000000051', 1, 'a', 60, 10, null, null),
  ('6d500000-0000-0000-0000-000000000052', 1, 'a', 60, 10, 7, null),
  ('6d500000-0000-0000-0000-000000000061', 1, 'a', 100, 5, 8, null),
  ('6d500000-0000-0000-0000-000000000062', 1, 'a', 100, 5, 8, null)
) f(s, ord, ex, kg, reps, rpe, rir)
join public.logged_sessions ses on ses.id = f.s;

-- ---------- 1. the per-set rule ----------
select is(public.effective_rpe(8, null), 8::numeric, 'effective_rpe: an RPE is used as is');
select is(public.effective_rpe(null, 2), 8::numeric, 'effective_rpe: an RIR becomes 10 − RIR');
select is(public.effective_rpe(7, 1), 7::numeric, 'effective_rpe: with both, the RPE wins (as effectiveRpe)');
select is(public.effective_rpe(null, null), null::numeric, 'effective_rpe: neither → NULL, never 1');
select is(public.effective_rpe(null, 0), 10::numeric, 'effective_rpe: RIR 0 is RPE 10');
select is(public.effective_rpe(null, 10), 1::numeric, 'effective_rpe: RIR 10 clamps to RPE 1');

-- ---------- 2. challenges: the rollup and the load built from it ----------
-- Rows as the app reads them, with the load challenges-data.ts computes from
-- them (trainingLoadFromStats ≡ training_load_score).
select pg_temp.authenticate_as('6d000000-0000-0000-0000-000000000001');
create temp table rows_now as
select r.*, public.training_load_score(r.volume_kg::double precision, r.sets, r.duration_min,
                                       r.mean_rpe::double precision, r.exercises) as load
from public.challenge_progress_rows('6dc00000-0000-0000-0000-000000000001') r
where r.kind = 'session';

select is((select mean_rpe from rows_now where username = 'int_rpe'), 8.5::numeric, 'challenge · RPE: mean intensity 8.5');
select is((select load from rows_now where username = 'int_rpe'), 28, 'challenge · RPE: load 28, unchanged');
select is((select mean_rpe from rows_now where username = 'int_rir'), 8.5::numeric, 'challenge · RIR: mean intensity 8.5');
select is((select load from rows_now where username = 'int_rir'), 28, 'challenge · RIR: load 28, unchanged');

select is((select mean_rpe from rows_now where username = 'int_none'), null::numeric,
  'challenge · no RPE/RIR: intensity is missing, not 1 (the regression)');
select is((select sets from rows_now where username = 'int_none'), 2, 'challenge · no RPE/RIR: 2 sets');
select is((select volume_kg from rows_now where username = 'int_none'), 1000::numeric, 'challenge · no RPE/RIR: 1000 kg');
select is((select load from rows_now where username = 'int_none'), 20, 'challenge · no RPE/RIR: load 20 (was 17)');

select is((select round(mean_rpe, 4) from rows_now where username = 'int_mix'), 7.25::numeric,
  'challenge · mix: mean of 8, 8, 7 and 6 only — the four sets without intensity are left out');
select is((select sets from rows_now where username = 'int_mix'), 7, 'challenge · mix: reps = 0 is not a set');
select is((select volume_kg from rows_now where username = 'int_mix'), 1900::numeric,
  'challenge · mix: bodyweight, unrecorded and negative weights add 0 kg');
select is((select exercises from rows_now where username = 'int_mix'), 2, 'challenge · mix: 2 exercises');
select is((select load from rows_now where username = 'int_mix'), 36, 'challenge · mix: load 36 (was 29)');

select is((select count(*)::int from rows_now where username = 'int_sameday'), 2,
  'challenge · two sessions on one day are two rows');
select is((select array_agg(load order by load) from rows_now where username = 'int_sameday'), array[15, 19],
  'challenge · same day: 15 (no intensity; was 12) and 19');
select is((select count(*)::int from rows_now where username = 'int_window'), 0,
  'challenge · a session outside the window and an unfinished one contribute nothing');

-- ---------- 3. before: the old expression, recomputed on the same rows ----------
reset role;
create temp table rows_old as
select s.user_id,
  avg(least(10, greatest(1, coalesce(ls.rpe, 10 - ls.rir)))) filter (where ls.reps > 0) as mean_rpe,
  public.training_load_score(
    coalesce(sum(greatest(ls.weight_kg, 0) * ls.reps) filter (where ls.reps > 0), 0)::double precision,
    count(ls.id) filter (where ls.reps > 0)::int,
    nullif(round(extract(epoch from (s.completed_at - s.started_at)) / 60)::int, 0),
    (avg(least(10, greatest(1, coalesce(ls.rpe, 10 - ls.rir)))) filter (where ls.reps > 0))::double precision,
    count(distinct ls.exercise_id) filter (where ls.reps > 0)::int) as load
from public.logged_sessions s join public.logged_sets ls on ls.session_id = s.id
where s.id in ('6d500000-0000-0000-0000-000000000003', '6d500000-0000-0000-0000-000000000004')
group by s.id, s.user_id, s.started_at, s.completed_at;

select is((select mean_rpe from rows_old where user_id = '6d000000-0000-0000-0000-000000000003'), 1::numeric,
  'before: the old expression turned "no RPE/RIR" into intensity 1');
select is((select load from rows_old where user_id = '6d000000-0000-0000-0000-000000000003'), 17,
  'before: which scored the session 17 instead of 20');
select is((select round(mean_rpe, 4) from rows_old where user_id = '6d000000-0000-0000-0000-000000000004'), round(32 / 7.0, 4),
  'before: the mixed session averaged three phantom 1s in');
select is((select load from rows_old where user_id = '6d000000-0000-0000-0000-000000000004'), 29,
  'before: 29 instead of 36');

-- ---------- 4. leaderboards: same fix, nothing else moved ----------
select pg_temp.authenticate_as('6d000000-0000-0000-0000-000000000001');
create temp table board as
select * from public.social_leaderboard('training_load', 'all', 'global', 50);
select is((select score from board where username = 'int_rpe'), 28::numeric, 'leaderboard · RPE: 28');
select is((select score from board where username = 'int_rir'), 28::numeric, 'leaderboard · RIR: 28');
select is((select score from board where username = 'int_none'), 20::numeric, 'leaderboard · no RPE/RIR: 20, not 17');
select is((select score from board where username = 'int_mix'), 36::numeric, 'leaderboard · mix: 36, not 29');
select is((select score from board where username = 'int_sameday'), 34::numeric, 'leaderboard · same day: 15 + 19');
select is((select score from board where username = 'int_window'), 23::numeric,
  'leaderboard · all time counts the finished session 20 days ago, not the unfinished one');
select is((select rank from board where username = 'int_mix') < (select rank from board where username = 'int_rpe'), true,
  'leaderboard · ranking still orders by score');

create temp table volume_board as
select * from public.social_leaderboard('volume', 'all', 'global', 50);
select is((select score from volume_board where username = 'int_mix'), 1900::numeric,
  'leaderboard · volume is untouched by the fix');

-- ---------- 5. fitness score keeps its numbers ----------
-- fitness_score_of() switched from a hand-written filter to effective_rpe();
-- the mixed session's load inside it must be the same 36. Asked as the owner:
-- the engine function is not callable by users (see social_v2_cleanup).
reset role;
select is((select round(average_training_load)::int from public.fitness_score_of('6d000000-0000-0000-0000-000000000004')), 36,
  'fitness score · the shared conversion gives the same load it gave before');
select is((select completed_workouts from public.fitness_score_of('6d000000-0000-0000-0000-000000000004')), 1,
  'fitness score · one workout, still building');

select * from finish();
rollback;
