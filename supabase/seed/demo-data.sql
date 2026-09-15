-- HealthApp / Voinic · two weeks of demo data for the test accounts
--
-- Paste into the Supabase dashboard → SQL Editor → Run (it connects as
-- `postgres`, which is what this needs: engine tables — adherence snapshots,
-- notifications — have no insert policy, and `users.role` / `trainer_clients`
-- are service-role writes by design).
--
-- Requires: supabase/seed/accounts.sql (admin + trainer + client), the
-- exercise library (supabase/seed/exercises.sql) and the curated foods
-- (supabase/seed/foods.sql). It fails loudly if any of the three is missing.
--
-- What it creates, all relative to the day it runs (`current_date`):
--
--   coach  trainer@healthapp.test  Andrei Trainer   → Maria, Ioana, Radu
--   coach  trainer2@healthapp.test Cristina Vlad    → Alex
--   client client@healthapp.test   Maria Client     on track    (4 sessions/wk)
--   client client2@healthapp.test  Ioana Marin      needs att.  (2-3/wk, gaps)
--   client client3@healthapp.test  Radu Pop         at risk     (nothing for a week)
--   client client4@healthapp.test  Alex Dinu        on track, other coach
--
-- and, per client: a published program (RIR / RPE / simple, one per intensity
-- mode), a published nutrition plan with meals, habits, and 14 days of history
-- — logged sessions + sets with week-over-week progression and PRs, food logs
-- snapshotted off the plan, habit ticks, measurements, check-ins, the coach
-- conversation, feedback, notifications, badges, challenge entries, social
-- posts — then the real adherence engine over the last three weeks.
--
-- New accounts share the existing test password: HealthApp!Dev2026
--
-- SAFE TO RE-RUN, and that is the point: it deletes every row it owns for
-- these six accounts first, so a re-run resets them to a known state. It does
-- NOT touch programs it did not create (Maria's hand-made e2e programs stay).
--
-- No session is seeded for today: the Today screen is meant to show a workout
-- still to do.

set search_path = public, extensions;  -- pgcrypto lives in one of these

-- ---------------------------------------------------------------- 0. helpers
-- Every generated row gets a deterministic id, so a re-run overwrites its own
-- rows instead of duplicating them — and the purge below can be exact.
create or replace function pg_temp.sid(p text) returns uuid
  language sql immutable as $$ select md5('voinic-seed:' || p)::uuid $$;

-- 1 ± spread, stable for a given key: grams and weights that differ per day
-- without a random() that would change on every run.
create or replace function pg_temp.jit(p text, spread numeric) returns numeric
  language sql immutable as $$
    select 1 + spread * (((((hashtext(p) % 201) + 201) % 201) - 100) / 100.0);
  $$;

-- stable 0..n-1
create or replace function pg_temp.pick(p text, n int) returns int
  language sql immutable as $$ select ((hashtext(p) % n) + n) % n; $$;

do $$
begin
  if not exists (select 1 from public.users where role = 'coach') then
    raise exception 'No coach account: run supabase/seed/accounts.sql first';
  end if;
  if not exists (select 1 from public.exercises where external_id = 'Barbell_Squat') then
    raise exception 'Exercise library missing: run supabase/seed/exercises.sql first';
  end if;
  if not exists (select 1 from public.foods where external_id = 'curated:oats') then
    raise exception 'Curated foods missing: run supabase/seed/foods.sql first';
  end if;
end $$;

-- --------------------------------------------------------- 1. who gets seeded
drop table if exists seed_person;
create temp table seed_person (
  email        text primary key,
  full_name    text not null,
  username     text not null,
  sex          text,
  birth_year   int,
  role         user_role not null,
  coach_email  text,                      -- null for the coaches themselves
  tier         text not null default 'free',
  program_name text,
  intensity    intensity_mode,
  plan_name    text,
  kcal         int,
  prot         int,
  carb         int,
  fat          int,
  train_dows   int[]  not null default '{}',  -- 0=Sun .. 6=Sat
  skip_offsets int[]  not null default '{}',  -- days ago with no session anyway
  food_offsets int[]  not null default '{}',  -- days ago with food logs
  skip_slots   text[] not null default '{}',  -- meal slots this client never logs
  quiet_before int    not null default 0,     -- went quiet this many days ago
  habit_rate   int    not null default 0,     -- % of scheduled habit days ticked
  weight_start numeric(5,2),                  -- weight 13 days ago
  weight_drift numeric(5,3)                   -- kg per day
);

insert into seed_person (email, full_name, username, sex, birth_year, role, coach_email, tier,
  program_name, intensity, plan_name, kcal, prot, carb, fat,
  train_dows, skip_offsets, food_offsets, skip_slots, quiet_before, habit_rate,
  weight_start, weight_drift) values
  ('trainer@healthapp.test',  'Andrei Trainer', 'Andrei',  'male',   2003, 'coach', null, 'coach_pro',
   null, null, null, null, null, null, null, '{}', '{}', '{}', '{}', 0, 0, null, null),
  ('trainer2@healthapp.test', 'Cristina Vlad',  'cristina','female', 1991, 'coach', null, 'coach_pro',
   null, null, null, null, null, null, null, '{}', '{}', '{}', '{}', 0, 0, null, null),

  -- on track: trains four times a week, logs food almost every day
  ('client@healthapp.test',  'Maria Client', 'Maria1', 'female', 2002, 'client', 'trainer@healthapp.test', 'premium',
   'Hipertrofie · Upper/Lower', 'rir', 'Recompoziție · 1900 kcal', 1900, 150, 180, 60,
   '{1,3,5,6}', '{}', '{0,1,2,3,4,5,7,8,9,10,11,12,13}', '{}', 0, 85, 62.40, -0.055),

  -- needs attention: misses sessions, logs food every other day, no snacks
  ('client2@healthapp.test', 'Ioana Marin', 'ioana', 'female', 1995, 'client', 'trainer@healthapp.test', 'free',
   'Full body 3x', 'rpe', 'Slăbire lină · 1750 kcal', 1750, 130, 165, 58,
   '{1,3,5}', '{1,8,12}', '{0,2,4,6,8,10,12}', '{snack}', 0, 55, 71.20, -0.030),

  -- at risk: quiet for nine days — the inactivity override, not just a low score
  ('client3@healthapp.test', 'Radu Pop', 'radupop', 'male', 1988, 'client', 'trainer@healthapp.test', 'free',
   'Început · Full body', 'simple', 'Start · 2200 kcal', 2200, 150, 220, 70,
   '{2,4,6}', '{}', '{9,11,13}', '{snack,dinner}', 9, 20, 94.50, 0.010),

  -- the other coach's client: proves a coach sees only their own roster
  ('client4@healthapp.test', 'Alex Dinu', 'alexd', 'male', 1993, 'client', 'trainer2@healthapp.test', 'premium',
   'Forță · Push/Pull/Legs', 'rir', 'Masă · 2900 kcal', 2900, 190, 330, 85,
   '{1,4,6}', '{12}', '{0,1,2,3,5,7,8,9,10,12,13}', '{}', 0, 70, 80.00, -0.040);

-- -------------------------------------------------- 2. the training templates
-- One row per training day of a client's week. day_index is the weekday
-- (0=Sun), which is what the session generator below matches a date against.
drop table if exists seed_day;
create temp table seed_day (
  email     text not null,
  day_index int  not null,
  name      text not null,
  muscles   text[] not null,
  primary key (email, day_index)
);

insert into seed_day (email, day_index, name, muscles) values
  ('client@healthapp.test',  1, 'Upper A', '{chest,lats,shoulders,triceps,biceps}'),
  ('client@healthapp.test',  3, 'Lower A', '{quadriceps,hamstrings,glutes}'),
  ('client@healthapp.test',  5, 'Upper B', '{chest,lats,shoulders,triceps,biceps}'),
  ('client@healthapp.test',  6, 'Lower B', '{hamstrings,glutes,quadriceps,abdominals}'),
  ('client2@healthapp.test', 1, 'Full body A', '{quadriceps,chest,"middle back",abdominals}'),
  ('client2@healthapp.test', 3, 'Full body B', '{hamstrings,shoulders,lats,abdominals}'),
  ('client2@healthapp.test', 5, 'Full body C', '{quadriceps,chest,shoulders,biceps}'),
  ('client3@healthapp.test', 2, 'Full body A', '{quadriceps,chest,"middle back",abdominals}'),
  ('client3@healthapp.test', 4, 'Full body B', '{quadriceps,shoulders,hamstrings,abdominals}'),
  ('client3@healthapp.test', 6, 'Full body C', '{chest,lats,quadriceps,abdominals}'),
  ('client4@healthapp.test', 1, 'Push', '{chest,shoulders,triceps}'),
  ('client4@healthapp.test', 4, 'Pull', '{"lower back",lats,biceps}'),
  ('client4@healthapp.test', 6, 'Legs', '{quadriceps,hamstrings,glutes}');

-- The exercises of each day. ext_id is exercises.external_id (Free Exercise DB),
-- target_rpe carries whatever the program's own scale is — RIR for RIR programs,
-- exactly as the builder writes it. weight null = bodyweight / timed.
drop table if exists seed_ex;
create temp table seed_ex (
  email      text not null,
  day_index  int  not null,
  position   int  not null,
  ext_id     text not null,
  sets       int  not null,
  reps_text  text not null,
  reps_base  int  not null,
  weight     numeric(6,2),
  target_rpe numeric(3,1),
  rest       int,
  circuit    smallint,
  notes      text,
  primary key (email, day_index, position)
);

insert into seed_ex (email, day_index, position, ext_id, sets, reps_text, reps_base, weight, target_rpe, rest, circuit, notes) values
  -- Maria · Upper A
  ('client@healthapp.test', 1, 0, 'Barbell_Bench_Press_-_Medium_Grip', 4, '6-8',   7,  40.0, 2, 150, null, 'Coboară controlat, 2 secunde.'),
  ('client@healthapp.test', 1, 1, 'Seated_Cable_Rows',                 4, '8-10',  9,  45.0, 2, 120, null, null),
  ('client@healthapp.test', 1, 2, 'Barbell_Shoulder_Press',            3, '8-10',  9,  25.0, 2, 120, null, null),
  ('client@healthapp.test', 1, 3, 'Face_Pull',                         3, '12-15',13,  20.0, 1,  60, 1,    'Superset cu flexiile.'),
  ('client@healthapp.test', 1, 4, 'Barbell_Curl',                      3, '10-12',11,  20.0, 1,  60, 1,    null),
  -- Maria · Lower A
  ('client@healthapp.test', 3, 0, 'Barbell_Squat',                     4, '6-8',   7,  55.0, 2, 180, null, 'Genunchii în linie cu vârfurile.'),
  ('client@healthapp.test', 3, 1, 'Romanian_Deadlift',                 3, '8-10',  9,  50.0, 2, 150, null, null),
  ('client@healthapp.test', 3, 2, 'Leg_Press',                         3, '10-12',11, 110.0, 2, 120, null, null),
  ('client@healthapp.test', 3, 3, 'Lying_Leg_Curls',                   3, '12',   12,  30.0, 1,  90, null, null),
  -- Maria · Upper B
  ('client@healthapp.test', 5, 0, 'Dumbbell_Bench_Press',              4, '8-10',  9,  18.0, 2, 120, null, 'Greutatea e per ganteră.'),
  ('client@healthapp.test', 5, 1, 'Pullups',                           4, '5-8',   6,  null, 2, 120, null, 'Cu elastic dacă e nevoie.'),
  ('client@healthapp.test', 5, 2, 'Full_Range-Of-Motion_Lat_Pulldown', 3, '10-12',11,  35.0, 2,  90, null, null),
  ('client@healthapp.test', 5, 3, 'Triceps_Pushdown',                  3, '12',   12,  25.0, 1,  60, 2,    null),
  ('client@healthapp.test', 5, 4, 'Hammer_Curls',                      3, '12',   12,  12.0, 1,  60, 2,    null),
  -- Maria · Lower B
  ('client@healthapp.test', 6, 0, 'Barbell_Deadlift',                  3, '5',     5,  70.0, 2, 180, null, 'Doar serii de calitate.'),
  ('client@healthapp.test', 6, 1, 'Barbell_Lunge',                     3, '10',   10,  30.0, 2, 120, null, null),
  ('client@healthapp.test', 6, 2, 'Leg_Extensions',                    3, '12-15',13,  35.0, 1,  90, null, null),
  ('client@healthapp.test', 6, 3, 'Plank',                             3, '45s',  45,  null, 1,  60, 3,    'Secunde, nu repetări.'),
  ('client@healthapp.test', 6, 4, 'Crunches',                          3, '15',   15,  null, 1,  60, 3,    null),

  -- Ioana · Full body A / B / C (RPE)
  ('client2@healthapp.test', 1, 0, 'Barbell_Squat',                    3, '8',     8,  35.0, 7, 150, null, null),
  ('client2@healthapp.test', 1, 1, 'Barbell_Bench_Press_-_Medium_Grip',3, '8',     8,  25.0, 7, 120, null, null),
  ('client2@healthapp.test', 1, 2, 'Seated_Cable_Rows',                3, '10',   10,  35.0, 8, 120, null, null),
  ('client2@healthapp.test', 1, 3, 'Plank',                            3, '40s',  40,  null, 7,  60, null, null),
  ('client2@healthapp.test', 3, 0, 'Romanian_Deadlift',                3, '8',     8,  40.0, 7, 150, null, null),
  ('client2@healthapp.test', 3, 1, 'Barbell_Shoulder_Press',           3, '10',   10,  17.5, 7, 120, null, null),
  ('client2@healthapp.test', 3, 2, 'Full_Range-Of-Motion_Lat_Pulldown',3, '10',   10,  30.0, 8, 120, null, null),
  ('client2@healthapp.test', 3, 3, 'Crunches',                         3, '15',   15,  null, 7,  60, null, null),
  ('client2@healthapp.test', 5, 0, 'Leg_Press',                        3, '12',   12,  80.0, 7, 120, null, null),
  ('client2@healthapp.test', 5, 1, 'Dumbbell_Bench_Press',             3, '10',   10,  12.0, 7, 120, null, null),
  ('client2@healthapp.test', 5, 2, 'Face_Pull',                        3, '15',   15,  15.0, 7,  60, null, null),
  ('client2@healthapp.test', 5, 3, 'Hammer_Curls',                     3, '12',   12,   8.0, 7,  60, null, null),

  -- Radu · beginner, simple effort (no RPE box at all)
  ('client3@healthapp.test', 2, 0, 'Leg_Press',                        3, '12',   12,  60.0, null, 120, null, 'Amplitudine completă.'),
  ('client3@healthapp.test', 2, 1, 'Dumbbell_Bench_Press',             3, '10',   10,  10.0, null, 120, null, null),
  ('client3@healthapp.test', 2, 2, 'Seated_Cable_Rows',                3, '12',   12,  30.0, null, 120, null, null),
  ('client3@healthapp.test', 2, 3, 'Plank',                            3, '30s',  30,  null, null,  60, null, null),
  ('client3@healthapp.test', 4, 0, 'Barbell_Squat',                    3, '8',     8,  30.0, null, 150, null, 'Bara goală + 10 kg.'),
  ('client3@healthapp.test', 4, 1, 'Barbell_Shoulder_Press',           3, '10',   10,  15.0, null, 120, null, null),
  ('client3@healthapp.test', 4, 2, 'Lying_Leg_Curls',                  3, '12',   12,  20.0, null,  90, null, null),
  ('client3@healthapp.test', 4, 3, 'Crunches',                         3, '15',   15,  null, null,  60, null, null),
  ('client3@healthapp.test', 6, 0, 'Dumbbell_Bench_Press',             3, '10',   10,  10.0, null, 120, null, null),
  ('client3@healthapp.test', 6, 1, 'Full_Range-Of-Motion_Lat_Pulldown',3, '12',   12,  25.0, null, 120, null, null),
  ('client3@healthapp.test', 6, 2, 'Leg_Press',                        3, '12',   12,  60.0, null, 120, null, null),
  ('client3@healthapp.test', 6, 3, 'Plank',                            3, '30s',  30,  null, null,  60, null, null),

  -- Alex · Push / Pull / Legs (RIR)
  ('client4@healthapp.test', 1, 0, 'Barbell_Bench_Press_-_Medium_Grip',4, '5',     5,  80.0, 2, 180, null, null),
  ('client4@healthapp.test', 1, 1, 'Barbell_Shoulder_Press',           3, '8',     8,  45.0, 2, 150, null, null),
  ('client4@healthapp.test', 1, 2, 'Triceps_Pushdown',                 3, '12',   12,  30.0, 1,  90, null, null),
  ('client4@healthapp.test', 4, 0, 'Barbell_Deadlift',                 3, '5',     5, 120.0, 2, 210, null, null),
  ('client4@healthapp.test', 4, 1, 'Pullups',                          4, '8',     8,  null, 2, 120, null, null),
  ('client4@healthapp.test', 4, 2, 'Barbell_Curl',                     3, '10',   10,  30.0, 1,  90, null, null),
  ('client4@healthapp.test', 6, 0, 'Barbell_Squat',                    4, '5',     5, 100.0, 2, 210, null, null),
  ('client4@healthapp.test', 6, 1, 'Romanian_Deadlift',                3, '8',     8,  80.0, 2, 150, null, null),
  ('client4@healthapp.test', 6, 2, 'Leg_Extensions',                   3, '15',   15,  45.0, 1,  90, null, null);

-- ------------------------------------------------------ 3. the meal template
-- One template for everyone; grams scale with the plan's kcal target (base is
-- Maria's 1900). Food logs are generated from the plan, so "planned vs logged"
-- lines up the way a real client's week does.
drop table if exists seed_meal;
create temp table seed_meal (
  slot       text not null,
  meal_name  text not null,
  meal_pos   int  not null,
  position   int  not null,
  ext_id     text not null,
  base_grams numeric(7,1) not null,
  primary key (slot, position)
);

insert into seed_meal (slot, meal_name, meal_pos, position, ext_id, base_grams) values
  ('breakfast', 'Mic dejun', 0, 0, 'curated:oats',           60),
  ('breakfast', 'Mic dejun', 0, 1, 'curated:milk-15',       200),
  ('breakfast', 'Mic dejun', 0, 2, 'curated:banana',        110),
  ('breakfast', 'Mic dejun', 0, 3, 'curated:whey',           25),
  ('lunch',     'Prânz',     1, 0, 'curated:chicken-breast',160),
  ('lunch',     'Prânz',     1, 1, 'curated:rice-cooked',   180),
  ('lunch',     'Prânz',     1, 2, 'curated:broccoli',      150),
  ('lunch',     'Prânz',     1, 3, 'curated:olive-oil',       8),
  ('snack',     'Gustare',   2, 0, 'curated:greek-yogurt',  170),
  ('snack',     'Gustare',   2, 1, 'curated:almonds',        15),
  ('snack',     'Gustare',   2, 2, 'curated:apple',         140),
  ('dinner',    'Cină',      3, 0, 'curated:salmon',        130),
  ('dinner',    'Cină',      3, 1, 'curated:potato',        200),
  ('dinner',    'Cină',      3, 2, 'curated:mixed-salad',   120);

-- ------------------------------------------- 4. accounts, profiles, roster
-- Same shape as supabase/seed/accounts.sql: a hand-made auth.users row needs a
-- matching auth.identities row or password sign-in silently fails. Existing
-- accounts get their password reset instead of duplicated.
do $$
declare
  v_password text := 'HealthApp!Dev2026';
  p record;
  v_id uuid;
begin
  for p in select * from seed_person loop
    select id into v_id from auth.users where email = p.email;

    if v_id is null then
      v_id := gen_random_uuid();
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change_token_new, email_change
      ) values (
        '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
        p.email, crypt(v_password, gen_salt('bf')), now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('full_name', p.full_name, 'username', p.username,
                           'sex', p.sex, 'birth_year', p.birth_year::text,
                           'role', p.role::text),
        now() - interval '70 days', now(), '', '', '', ''
      );
      insert into auth.identities (
        provider_id, user_id, identity_data, provider,
        last_sign_in_at, created_at, updated_at
      ) values (
        v_id::text, v_id,
        jsonb_build_object('sub', v_id::text, 'email', p.email,
                           'email_verified', true, 'phone_verified', false),
        'email', now(), now() - interval '70 days', now()
      );
    else
      update auth.users
         set encrypted_password = crypt(v_password, gen_salt('bf')),
             email_confirmed_at = coalesce(email_confirmed_at, now()),
             updated_at = now()
       where id = v_id;
    end if;

    -- handle_new_user() created the profile; make it say what this seed wants.
    -- username is only filled in when missing: an account that already picked
    -- one keeps it (Maria is 'Maria1' live, not 'maria').
    update public.users
       set role = p.role,
           full_name = p.full_name,
           username = coalesce(username, p.username),
           sex = coalesce(sex, p.sex),
           birth_year = coalesce(birth_year, p.birth_year),
           locale = 'ro',
           timezone = 'Europe/Bucharest',
           check_in_weekday = 1
     where id = v_id;

    insert into public.subscriptions (user_id, tier, status, provider, current_period_end)
    values (v_id, p.tier, 'active', 'manual',
            case when p.tier = 'free' then null else now() + interval '24 days' end)
    on conflict (user_id) do update
      set tier = excluded.tier, status = 'active',
          current_period_end = excluded.current_period_end;
  end loop;
