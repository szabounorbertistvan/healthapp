-- pgTAP · advanced achievements: the catalog's rules, the facts behind them,
-- awarding (several at once, never twice, never by hand), historical backfill
-- without notifications, the owner's progress, sharing and profile privacy.
--
-- Run with a local stack up:  npm run db:test
-- Or without Docker:          npm run db:test:offline

begin;
create extension if not exists pgtap with schema extensions;
select plan(60);

create or replace function pg_temp.authenticate_as(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$fn$;

create or replace function pg_temp.notes(p_user uuid)
returns int language sql stable security definer as $fn$
  select count(*)::int from public.notifications where user_id = p_user and category::text = 'badge_earned';
$fn$;
create or replace function pg_temp.has_badge(p_user uuid, p_slug text)
returns boolean language sql stable security definer as $fn$
  select exists (select 1 from public.user_badges ub join public.badges b on b.id = ub.badge_id
                 where ub.user_id = p_user and b.slug = p_slug);
$fn$;
create or replace function pg_temp.badge_count(p_user uuid)
returns int language sql stable security definer as $fn$
  select count(*)::int from public.user_badges where user_id = p_user;
$fn$;
create or replace function pg_temp.fact(p_user uuid, p_metric text)
returns numeric language sql stable security definer as $fn$
  select (public.achievement_facts(p_user, array[p_metric]) ->> p_metric)::numeric;
$fn$;

-- ---------- people ----------
-- LIFTER trains heavy. EATER logs food and finishes challenges. VETERAN has a
-- long history from before this migration. STRANGER has nothing.
insert into auth.users (id, email, raw_user_meta_data) values
  ('ac000000-0000-0000-0000-00000000000a', 'lifter@ach.test',   '{"full_name":"Lifter","username":"lifterach"}'),
  ('ac000000-0000-0000-0000-00000000000b', 'eater@ach.test',    '{"full_name":"Eater","username":"eaterach"}'),
  ('ac000000-0000-0000-0000-00000000000d', 'veteran@ach.test',  '{"full_name":"Veteran","username":"veteranach"}'),
  ('ac000000-0000-0000-0000-000000000005', 'stranger@ach.test', '{"full_name":"Stranger","username":"strangerach"}');

-- The canonical lifts are library rows; the seed may or may not have loaded them.
insert into public.exercises (source, external_id, name_en) values
  ('free-exercise-db', 'Barbell_Bench_Press_-_Medium_Grip', 'Barbell Bench Press - Medium Grip'),
  ('free-exercise-db', 'Barbell_Squat', 'Barbell Squat'),
  ('free-exercise-db', 'Barbell_Deadlift', 'Barbell Deadlift')
on conflict (source, external_id) do nothing;
insert into public.exercises (id, source, external_id, name_en) values
  ('ace00000-0000-0000-0000-000000000001', 'custom', 'ach-bench', 'Bench press (my own)');

create or replace function pg_temp.lib(p_external text)
returns uuid language sql stable as $fn$
  select id from public.exercises where source = 'free-exercise-db' and external_id = p_external;
$fn$;

delete from public.notifications;

-- ---------- 1. the catalog carries its rules ----------
select is((select count(*)::int from public.badges where active), 34, 'the catalog has 34 active badges');
select is(
  (select string_agg(slug || ':' || metric || ':' || target::text, ',' order by slug) from public.badges
   where slug in ('bench-100', 'squat-140', 'deadlift-180', 'e1rm-total-1000', 'volume-1m', 'active-days-365',
                  'nutrition-days-100', 'challenges-25', 'workouts-1000', 'prs-100', 'nutrition-week', 'streak-7')),
  'active-days-365:active_days:365,bench-100:bench_kg:100,challenges-25:challenges:25,deadlift-180:deadlift_kg:180,'
  || 'e1rm-total-1000:e1rm_total_kg:1000,nutrition-days-100:nutrition_days:100,nutrition-week:longest_food_run:7,'
  || 'prs-100:prs:100,squat-140:squat_kg:140,streak-7:longest_streak:7,volume-1m:volume_kg:1000000,workouts-1000:workouts:1000',
  'metrics and targets match the TypeScript mirror');
select is((select string_agg(distinct category, ',' order by category) from public.badges),
  'challenges,consistency,nutrition,progress,strength,volume,workouts',
  'only categories with real logic exist');
select is((select count(*)::int from public.badges where kind = 'standard'), 12,
  'the twelve original badges are standard, unchanged in slug');
select throws_ok($$ update public.badges set target = 0 where slug = 'bench-100' $$,
  '23514', null, 'a badge target must be positive');

-- ---------- 2. strength: weight lifted, not an estimate ----------
insert into public.logged_sessions (id, user_id, client_generated_id, started_at, completed_at) values
  ('ac500000-0000-0000-0000-000000000001', 'ac000000-0000-0000-0000-00000000000a',
   'ac500000-0000-0000-0000-000000000001', now() - interval '3 hours', null);
insert into public.logged_sets (session_id, user_id, exercise_id, client_generated_id, set_index, reps, weight_kg) values
  ('ac500000-0000-0000-0000-000000000001', 'ac000000-0000-0000-0000-00000000000a',
   pg_temp.lib('Barbell_Bench_Press_-_Medium_Grip'), gen_random_uuid(), 1, 3, 97.5),
  ('ac500000-0000-0000-0000-000000000001', 'ac000000-0000-0000-0000-00000000000a',
   'ace00000-0000-0000-0000-000000000001', gen_random_uuid(), 2, 1, 150);

select is(pg_temp.fact('ac000000-0000-0000-0000-00000000000a', 'bench_kg'), 0::numeric,
  'an unfinished session lifts nothing yet');
update public.logged_sessions set completed_at = now() - interval '2 hours'
where id = 'ac500000-0000-0000-0000-000000000001';

select is(pg_temp.fact('ac000000-0000-0000-0000-00000000000a', 'bench_kg'), 97.5::numeric,
  'bench_kg is the heaviest weight lifted on the library lift — the custom exercise does not count');
select is(pg_temp.fact('ac000000-0000-0000-0000-00000000000a', 'e1rm_total_kg'), 107.25::numeric,
  'e1rm_total_kg uses relevantOneRm: 97.5 × (1 + 3/30) = 107.25');
select is(pg_temp.has_badge('ac000000-0000-0000-0000-00000000000a', 'bench-100'), false,
  'an estimated 107 kg is not a 100 kg bench press');
select is(pg_temp.has_badge('ac000000-0000-0000-0000-00000000000a', 'first-workout'), true,
  'the first completed workout still awards first-workout');
select is(pg_temp.notes('ac000000-0000-0000-0000-00000000000a'), 1, 'one badge, one notification');

-- ---------- 3. several milestones in one event ----------
insert into public.logged_sessions (id, user_id, client_generated_id, started_at, completed_at) values
  ('ac500000-0000-0000-0000-000000000002', 'ac000000-0000-0000-0000-00000000000a',
   'ac500000-0000-0000-0000-000000000002', now() - interval '90 minutes', null);
insert into public.logged_sets (session_id, user_id, exercise_id, client_generated_id, set_index, reps, weight_kg) values
  ('ac500000-0000-0000-0000-000000000002', 'ac000000-0000-0000-0000-00000000000a',
   pg_temp.lib('Barbell_Bench_Press_-_Medium_Grip'), gen_random_uuid(), 1, 1, 100),
  ('ac500000-0000-0000-0000-000000000002', 'ac000000-0000-0000-0000-00000000000a',
   pg_temp.lib('Barbell_Squat'), gen_random_uuid(), 2, 1, 400),
  ('ac500000-0000-0000-0000-000000000002', 'ac000000-0000-0000-0000-00000000000a',
   pg_temp.lib('Barbell_Deadlift'), gen_random_uuid(), 3, 1, 500);
update public.logged_sessions set completed_at = now() - interval '1 hour'
where id = 'ac500000-0000-0000-0000-000000000002';

select ok(pg_temp.has_badge('ac000000-0000-0000-0000-00000000000a', 'bench-100')
      and pg_temp.has_badge('ac000000-0000-0000-0000-00000000000a', 'squat-140')
      and pg_temp.has_badge('ac000000-0000-0000-0000-00000000000a', 'deadlift-180'),
  'one completed workout awards every lift milestone it reached');
select is(pg_temp.fact('ac000000-0000-0000-0000-00000000000a', 'e1rm_total_kg'), 1007.25::numeric,
  'the estimated total is the sum of each lift''s best estimate (107.25 + 400 + 500)');
select is(pg_temp.has_badge('ac000000-0000-0000-0000-00000000000a', 'e1rm-total-1000'), true,
  'the 1,000 kg estimated total is awarded in the same event');
select is(pg_temp.notes('ac000000-0000-0000-0000-00000000000a'), 5,
  'four new badges, four new notifications — none for the one already held');
select is((select count(*)::int from public.notifications
           where user_id = 'ac000000-0000-0000-0000-00000000000a' and payload ->> 'badge_slug' = 'bench-100'
             and payload ->> 'rarity' = 'epic'), 1,
  'the notification names the badge and carries its rarity');

-- ---------- 4. never twice ----------
update public.logged_sessions set completed_at = now() - interval '30 minutes'
where id = 'ac500000-0000-0000-0000-000000000002';
select is(pg_temp.notes('ac000000-0000-0000-0000-00000000000a'), 5, 'a re-completed session re-awards nothing');
select is((select count(*)::int from public.award_badges_for('ac000000-0000-0000-0000-00000000000a', true)), 0,
  'a retried award run inserts nothing');
select is(pg_temp.notes('ac000000-0000-0000-0000-00000000000a'), 5, 'and notifies nothing');

-- ---------- 5. PRs, and a retired badge ----------
update public.badges set active = false where slug = 'prs-25';
insert into public.logged_sessions (id, user_id, client_generated_id, started_at, completed_at) values
  ('ac500000-0000-0000-0000-000000000003', 'ac000000-0000-0000-0000-00000000000a',
   'ac500000-0000-0000-0000-000000000003', now() - interval '40 minutes', null);
insert into public.logged_sets (session_id, user_id, exercise_id, client_generated_id, set_index, reps, weight_kg, is_pr)
select 'ac500000-0000-0000-0000-000000000003', 'ac000000-0000-0000-0000-00000000000a',
       'ace00000-0000-0000-0000-000000000001', gen_random_uuid(), i, 5, 50 + i, true
from generate_series(1, 25) i;
update public.logged_sessions set completed_at = now() - interval '10 minutes'
where id = 'ac500000-0000-0000-0000-000000000003';
select ok(pg_temp.has_badge('ac000000-0000-0000-0000-00000000000a', 'prs-10')
      and not pg_temp.has_badge('ac000000-0000-0000-0000-00000000000a', 'prs-50'),
  '25 PRs award prs-10 but not prs-50');
select is(pg_temp.has_badge('ac000000-0000-0000-0000-00000000000a', 'prs-25'), false,
  'an inactive badge is never awarded');
select is(pg_temp.notes('ac000000-0000-0000-0000-00000000000a'), 7, 'first-pr and prs-10 notified once each');

-- ---------- 6. the owner's progress ----------
update public.badges set active = true where slug = 'prs-25';
select pg_temp.authenticate_as('ac000000-0000-0000-0000-00000000000a');
select is((select count(*)::int from public.achievement_progress()), 34, 'the owner sees the whole active catalog');
select is((select current_value from public.achievement_progress() where slug = 'workouts-100'), 3::numeric,
  'workouts-100: current is the real count of completed workouts');
select is((select target from public.achievement_progress() where slug = 'workouts-100'), 100::numeric,
  'workouts-100: target 100');
select is((select awarded_at is null from public.achievement_progress() where slug = 'workouts-100'), true,
  'workouts-100 is not earned');
select is((select awarded_at is not null from public.achievement_progress() where slug = 'bench-100'), true,
  'bench-100 carries its earned date');
select is((select awarded_at is not null from public.achievement_progress() where slug = 'prs-25'), true,
  'a badge reactivated after its facts were met is awarded when progress is read');
reset role;
select is(pg_temp.notes('ac000000-0000-0000-0000-00000000000a'), 8,
  'that late award notified once — five reads above, one notification');

-- ---------- 7. nothing can be claimed ----------
select pg_temp.authenticate_as('ac000000-0000-0000-0000-00000000000a');
select throws_ok($$
  insert into public.user_badges (user_id, badge_id)
  select auth.uid(), id from public.badges where slug = 'workouts-1000'
$$, '42501', null, 'a user cannot insert a badge');
select throws_ok($$ update public.user_badges set awarded_at = now() - interval '5 years' where user_id = auth.uid() $$,
  '42501', null, 'a user cannot change an earned date');
select throws_ok($$ delete from public.user_badges where user_id = auth.uid() $$,
  '42501', null, 'a user cannot delete their badges');
select throws_ok($$ update public.badges set target = 1 where slug = 'workouts-1000' $$,
  '42501', null, 'a user cannot lower a badge''s target');
select throws_ok($$ select public.achievement_facts(auth.uid(), null) $$,
  '42501', null, 'the facts are not callable by users');
select throws_ok($$ select public.award_badges_for(auth.uid(), true, null) $$,
  '42501', null, 'the award engine is not callable by users');
select throws_ok($$ select public.award_badges_from_facts(auth.uid(), '{"workouts": 1000}'::jsonb, false) $$,
  '42501', null, 'nobody can hand the award engine their own facts');

-- ---------- 8. sharing ----------
select lives_ok($$
  insert into public.social_posts (user_id, type, payload, visibility)
  values (auth.uid(), 'achievement',
          '{"kind":"achievement","badge_slug":"bench-100","name_en":"World record","rarity":"common","target":1}', 'public')
$$, 'an earned advanced badge can be shared');
select is((select payload ->> 'rarity' from public.social_posts
           where user_id = auth.uid() and type = 'achievement' and payload ->> 'badge_slug' = 'bench-100'), 'epic',
  'the snapshot''s rarity comes from the catalog, not the browser');
select is((select (payload ->> 'target')::numeric from public.social_posts
           where user_id = auth.uid() and type = 'achievement' and payload ->> 'badge_slug' = 'bench-100'), 100::numeric,
  'the snapshot freezes the badge''s rule');
select is((select payload ->> 'name_en' from public.social_posts
           where user_id = auth.uid() and type = 'achievement' and payload ->> 'badge_slug' = 'bench-100'), 'Bench press 100 kg',
  'the forged name is thrown away');
select throws_ok($$
  insert into public.social_posts (user_id, type, payload, visibility)
  values (auth.uid(), 'achievement', '{"kind":"achievement","badge_slug":"workouts-1000"}', 'public')
$$, '42501', null, 'a badge the author does not hold cannot be shared');
select is((select shared from public.achievement_progress() where slug = 'bench-100'), true,
  'progress tells the owner which badges they already shared');

-- ---------- 9. profile privacy ----------
select is((select rarity from public.social_badges(auth.uid()) where slug = 'bench-100'), 'epic',
  'the profile shelf carries rarity');
update public.users set stats_visibility = 'private' where id = auth.uid();
select pg_temp.authenticate_as('ac000000-0000-0000-0000-000000000005');
select is((select count(*)::int from public.social_badges('ac000000-0000-0000-0000-00000000000a')), 0,
  'private stats: a stranger sees no badges');
select is((select count(*)::int from public.achievement_progress() where awarded_at is not null), 0,
  'progress answers for the caller only — the stranger has earned nothing');
select is((select current_value from public.achievement_progress() where slug = 'bench-100'), 0::numeric,
  'insufficient data: no lift is zero, not someone else''s number');
select is((select sum(current_value) from public.achievement_progress()), 0::numeric,
  'a person with no rows has zero on every metric');
reset role;

-- ---------- 10. nutrition, active days (statement trigger) ----------
insert into public.food_logs (user_id, date, slot, food_name, grams, kcal, client_generated_id)
select 'ac000000-0000-0000-0000-00000000000b', current_date - i, 'lunch', 'Rice', 100, 130, gen_random_uuid()
from generate_series(0, 29) i;
select ok(pg_temp.has_badge('ac000000-0000-0000-0000-00000000000b', 'nutrition-days-30')
      and pg_temp.has_badge('ac000000-0000-0000-0000-00000000000b', 'nutrition-week')
      and pg_temp.has_badge('ac000000-0000-0000-0000-00000000000b', 'active-days-30'),
  '30 days of food in one insert award nutrition-days-30, nutrition-week and active-days-30');
select is(pg_temp.notes('ac000000-0000-0000-0000-00000000000b'), 3, 'three badges, three notifications, one statement');
insert into public.food_logs (user_id, date, slot, food_name, grams, kcal, client_generated_id) values
  ('ac000000-0000-0000-0000-00000000000b', current_date - 40, 'snack', 'Water', 250, 0, gen_random_uuid());
select is(pg_temp.fact('ac000000-0000-0000-0000-00000000000b', 'nutrition_days'), 30::numeric,
  'a day with 0 kcal is not a nutrition day');
select is(pg_temp.fact('ac000000-0000-0000-0000-00000000000b', 'active_days'), 31::numeric,
  'but it is an active day');

-- ---------- 11. challenges ----------
insert into public.challenges (id, title_en, title_ro, type, target_value, start_date, end_date, visibility, creator_id)
select ('acc00000-0000-0000-0000-00000000000' || i)::uuid, 'C' || i, 'C' || i, 'workouts', 1,
       current_date - 10, current_date + 10, 'public', null
from generate_series(1, 5) i;
insert into public.challenge_participants (challenge_id, user_id)
select ('acc00000-0000-0000-0000-00000000000' || i)::uuid, 'ac000000-0000-0000-0000-00000000000b'
from generate_series(1, 5) i;
update public.challenge_participants set completed_at = now()
where user_id = 'ac000000-0000-0000-0000-00000000000b';
select ok(pg_temp.has_badge('ac000000-0000-0000-0000-00000000000b', 'first-challenge')
      and pg_temp.has_badge('ac000000-0000-0000-0000-00000000000b', 'challenges-5')
      and not pg_temp.has_badge('ac000000-0000-0000-0000-00000000000b', 'challenges-10'),
  'five completed challenges award first-challenge and challenges-5, not challenges-10');
select is(pg_temp.notes('ac000000-0000-0000-0000-00000000000b'), 5, 'each challenge badge notified once');

-- ---------- 12. history: awarded, never announced ----------
alter table public.logged_sessions disable trigger logged_sessions_award_badges;
insert into public.logged_sessions (id, user_id, client_generated_id, started_at, completed_at)
select ('ac600000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid, 'ac000000-0000-0000-0000-00000000000d',
       gen_random_uuid(), now() - make_interval(days => i), now() - make_interval(days => i) + interval '1 hour'
from generate_series(1, 250) i;
insert into public.logged_sets (session_id, user_id, exercise_id, client_generated_id, set_index, reps, weight_kg)
select ('ac600000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid, 'ac000000-0000-0000-0000-00000000000d',
       'ace00000-0000-0000-0000-000000000001', gen_random_uuid(), 1, 200, 50
from generate_series(1, 250) i;
alter table public.logged_sessions enable trigger logged_sessions_award_badges;

select is(pg_temp.badge_count('ac000000-0000-0000-0000-00000000000d'), 0, 'history written before the engine holds no badges');
select ok((select count(*) from public.award_badges_for('ac000000-0000-0000-0000-00000000000d', false)) > 0,
  'the backfill awards what the history earned');
select ok(pg_temp.has_badge('ac000000-0000-0000-0000-00000000000d', 'workouts-250')
      and pg_temp.has_badge('ac000000-0000-0000-0000-00000000000d', 'volume-1m')
      and pg_temp.has_badge('ac000000-0000-0000-0000-00000000000d', 'active-days-180')
      and pg_temp.has_badge('ac000000-0000-0000-0000-00000000000d', 'streak-100'),
  '250 sessions of 10,000 kg: 250 workouts, 2.5 M kg, 250 active days, a 250-day streak');
select ok(not pg_temp.has_badge('ac000000-0000-0000-0000-00000000000d', 'workouts-500')
      and not pg_temp.has_badge('ac000000-0000-0000-0000-00000000000d', 'active-days-365'),
  'and nothing the history did not reach');
select is(pg_temp.notes('ac000000-0000-0000-0000-00000000000d'), 0, 'the backfill notifies nobody');

select pg_temp.authenticate_as('ac000000-0000-0000-0000-00000000000d');
select is((select current_value from public.achievement_progress() where slug = 'workouts-500'), 250::numeric,
  'progress toward the next workout milestone reads 250 / 500');
reset role;
select is(pg_temp.notes('ac000000-0000-0000-0000-00000000000d'), 0,
  'reading progress after a backfill announces nothing old');

select * from finish();
rollback;
