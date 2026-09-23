-- pgTAP · social v2 cleanup: the Fitness Score is the database's number, and
-- posts can be re-captioned without touching anything else.
--
-- Part 1 is a parity test as much as a security test. The sessions below are
-- FIXTURE in apps/web/lib/fitness-score-parity.test.ts, transcribed; the
-- numbers asserted are the ones fitnessScore() produces there. If the two
-- implementations drift, one of the two files fails.
--
-- Then: every way a signed-in user could try to publish a number of their
-- choosing — an argument, a PATCH, a hand-made post payload, someone else's
-- id — and what the database does with each.
--
-- Run with a local stack up:  npm run db:test
-- Or without Docker:          npm run db:test:offline

begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

create or replace function pg_temp.authenticate_as(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$fn$;

create or replace function pg_temp.rows_touched(p_sql text)
returns int language plpgsql as $fn$
declare v_n int;
begin
  execute p_sql;
  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

-- Local noon, k days ago, on the owner's calendar — the fixture's localNoon().
create or replace function pg_temp.noon(k int)
returns timestamptz language sql stable as $fn$
  select (((now() at time zone 'Europe/Bucharest')::date - k) + time '12:00') at time zone 'Europe/Bucharest';
$fn$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('6c000000-0000-0000-0000-00000000000a', 'owner@v2x.test',    '{"full_name":"Owner V2X","username":"ownerv2x"}'),
  ('6c000000-0000-0000-0000-000000000005', 'stranger@v2x.test', '{"full_name":"Stranger V2X","username":"strangerv2x"}');
update public.users set timezone = 'Europe/Bucharest' where id = '6c000000-0000-0000-0000-00000000000a';

insert into public.exercises (id, name_en, source) values
  ('6ce00000-0000-0000-0000-00000000000a', 'A V2X', 'custom'),
  ('6ce00000-0000-0000-0000-00000000000b', 'B V2X', 'custom'),
  ('6ce00000-0000-0000-0000-00000000000c', 'C V2X', 'custom'),
  ('6ce00000-0000-0000-0000-00000000000d', 'D V2X', 'custom');

-- ---------- the fixture ----------
-- (session, days ago, minutes, completed)
insert into public.logged_sessions (id, user_id, client_generated_id, started_at, completed_at)
select ('6c500000-0000-0000-0000-00000000000' || n)::uuid, '6c000000-0000-0000-0000-00000000000a',
       ('6c500000-0000-0000-0000-00000000000' || n)::uuid,
       pg_temp.noon(k), case when done then pg_temp.noon(k) + make_interval(mins => m) end
from (values (1, 1, 55, true), (2, 2, 70, true), (3, 2, 30, true), (4, 5, 45, true),
             (5, 9, 400, true), (6, 20, 40, true), (7, 35, 50, true), (8, 3, 50, false)) f(n, k, m, done);

-- (session, exercise, kg, reps, rpe, rir)
insert into public.logged_sets (session_id, user_id, exercise_id, client_generated_id, set_index, weight_kg, reps, rpe, rir)
select ('6c500000-0000-0000-0000-00000000000' || n)::uuid, '6c000000-0000-0000-0000-00000000000a',
       ('6ce00000-0000-0000-0000-00000000000' || ex)::uuid, gen_random_uuid(),
       row_number() over (partition by n order by ord), kg, reps, rpe, rir
from (values
  (1, 1, 'a', 100, 5, 8, null), (1, 2, 'a', 100, 5, 8, null), (1, 3, 'a', 100, 5, 9, null), (1, 4, 'b', 60, 10, null, 2), (1, 5, 'b', 60, 10, null, 2),
  (2, 1, 'a', 80, 8, 7, null), (2, 2, 'c', 20, 12, null, null), (2, 3, 'c', 20, 12, null, null), (2, 4, 'c', 0, 15, null, null), (2, 5, 'd', 50, 0, null, null),
  (3, 1, 'b', 70, 6, 10, null),
  (4, 1, 'a', 120, 3, 9, null), (4, 2, 'a', 120, 3, 9, null), (4, 3, 'b', 65, 8, null, 1),
  (5, 1, 'a', 90, 5, 8, null),
  (7, 1, 'a', 200, 5, 10, null),
  (8, 1, 'a', 300, 10, 10, null)
) s(n, ord, ex, kg, reps, rpe, rir);

-- ---------- 1. parity with fitnessScore() ----------
select is((select score from public.fitness_score_of('6c000000-0000-0000-0000-00000000000a')), 33,
  'parity: the fixture scores 33, as fitnessScore() does');
select is((select band from public.fitness_score_of('6c000000-0000-0000-0000-00000000000a')), 'getting_started',
  'parity: same band');
select is((select completed_workouts from public.fitness_score_of('6c000000-0000-0000-0000-00000000000a')), 6,
  'parity: 6 workouts — the unfinished one and the one 35 days ago are out');
select is((select active_days from public.fitness_score_of('6c000000-0000-0000-0000-00000000000a')), 5,
  'parity: two sessions on one day are one active day');
select is((select total_volume from public.fitness_score_of('6c000000-0000-0000-0000-00000000000a')), 5930::double precision,
  'parity: 5930 kg, per-session rounded');
select is((select round(average_training_load * 6)::int from public.fitness_score_of('6c000000-0000-0000-0000-00000000000a')), 143,
  'parity: the six session loads sum to 143');

-- ---------- 2. publishing takes no number ----------
select pg_temp.authenticate_as('6c000000-0000-0000-0000-00000000000a');
select is((select score from public.my_fitness_score()), 33, 'the owner reads their own real score');
select throws_ok($$ select public.set_public_fitness_score(100) $$, '42883', null,
  'there is no longer any argument through which to send a score');
select throws_ok($$ select public.fitness_score_of('6c000000-0000-0000-0000-000000000005') $$, '42501', null,
  'the engine function cannot be asked about anybody');
select throws_ok($$ update public.users set fitness_score_public = 100 where id = '6c000000-0000-0000-0000-00000000000a' $$,
  '42501', null, 'the published score cannot be PATCHed');
select is((select public.set_public_fitness_score()), 33, 'publishing stores the real score');
select is((select fitness_score from public.social_profile('6c000000-0000-0000-0000-00000000000a')), 33,
  'the profile shows the real score');

-- ---------- 3. sharing ignores whatever the browser sent ----------
select lives_ok($$
  insert into public.social_posts (id, user_id, type, payload, visibility)
  values ('6cb00000-0000-0000-0000-000000000001', '6c000000-0000-0000-0000-00000000000a', 'fitness_score',
          '{"kind":"fitness_score","score":100,"milestone":100,"band":"strong_activity","extra":"x"}', 'public')
$$, 'the existing share still works');
select is((select (payload ->> 'score')::int from public.social_posts where id = '6cb00000-0000-0000-0000-000000000001'), 33,
  'a fake score of 100 is replaced by the real 33');
select is((select (payload ->> 'milestone')::int from public.social_posts where id = '6cb00000-0000-0000-0000-000000000001'), 25,
  'the milestone is derived from the real score, not the one sent');
select is((select payload ->> 'band' from public.social_posts where id = '6cb00000-0000-0000-0000-000000000001'), 'getting_started',
  'the band is the real one');
select is((select payload ? 'extra' from public.social_posts where id = '6cb00000-0000-0000-0000-000000000001'), false,
  'keys the formula does not produce are dropped');
select throws_ok($$
  insert into public.social_posts (user_id, type, payload, visibility)
  values ('6c000000-0000-0000-0000-00000000000a', 'fitness_score', '{"kind":"fitness_score","score":90,"milestone":90}', 'public')
$$, '23505', null, 'the real milestone is shared once, whatever milestone is claimed');

-- ---------- 4. nobody publishes someone else's score ----------
select pg_temp.authenticate_as('6c000000-0000-0000-0000-000000000005');
select throws_ok($$
  insert into public.social_posts (user_id, type, payload, visibility)
  values ('6c000000-0000-0000-0000-00000000000a', 'fitness_score', '{"kind":"fitness_score","score":33,"milestone":25}', 'public')
$$, '42501', null, 'a stranger cannot post a score as the owner');
select throws_ok($$ select public.set_public_fitness_score() $$, '22023', null,
  'a stranger with no sessions has no score to publish');
select is((select score from public.my_fitness_score()), null,
  'my_fitness_score() answers only about the caller — never the owner');
select throws_ok($$
  insert into public.social_posts (user_id, type, payload, visibility)
  values ('6c000000-0000-0000-0000-000000000005', 'fitness_score', '{"kind":"fitness_score","score":100,"milestone":100}', 'public')
$$, '22023', null, 'a stranger cannot share a score they have not earned by claiming 100');

-- ---------- 5. editing a post ----------
select pg_temp.authenticate_as('6c000000-0000-0000-0000-00000000000a');
insert into public.social_posts (id, user_id, type, text, visibility) values
  ('6cb00000-0000-0000-0000-000000000002', '6c000000-0000-0000-0000-00000000000a', 'text', 'first draft', 'public'),
  ('6cb00000-0000-0000-0000-000000000003', '6c000000-0000-0000-0000-00000000000a', 'text', 'untouched', 'public');

select is(pg_temp.rows_touched($$update public.social_posts set text = 'second draft'
                                  where id = '6cb00000-0000-0000-0000-000000000002'$$), 1,
  'the author edits their own caption');
select isnt((select edited_at from public.social_posts where id = '6cb00000-0000-0000-0000-000000000002'), null,
  'the edit is stamped by the database');
update public.social_posts set visibility = 'followers' where id = '6cb00000-0000-0000-0000-000000000003';
select is((select edited_at from public.social_posts where id = '6cb00000-0000-0000-0000-000000000003'), null,
  'changing who sees a post is not an edit of what it says');
select throws_ok($$ update public.social_posts set text = repeat('x', 501) where id = '6cb00000-0000-0000-0000-000000000002' $$,
  '23514', null, 'an edit is held to the same 500-character limit');
select throws_ok($$ update public.social_posts set user_id = '6c000000-0000-0000-0000-000000000005' where id = '6cb00000-0000-0000-0000-000000000002' $$,
  '42501', null, 'an edit cannot change the author');
select throws_ok($$ update public.social_posts set created_at = now() - interval '1 year' where id = '6cb00000-0000-0000-0000-000000000002' $$,
  '42501', null, 'an edit cannot backdate a post');

select pg_temp.authenticate_as('6c000000-0000-0000-0000-000000000005');
select is(pg_temp.rows_touched($$update public.social_posts set text = 'hijacked'
                                  where id = '6cb00000-0000-0000-0000-000000000002'$$), 0,
  'nobody else can edit it');
select isnt((select edited_at from public.social_post('6cb00000-0000-0000-0000-000000000002')), null,
  'readers see that the post was edited');

select * from finish();
rollback;