end $$;

-- ids, once, for everything below
drop table if exists seed_id;
create temp table seed_id as
  select p.email, a.id
  from seed_person p join auth.users a on a.email = p.email;
alter table seed_id add primary key (email);

-- one active coach per client (the unique partial index enforces it), so an
-- existing active row is repointed rather than duplicated.
do $$
declare p record; v_client uuid; v_coach uuid;
begin
  for p in select * from seed_person where role = 'client' loop
    select id into v_client from seed_id where email = p.email;
    select id into v_coach  from seed_id where email = p.coach_email;

    if exists (select 1 from public.trainer_clients
               where client_id = v_client and status = 'active') then
      update public.trainer_clients
         set coach_id = v_coach,
             started_at = coalesce(started_at, now() - interval '60 days')
       where client_id = v_client and status = 'active';
    else
      insert into public.trainer_clients (id, coach_id, client_id, status, invited_at, started_at)
      values (pg_temp.sid('tc:' || p.email), v_coach, v_client, 'active',
              now() - interval '62 days', now() - interval '60 days');
    end if;

    insert into public.conversations (id, coach_id, client_id, created_at)
    values (pg_temp.sid('conv:' || p.email), v_coach, v_client, now() - interval '60 days')
    on conflict (coach_id, client_id) do nothing;
  end loop;
end $$;

-- ----------------------------------------------------------------- 5. purge
-- Everything this script owns, for these accounts only. Programs and plans go
-- by their deterministic ids, so hand-made ones (Maria's e2e programs) survive;
-- history (sessions, food, habits, measurements, check-ins) is wiped wholesale
-- — a re-run is meant to put these accounts back to a known state.
do $$
declare v_ids uuid[]; v_clients uuid[];
begin
  select array_agg(id) into v_ids from seed_id;
  select array_agg(s.id) into v_clients
    from seed_id s join seed_person p on p.email = s.email where p.role = 'client';

  delete from public.social_reactions      where user_id = any(v_ids);
  delete from public.social_comments       where user_id = any(v_ids);
  delete from public.social_posts          where user_id = any(v_ids);
  delete from public.social_follows        where follower_id = any(v_ids) or following_id = any(v_ids);
  delete from public.challenge_participants where user_id = any(v_ids);
  delete from public.user_badges           where user_id = any(v_ids);
  delete from public.notifications         where user_id = any(v_ids);
  delete from public.coach_feedback        where client_id = any(v_clients);
  delete from public.messages              where conversation_id in
    (select id from public.conversations where client_id = any(v_clients));
  delete from public.adherence_snapshots   where user_id = any(v_clients);
  delete from public.check_ins             where user_id = any(v_clients);
  delete from public.measurements          where user_id = any(v_clients);
  delete from public.habit_logs            where user_id = any(v_clients);
  delete from public.habits                where user_id = any(v_clients);
  delete from public.food_logs             where user_id = any(v_clients);
  delete from public.logged_sets           where user_id = any(v_clients);
  delete from public.logged_sessions       where user_id = any(v_clients);
  delete from public.nutrition_plans       where id in (select pg_temp.sid('plan:' || email) from seed_person);
  delete from public.programs              where id in (select pg_temp.sid('prog:' || email) from seed_person);
end $$;

-- --------------------------------------------------- 6. programs and plans
do $$
begin
  if exists (select 1 from seed_ex e
             left join public.exercises x on x.external_id = e.ext_id
             where x.id is null) then
    raise exception 'seed_ex references an exercise the library does not have';
  end if;
  if exists (select 1 from seed_meal m
             left join public.foods f on f.external_id = m.ext_id
             where f.id is null) then
    raise exception 'seed_meal references a food the curated list does not have';
  end if;
end $$;

insert into public.programs (id, coach_id, client_id, name, notes, status, intensity_mode, weeks, created_at, updated_at)
select pg_temp.sid('prog:' || p.email), c.id, u.id, p.program_name,
       'Program de test generat de supabase/seed/demo-data.sql.',
       'published', p.intensity, 1,
       now() - interval '45 days', now() - interval '9 days'
from seed_person p
join seed_id u on u.email = p.email
join seed_id c on c.email = p.coach_email
where p.role = 'client';

insert into public.program_days (id, program_id, week_index, day_index, name, muscle_groups)
select pg_temp.sid('day:' || d.email || ':' || d.day_index),
       pg_temp.sid('prog:' || d.email), 1, d.day_index, d.name, d.muscles
from seed_day d;

insert into public.program_exercises
  (id, program_day_id, exercise_id, position, target_sets, target_reps,
   target_weight_kg, target_rpe, rest_seconds, circuit, notes)
select pg_temp.sid('pex:' || e.email || ':' || e.day_index || ':' || e.position),
       pg_temp.sid('day:' || e.email || ':' || e.day_index),
       x.id, e.position, e.sets, e.reps_text, e.weight, e.target_rpe, e.rest, e.circuit, e.notes
from seed_ex e
join public.exercises x on x.external_id = e.ext_id;

insert into public.nutrition_plans
  (id, coach_id, client_id, name, kcal_target, protein_target_g, carbs_target_g, fat_target_g,
   status, created_at, updated_at)
select pg_temp.sid('plan:' || p.email), c.id, u.id, p.plan_name,
       p.kcal, p.prot, p.carb, p.fat, 'published',
       now() - interval '45 days', now() - interval '9 days'
from seed_person p
join seed_id u on u.email = p.email
join seed_id c on c.email = p.coach_email
where p.role = 'client';

insert into public.planned_meals (id, plan_id, day_index, slot, name, position)
select distinct pg_temp.sid('meal:' || p.email || ':' || m.slot),
       pg_temp.sid('plan:' || p.email), 0, m.slot::meal_slot, m.meal_name, m.meal_pos
from seed_person p
cross join seed_meal m
where p.role = 'client';

-- grams scale with the plan's kcal target; the template is Maria's 1900 kcal day
insert into public.planned_meal_foods (id, planned_meal_id, food_id, grams)
select pg_temp.sid('mealfood:' || p.email || ':' || m.slot || ':' || m.position),
       pg_temp.sid('meal:' || p.email || ':' || m.slot),
       f.id,
       greatest(1, round(m.base_grams * p.kcal / 1900.0, 1))
from seed_person p
cross join seed_meal m
join public.foods f on f.external_id = m.ext_id
where p.role = 'client';

-- ---------------------------------------------------------------- 7. habits
insert into public.habits (id, user_id, created_by, name, weekdays, active, created_at)
select pg_temp.sid('habit:' || p.email || ':' || h.n), u.id,
       case when h.n = 1 then c.id else u.id end,   -- the coach set the water one
       h.name, h.weekdays, true, now() - interval '44 days'
from seed_person p
join seed_id u on u.email = p.email
join seed_id c on c.email = p.coach_email
cross join (values
  (1, 'Apă 2,5 L',        '{0,1,2,3,4,5,6}'::int[]),
  (2, '10.000 de pași',   '{1,2,3,4,5}'::int[]),
  (3, 'Somn 7h+',         '{0,1,2,3,4,5,6}'::int[])
) as h(n, name, weekdays)
where p.role = 'client'
  and (p.habit_rate >= 40 or h.n <= 2);   -- the beginner only carries two

-- ------------------------------------------- 8. two weeks of logged training
-- One session per program day that falls in the window, with week-over-week
-- progression (+3.5% in the last seven days) and a PR on the opening lift of
-- each of those sessions. Nothing is seeded for today: Today is meant to show
-- a workout still to do.
do $$
declare
  p record; ex record;
  v_uid uuid; v_prog uuid; v_day uuid; v_day_name text;
  v_off int; v_s int; v_date date; v_dow int;
  v_sess uuid; v_local timestamp; v_start timestamptz; v_dur int;
  v_weight numeric; v_reps int; v_key text; v_factor numeric;
  v_rir numeric; v_rpe numeric; v_effort simple_effort; v_pr boolean;
  v_ts timestamptz;
begin
  for p in select * from seed_person where role = 'client' loop
    select id into v_uid from seed_id where email = p.email;
    v_prog := pg_temp.sid('prog:' || p.email);

    for v_off in reverse 13..1 loop
      continue when v_off < p.quiet_before;
      v_date := current_date - v_off;
      v_dow  := extract(dow from v_date)::int;
      continue when not (v_dow = any(p.train_dows)) or v_off = any(p.skip_offsets);

      v_day := null;
      select d.id, d.name into v_day, v_day_name
        from public.program_days d
       where d.program_id = v_prog and d.day_index = v_dow;
      continue when v_day is null;

      v_key   := p.email || ':' || v_off;
      v_sess  := pg_temp.sid('sess:' || v_key);
      v_dur   := 52 + pg_temp.pick('dur:' || v_key, 26);
      v_local := v_date + time '18:30' + (pg_temp.pick('h:' || v_key, 80) || ' minutes')::interval;
      v_start := v_local at time zone 'Europe/Bucharest';

      insert into public.logged_sessions
        (id, user_id, program_day_id, client_generated_id, started_at, completed_at, notes, received_at)
      values
        (v_sess, v_uid, v_day, pg_temp.sid('sesscgid:' || v_key), v_start,
         v_start + (v_dur || ' minutes')::interval,
         case pg_temp.pick('note:' || v_key, 4)
           when 0 then 'Energie bună, totul conform planului.'
           when 1 then 'Am dormit prost, am scăzut puțin din greutăți.'
           else null end,
         v_start + (v_dur || ' minutes')::interval);

      v_factor := case when v_off <= 6 then 1.035 else 1.0 end;

      for ex in
        select e.position, e.sets, e.reps_base, e.weight, e.target_rpe,
               x.id as exercise_id, pe.id as pe_id
          from seed_ex e
          join public.exercises x on x.external_id = e.ext_id
          join public.program_exercises pe
            on pe.id = pg_temp.sid('pex:' || e.email || ':' || e.day_index || ':' || e.position)
         where e.email = p.email and e.day_index = v_dow
         order by e.position
      loop
        for v_s in 1..ex.sets loop
          v_key := p.email || ':' || v_off || ':' || ex.position || ':' || v_s;

          v_weight := case when ex.weight is null then null
                      else round((ex.weight * v_factor * pg_temp.jit('w:' || v_key, 0.02)) / 2.5) * 2.5 end;
          v_reps := greatest(3, ex.reps_base
                    - (case when v_s >= 3 then 1 else 0 end)
                    + (case when pg_temp.pick('r:' || v_key, 4) = 0 then 1 else 0 end));
          -- the opening lift's top set in the most recent week: the bar moved up
          v_pr := v_off <= 6 and ex.position = 0 and v_s = ex.sets and ex.weight is not null;

          if p.intensity = 'rir' then
            v_rir    := greatest(0, coalesce(ex.target_rpe, 2) - (case when v_s = ex.sets then 1 else 0 end));
            v_rpe    := least(10, 10 - v_rir);
            v_effort := null;
          elsif p.intensity = 'rpe' then
            v_rir    := null;
            v_rpe    := least(10, coalesce(ex.target_rpe, 7) + (v_s - 1) * 0.5);
            v_effort := null;
          else
            v_rir    := null;
            v_rpe    := null;
            v_effort := (case when v_s = ex.sets then 'hard' else 'moderate' end)::simple_effort;
          end if;

          v_ts := v_start + ((ex.position * 9 + v_s * 2) || ' minutes')::interval;

          insert into public.logged_sets
            (id, session_id, user_id, program_exercise_id, exercise_id, client_generated_id,
             set_index, reps, weight_kg, rpe, rir, effort, is_pr, notes, client_ts, received_at)
          values
            (pg_temp.sid('set:' || v_key), v_sess, v_uid, ex.pe_id, ex.exercise_id,
             pg_temp.sid('setcgid:' || v_key),
             v_s, v_reps, v_weight, v_rpe, v_rir, v_effort, v_pr,
             case when v_pr then 'Record personal!'
                  when pg_temp.pick('sn:' || v_key, 12) = 0 then 'Ultima repetare a fost grea.'
                  else null end,
             v_ts, v_ts);
        end loop;
      end loop;
    end loop;
  end loop;
end $$;

-- ------------------------------------------------ 9. food, habits, weight
do $$
declare
  p record; m record; h record;
  v_uid uuid; v_plan uuid; v_off int; v_date date; v_dow int;
  v_key text; v_g numeric; v_ts timestamptz; v_step int;
  v_w numeric; v_waist numeric; v_chest numeric; v_hip numeric; v_delta numeric;
begin
  for p in select * from seed_person where role = 'client' loop
    select id into v_uid from seed_id where email = p.email;
    v_plan := pg_temp.sid('plan:' || p.email);

    -- food, straight off the plan, with the grams a real person actually eats
    foreach v_off in array p.food_offsets loop
      continue when v_off < p.quiet_before;
      v_date := current_date - v_off;
      for m in
        select pmf.id as pmf_id, pm.slot as slot, pmf.grams as grams, f.id as food_id,
               coalesce(f.name_ro, f.name_en) as food_name,
               f.kcal_100g, f.protein_100g, f.carbs_100g, f.fat_100g
          from public.planned_meals pm
          join public.planned_meal_foods pmf on pmf.planned_meal_id = pm.id
          join public.foods f on f.id = pmf.food_id
         where pm.plan_id = v_plan
           and not (pm.slot::text = any(p.skip_slots))
         order by pm.position, pmf.id
      loop
        v_key := p.email || ':' || v_off || ':' || m.pmf_id::text;
        v_g := greatest(1, round(m.grams * pg_temp.jit('g:' || v_key, 0.15)));
        v_ts := (v_date + case m.slot
                            when 'breakfast' then time '08:10'
                            when 'lunch'     then time '13:20'
                            when 'snack'     then time '16:30'
                            else                  time '19:40' end)
                at time zone 'Europe/Bucharest';

        insert into public.food_logs
          (id, user_id, date, slot, food_id, food_name, grams, kcal, protein_g, carbs_g, fat_g,
           method, client_generated_id, client_ts, received_at)
        values
          (pg_temp.sid('food:' || v_key), v_uid, v_date, m.slot, m.food_id, m.food_name, v_g,
           round(m.kcal_100g    * v_g / 100, 1),
           round(m.protein_100g * v_g / 100, 1),
           round(m.carbs_100g   * v_g / 100, 1),
           round(m.fat_100g     * v_g / 100, 1),
           (case pg_temp.pick('meth:' || v_key, 6)
              when 0 then 'barcode' when 1 then 'search' else 'plan' end)::food_log_method,
           pg_temp.sid('foodcgid:' || v_key), v_ts, v_ts);
      end loop;
    end loop;

    -- habit ticks
    for h in select id, weekdays from public.habits where user_id = v_uid loop
      for v_off in 0..13 loop
        continue when v_off < p.quiet_before;
        v_date := current_date - v_off;
        v_dow  := extract(dow from v_date)::int;
        continue when not (v_dow = any(h.weekdays));
        continue when pg_temp.pick('hab:' || h.id::text || ':' || v_off, 100) >= p.habit_rate;
        v_ts := (v_date + time '21:15') at time zone 'Europe/Bucharest';
        insert into public.habit_logs (id, habit_id, user_id, date, client_generated_id, received_at)
        values (pg_temp.sid('hlog:' || h.id::text || ':' || v_off), h.id, v_uid, v_date,
                pg_temp.sid('hlogcgid:' || h.id::text || ':' || v_off), v_ts)
        on conflict (habit_id, date) do nothing;
      end loop;
    end loop;

    -- weight and tape, every third day (rarer for the one who barely shows up),
    -- counted from the day they went quiet so a lapsed client still has a curve
    v_step := case when p.habit_rate < 30 then 4 else 3 end;
    for v_off in 0..13 loop
      continue when v_off < p.quiet_before or (v_off - p.quiet_before) % v_step <> 0;
      v_date := current_date - v_off;
      v_delta := p.weight_drift * (13 - v_off);
      v_w := round(p.weight_start + v_delta + 0.3 * pg_temp.jit('m:' || p.email || v_off, 1.0) - 0.3, 2);
      v_waist := round((case p.email
                          when 'client@healthapp.test'  then 71.0
                          when 'client2@healthapp.test' then 78.0
                          when 'client3@healthapp.test' then 104.0
                          else 86.0 end) + v_delta * 0.9, 1);
      v_chest := round((case p.email
                          when 'client@healthapp.test'  then 92.0
                          when 'client2@healthapp.test' then 95.0
                          when 'client3@healthapp.test' then 112.0
                          else 108.0 end) + v_delta * 0.4, 1);
      v_hip   := round((case p.email
                          when 'client@healthapp.test'  then 96.0
                          when 'client2@healthapp.test' then 101.0
                          when 'client3@healthapp.test' then 108.0
                          else 100.0 end) + v_delta * 0.5, 1);
      insert into public.measurements (id, user_id, date, weight_kg, circumferences, created_at)
      values (pg_temp.sid('meas:' || p.email || ':' || v_off), v_uid, v_date, v_w,
              jsonb_build_object('waist', v_waist, 'chest', v_chest, 'hips', v_hip),
              (v_date + time '07:20') at time zone 'Europe/Bucharest')
      on conflict (user_id, date) do update
        set weight_kg = excluded.weight_kg, circumferences = excluded.circumferences;
    end loop;
  end loop;
end $$;

-- ------------------------------------------------------------ 10. check-ins
-- One per ISO week (the schema enforces it). The most recent one is left
-- unreviewed on purpose: that is what puts a client on the coach's
-- "needs my feedback" list.
drop table if exists seed_checkin;
create temp table seed_checkin (
  email text, week_off int, sleep int, energy int, stress int, hunger int, recovery int,
  note text, reviewed boolean
);
insert into seed_checkin values
  ('client@healthapp.test',  2, 7, 7, 4, 5, 7, 'Prima săptămână cu programul nou. Mi-a plăcut, doar sâmbăta a fost grea.', true),
  ('client@healthapp.test',  1, 8, 8, 3, 4, 8, 'Săptămână bună, am prins toate cele 4 antrenamente și am ținut mâncarea.', true),
  ('client@healthapp.test',  0, 8, 7, 4, 4, 8, 'Merge bine. Aș vrea să cresc puțin la împins.', false),
  ('client2@healthapp.test', 1, 6, 5, 6, 7, 5, 'Săptămână aglomerată la muncă, am sărit un antrenament și mi-a fost foame seara.', false),
  ('client4@healthapp.test', 1, 7, 8, 4, 5, 7, 'Totul ok, squatul a mers ușor la 100.', true),
  ('client4@healthapp.test', 0, 8, 8, 3, 4, 8, 'Recuperare bună, pot să cresc volumul.', false);

insert into public.check_ins
  (id, user_id, week_start, weight_kg, circumferences, sleep, energy, stress, hunger, recovery,
   note, submitted_at, coach_reviewed_at)
select pg_temp.sid('checkin:' || c.email || ':' || c.week_off),
       u.id,
       date_trunc('week', current_date)::date - c.week_off * 7,
       round(p.weight_start + p.weight_drift * (13 - c.week_off * 7), 2),
       '{}'::jsonb,
       c.sleep, c.energy, c.stress, c.hunger, c.recovery, c.note,
       least(now() - interval '2 hours',
             ((date_trunc('week', current_date)::date - c.week_off * 7) + time '20:30')
               at time zone 'Europe/Bucharest'),
       case when c.reviewed
            then least(now() - interval '1 hour',
                       ((date_trunc('week', current_date)::date - c.week_off * 7 + 1) + time '09:15')
                         at time zone 'Europe/Bucharest')
       end
from seed_checkin c
join seed_id u on u.email = c.email
join seed_person p on p.email = c.email
on conflict (user_id, week_start) do update
  set sleep = excluded.sleep, energy = excluded.energy, stress = excluded.stress,
      hunger = excluded.hunger, recovery = excluded.recovery, note = excluded.note,
      coach_reviewed_at = excluded.coach_reviewed_at;

-- ------------------------------------------------- 11. the coach conversation
drop table if exists seed_msg;
create temp table seed_msg (
  email text, off int, from_coach boolean, body text, unread boolean
);
insert into seed_msg values
  ('client@healthapp.test',  11, true,  'Salut, Maria! Am urcat programul nou de Upper/Lower. Începem luni — spune-mi cum se simte genunchiul la genuflexiuni.', false),
  ('client@healthapp.test',  10, false, 'Mulțumesc! L-am văzut, arată bine. Genunchiul e ok până pe la 60 kg.', false),
  ('client@healthapp.test',   4, true,  'Felicitări pentru recordul de la împins! Ține RIR 2 pe seriile de lucru, nu forța încă.', false),
  ('client@healthapp.test',   1, false, 'Am o întrebare la cină: pot înlocui somonul cu ton? Nu găsesc somon proaspăt.', true),
  ('client2@healthapp.test',  9, true,  'Ioana, am coborât ținta la 1750 kcal. Zilele rămân luni / miercuri / vineri.', false),
  ('client2@healthapp.test',  8, false, 'Ok! Miercuri am avut o zi lungă la birou și am sărit peste sală.', false),
  ('client2@healthapp.test',  2, false, 'Vin mâine la sală, dar mă cam supără umărul stâng la împins deasupra capului.', true),
  ('client3@healthapp.test', 12, false, 'Am terminat primul antrenament, mi-a plăcut mai mult decât credeam!', false),
  ('client3@healthapp.test',  4, true,  'Radu, n-am mai văzut nimic logat de o săptămână. Totul bine? Hai să reluăm ușor, doar două zile.', false),
  ('client4@healthapp.test',  7, true,  'Alex, ai prins 100 kg la genuflexiuni curat. Săptămâna asta trecem la 4x5.', false),
  ('client4@healthapp.test',  6, false, 'Super, mulțumesc! Mă simt bine, recuperez repede.', false);

-- The conversation is found by its (coach, client) pair, never by the id this
-- script would have given it: accept_invite may have created it first.
insert into public.messages (id, conversation_id, sender_id, body, created_at, read_at)
select pg_temp.sid('msg:' || m.email || ':' || m.off),
       cv.id,
       case when m.from_coach then c.id else u.id end,
       m.body,
       (current_date - m.off + time '17:45') at time zone 'Europe/Bucharest',
       case when m.unread then null
            else (current_date - m.off + time '18:05') at time zone 'Europe/Bucharest' end
from seed_msg m
join seed_id u on u.email = m.email
join seed_person p on p.email = m.email
join seed_id c on c.email = p.coach_email
join public.conversations cv on cv.coach_id = c.id and cv.client_id = u.id;

-- ------------------------------------------ 12. feedback on real references
insert into public.coach_feedback
  (id, coach_id, client_id, reference_type, reference_id, body, created_at, read_at)
select pg_temp.sid('fb:session:' || p.email), c.id, u.id, 'session', s.id,
       'Sesiune solidă. Ai ținut tempo-ul și ultima serie arată bine — creștem 2,5 kg data viitoare.',
       s.completed_at + interval '3 hours', null
from seed_person p
join seed_id u on u.email = p.email
join seed_id c on c.email = p.coach_email
join lateral (
  select ls.id, ls.completed_at from public.logged_sessions ls
   where ls.user_id = u.id and ls.completed_at is not null
   order by ls.started_at desc limit 1
) s on true
where p.role = 'client';

insert into public.coach_feedback
  (id, coach_id, client_id, reference_type, reference_id, body, created_at, read_at)
select pg_temp.sid('fb:checkin:' || ci.email), c.id, u.id, 'check_in', k.id,
       'Am citit check-in-ul. Somnul arată bine, ținem caloriile la fel încă o săptămână.',
       k.submitted_at + interval '14 hours', null
from (select 'client@healthapp.test'::text as email, 1 as week_off) ci
join seed_id u on u.email = ci.email
join seed_person p on p.email = ci.email
join seed_id c on c.email = p.coach_email
join public.check_ins k
  on k.id = pg_temp.sid('checkin:' || ci.email || ':' || ci.week_off);

-- ------------------------------------------------------- 13. notifications
insert into public.notifications (id, user_id, category, title, body, payload, created_at, sent_at, read_at)
select pg_temp.sid('notif:msg:' || p.email), u.id, 'new_message',
       'Mesaj nou de la antrenor', left(m.body, 120),
       jsonb_build_object('conversation_id', m.conversation_id),
       m.created_at, m.created_at, null
from seed_person p
join seed_id u on u.email = p.email
join lateral (
  select msg.body, msg.created_at, msg.conversation_id from public.messages msg
   join public.conversations cv on cv.id = msg.conversation_id
  where cv.client_id = u.id and msg.sender_id <> u.id
  order by msg.created_at desc limit 1
) m on true
where p.role = 'client';

insert into public.notifications (id, user_id, category, title, body, payload, created_at, sent_at, read_at)
select pg_temp.sid('notif:checkin:' || p.email), c.id, 'checkin_submitted',
       p.full_name || ' a trimis check-in-ul', 'Așteaptă feedback.',
       jsonb_build_object('client_id', u.id),
       k.submitted_at, k.submitted_at, null
from seed_person p
join seed_id u on u.email = p.email
join seed_id c on c.email = p.coach_email
join lateral (
  select ci.submitted_at from public.check_ins ci
   where ci.user_id = u.id and ci.coach_reviewed_at is null
   order by ci.week_start desc limit 1
) k on true
where p.role = 'client';

insert into public.notifications (id, user_id, category, title, body, payload, created_at, sent_at, read_at)
select pg_temp.sid('notif:checkindue:' || p.email), u.id, 'check_in_due',
       'Check-in-ul săptămânal te așteaptă', 'Durează două minute.',
       '{}'::jsonb, now() - interval '20 hours', now() - interval '20 hours', null
from seed_person p
join seed_id u on u.email = p.email
where p.role = 'client'
  and not exists (select 1 from public.check_ins ci
                   where ci.user_id = u.id
                     and ci.week_start = date_trunc('week', current_date)::date);

-- ------------------------------------------------------------- 14. badges
insert into public.user_badges (user_id, badge_id, awarded_at)
select u.id, b.id, now() - interval '9 days'
from seed_person p
join seed_id u on u.email = p.email
join public.badges b on b.slug = any (
  case when p.habit_rate >= 80 then array['first-workout','first-checkin','first-pr','nutrition-week']
       when p.habit_rate >= 40 then array['first-workout','first-checkin','first-pr']
       else array['first-workout'] end)
where p.role = 'client'
on conflict do nothing;

-- -------------------------------------------- 15. challenges and the feed
insert into public.challenge_participants (id, challenge_id, user_id, joined_at)
select pg_temp.sid('chp:' || p.email || ':' || ch.id::text), ch.id, u.id, now() - interval '12 days'
from seed_person p
join seed_id u on u.email = p.email
join lateral (
  select c.id from public.challenges c
   where c.end_date >= current_date and c.visibility = 'public'
   order by c.start_date limit 2
) ch on true
where p.role = 'client'
on conflict (challenge_id, user_id) do nothing;

-- everyone follows their coach; the three clients of Andrei follow each other
insert into public.social_follows (id, follower_id, following_id, created_at)
select pg_temp.sid('follow:' || f.a || ':' || f.b), ua.id, ub.id, now() - interval '20 days'
from (values
  ('client@healthapp.test',  'trainer@healthapp.test'),
  ('client2@healthapp.test', 'trainer@healthapp.test'),
  ('client3@healthapp.test', 'trainer@healthapp.test'),
  ('client4@healthapp.test', 'trainer2@healthapp.test'),
  ('client@healthapp.test',  'client2@healthapp.test'),
  ('client2@healthapp.test', 'client@healthapp.test'),
  ('client3@healthapp.test', 'client@healthapp.test'),
  ('client4@healthapp.test', 'client@healthapp.test'),
  ('client@healthapp.test',  'client4@healthapp.test')
) as f(a, b)
join seed_id ua on ua.email = f.a
join seed_id ub on ub.email = f.b
on conflict (follower_id, following_id) do nothing;

-- A workout post per client off their last session, plus one PR post and one
-- plain text post. Payloads carry only aggregates, exactly like the app writes.
do $$
declare
  p record; v_uid uuid; v_sess record; v_pr record;
  v_sets int; v_exs int; v_vol numeric; v_prs int; v_post uuid;
begin
  for p in select * from seed_person where role = 'client' order by email loop
    select id into v_uid from seed_id where email = p.email;

    select ls.id, ls.started_at, ls.completed_at, d.name as day_name
      into v_sess
      from public.logged_sessions ls
      left join public.program_days d on d.id = ls.program_day_id
     where ls.user_id = v_uid and ls.completed_at is not null
     order by ls.started_at desc limit 1;
    continue when not found;

    select count(*)::int, count(distinct exercise_id)::int,
           coalesce(sum(reps * coalesce(weight_kg, 0)), 0), (count(*) filter (where is_pr))::int
      into v_sets, v_exs, v_vol, v_prs
      from public.logged_sets where session_id = v_sess.id;

    v_post := pg_temp.sid('post:workout:' || p.email);
    insert into public.social_posts (id, user_id, type, text, activity_id, payload, visibility, created_at)
    values (v_post, v_uid, 'workout', null, v_sess.id,
      jsonb_build_object(
        'kind', 'workout',
        'name', coalesce(v_sess.day_name, 'Antrenament'),
        'date', to_char(v_sess.started_at at time zone 'Europe/Bucharest', 'YYYY-MM-DD'),
        'duration_min', round(extract(epoch from (v_sess.completed_at - v_sess.started_at)) / 60)::int,
        'exercises', v_exs, 'sets', v_sets, 'volume_kg', round(v_vol)::int,
        'load', 45 + pg_temp.pick('load:' || p.email, 40), 'prs', v_prs),
      'public', v_sess.completed_at + interval '20 minutes');

    -- a PR post for whoever actually hit one
    select ls.weight_kg, ls.reps, coalesce(x.name_ro, x.name_en) as ex_name, ls.received_at
      into v_pr
      from public.logged_sets ls
      join public.exercises x on x.id = ls.exercise_id
     where ls.user_id = v_uid and ls.is_pr and ls.weight_kg is not null
     order by ls.received_at desc limit 1;
    if found then
      insert into public.social_posts (id, user_id, type, text, payload, visibility, created_at)
      values (pg_temp.sid('post:pr:' || p.email), v_uid, 'pr', null,
        jsonb_build_object('kind', 'pr', 'exercise', v_pr.ex_name,
          'weight_kg', v_pr.weight_kg, 'reps', v_pr.reps,
          'estimated_1rm', round(v_pr.weight_kg * (1 + v_pr.reps / 30.0), 1),
          'date', to_char(v_pr.received_at at time zone 'Europe/Bucharest', 'YYYY-MM-DD')),
        'public', v_pr.received_at + interval '35 minutes');
    end if;
  end loop;
end $$;

insert into public.social_posts (id, user_id, type, text, payload, visibility, created_at)
select pg_temp.sid('post:text:' || t.email), u.id, 'text', t.body, null, 'public',
       now() - (t.off || ' days')::interval
from (values
  ('client2@healthapp.test', 3, 'Două săptămâni de când am început. Nu e spectaculos, dar merg constant la sală și asta e tot.'),
  ('client@healthapp.test',  6, 'Am reușit prima tracțiune fără elastic! 💪')
) as t(email, off, body)
join seed_id u on u.email = t.email;

-- kudos from everyone else, and a couple of comments
insert into public.social_reactions (id, post_id, user_id, type, created_at)
select pg_temp.sid('kudos:' || sp.id::text || ':' || u.id::text), sp.id, u.id, 'kudos',
       sp.created_at + interval '2 hours'
from public.social_posts sp
join seed_id u on u.id <> sp.user_id
where sp.id in (select pg_temp.sid('post:workout:' || email) from seed_person
                union all select pg_temp.sid('post:pr:' || email) from seed_person
                union all select pg_temp.sid('post:text:' || email) from seed_person)
  and pg_temp.pick('k:' || sp.id::text || ':' || u.id::text, 3) > 0
on conflict (post_id, user_id, type) do nothing;

insert into public.social_comments (id, post_id, user_id, body, created_at, updated_at)
select pg_temp.sid('comment:' || c.post_key), pg_temp.sid(c.post_key), u.id, c.body,
       now() - (c.off || ' days')::interval, now() - (c.off || ' days')::interval
from (values
  ('post:workout:client@healthapp.test', 'client2@healthapp.test', 1, 'Bravo! Ce greutate ai pus la genuflexiuni?'),
  ('post:pr:client@healthapp.test',      'trainer@healthapp.test', 1, 'Meritat. Ținem RIR 2 și săptămâna viitoare.'),
  ('post:text:client2@healthapp.test',   'client@healthapp.test',  2, 'Constanța bate intensitatea. Ține-o tot așa!')
) as c(post_key, email, off, body)
join seed_id u on u.email = c.email
where exists (select 1 from public.social_posts sp where sp.id = pg_temp.sid(c.post_key));

-- ------------------------------------------------- 16. the adherence engine
-- The real function, not hand-written numbers: the coach dashboard reads the
-- most recent snapshot, and the engine's own default is "last week", so the
-- current (incomplete) week is deliberately not computed.
select public.compute_adherence_snapshots(date_trunc('week', current_date)::date - 14) as weeks_ago_2;
select public.compute_adherence_snapshots(date_trunc('week', current_date)::date - 7)  as weeks_ago_1;

-- ------------------------------------------------------------- 17. summary
select u.full_name,
       p.role,
       (select count(*) from public.logged_sessions s where s.user_id = u.id) as sessions,
       (select count(*) from public.logged_sets s where s.user_id = u.id) as sets,
       (select count(*) from public.food_logs f where f.user_id = u.id) as food_logs,
       (select count(*) from public.habit_logs h where h.user_id = u.id) as habit_logs,
       (select count(*) from public.measurements m where m.user_id = u.id) as measurements,
       (select count(*) from public.check_ins c where c.user_id = u.id) as check_ins,
       (select a.signal from public.adherence_snapshots a
         where a.user_id = u.id order by a.week_start desc limit 1) as signal,
       (select round(a.overall_pct * 100) from public.adherence_snapshots a
         where a.user_id = u.id order by a.week_start desc limit 1) as adherence_pct
from seed_person p
join seed_id s on s.email = p.email
join public.users u on u.id = s.id
order by p.role, u.full_name;
