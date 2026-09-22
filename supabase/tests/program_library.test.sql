-- pgTAP · the routine library: visibility, copying, bookmarks, and the line
-- between a PROGRAM (the plan) and a WORKOUT (what was actually lifted).
--
-- The library lets one person read and copy another person's program for the
-- first time in this schema, so the questions this file answers are the ones
-- that decide whether that was safe:
--
--   · can a stranger see / copy a private program?            (no)
--   · can a coach's program be published to the world?        (no)
--   · is a copy independent of its original?                  (yes)
--   · can a coached client author programs by copying?        (no)
--   · does editing a program rewrite training history?        (no)
--
-- Run with a local stack up:  npm run db:test
-- Or without Docker:          npm run db:test:offline

begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

create or replace function pg_temp.authenticate_as(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$fn$;

-- How many rows an UPDATE actually touched, under the current role. A
-- data-modifying CTE cannot be nested inside is(), and "0 rows" is exactly
-- what an RLS refusal looks like — so this is how the write tests below read.
create or replace function pg_temp.rows_touched(p_sql text)
returns int language plpgsql as $fn$
declare v_n int;
begin
  execute p_sql;
  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

-- ---------- people ----------
-- COACH coaches CLIENT. SOLO trains alone and publishes. FAN follows SOLO.
-- STRANGER follows nobody.
insert into auth.users (id, email, raw_user_meta_data) values
  ('c0000000-0000-0000-0000-00000000c0a1', 'coach@lib.test',    '{"full_name":"Coach"}'),
  ('c0000000-0000-0000-0000-00000000c111', 'client@lib.test',   '{"full_name":"Client"}'),
  ('c0000000-0000-0000-0000-00000000501a', 'solo@lib.test',     '{"full_name":"Solo"}'),
  ('c0000000-0000-0000-0000-00000000fa11', 'fan@lib.test',      '{"full_name":"Fan"}'),
  ('c0000000-0000-0000-0000-000000005747', 'stranger@lib.test', '{"full_name":"Stranger"}');

update public.users set role = 'coach' where id = 'c0000000-0000-0000-0000-00000000c0a1';

insert into public.trainer_clients (coach_id, client_id, status, started_at) values
  ('c0000000-0000-0000-0000-00000000c0a1', 'c0000000-0000-0000-0000-00000000c111', 'active', now());

insert into public.social_follows (follower_id, following_id) values
  ('c0000000-0000-0000-0000-00000000fa11', 'c0000000-0000-0000-0000-00000000501a');

insert into public.exercises (id, source, external_id, name_en, primary_muscles, equipment)
values
  ('e0000000-0000-0000-0000-0000000000b1', 'custom', 'lib-bench', 'Bench Press', '{chest}', 'barbell'),
  ('e0000000-0000-0000-0000-0000000000e2', 'custom', 'lib-row',   'Barbell Row', '{middle back}', 'barbell');

-- ---------- programs ----------
-- SOLO's public routine: one day, two exercises.
insert into public.programs (id, coach_id, client_id, name, status, visibility, level, goal)
values ('40000000-0000-0000-0000-0000000000b1', null, 'c0000000-0000-0000-0000-00000000501a',
        'Public PPL', 'published', 'public', 'intermediate', 'hypertrophy');
insert into public.program_days (id, program_id, week_index, day_index, name)
values ('d0000000-0000-0000-0000-0000000000b1', '40000000-0000-0000-0000-0000000000b1', 1, 0, 'Push');
insert into public.program_exercises (program_day_id, exercise_id, position, target_sets, target_reps, target_rpe, rest_seconds)
values
  ('d0000000-0000-0000-0000-0000000000b1', 'e0000000-0000-0000-0000-0000000000b1', 0, 3, '8', 2, 90),
  ('d0000000-0000-0000-0000-0000000000b1', 'e0000000-0000-0000-0000-0000000000e2', 1, 4, '10', 2, 60);

-- SOLO's private routine.
insert into public.programs (id, coach_id, client_id, name, status, visibility)
values ('40000000-0000-0000-0000-000000000521', null, 'c0000000-0000-0000-0000-00000000501a',
        'Secret block', 'published', 'private');
insert into public.program_days (id, program_id, week_index, day_index, name)
values ('d0000000-0000-0000-0000-000000000521', '40000000-0000-0000-0000-000000000521', 1, 0, 'Secret');

-- SOLO's followers-only routine.
insert into public.programs (id, coach_id, client_id, name, status, visibility)
values ('40000000-0000-0000-0000-00000000f011', null, 'c0000000-0000-0000-0000-00000000501a',
        'For followers', 'published', 'followers');
insert into public.program_days (id, program_id, week_index, day_index, name)
values ('d0000000-0000-0000-0000-00000000f011', '40000000-0000-0000-0000-00000000f011', 1, 0, 'Followers day');

-- COACH's program for CLIENT.
insert into public.programs (id, coach_id, client_id, name, status)
values ('40000000-0000-0000-0000-00000000c0a1', 'c0000000-0000-0000-0000-00000000c0a1',
        'c0000000-0000-0000-0000-00000000c111', 'Coached block', 'published');
insert into public.program_days (id, program_id, week_index, day_index, name)
values ('d0000000-0000-0000-0000-00000000c0a1', '40000000-0000-0000-0000-00000000c0a1', 1, 0, 'Coached day');
insert into public.program_exercises (id, program_day_id, exercise_id, position, target_sets, target_reps)
values ('90000000-0000-0000-0000-00000000c0a1', 'd0000000-0000-0000-0000-00000000c0a1',
        'e0000000-0000-0000-0000-0000000000b1', 0, 3, '8');

-- CLIENT has already trained that day. This is the history that must survive
-- every edit below.
insert into public.logged_sessions (id, user_id, program_day_id, client_generated_id, started_at, completed_at)
values ('50000000-0000-0000-0000-00000000c111', 'c0000000-0000-0000-0000-00000000c111',
        'd0000000-0000-0000-0000-00000000c0a1', '60000000-0000-0000-0000-00000000c111',
        now() - interval '2 days', now() - interval '2 days');
insert into public.logged_sets
  (session_id, user_id, exercise_id, program_exercise_id, client_generated_id, set_index, reps, weight_kg)
values ('50000000-0000-0000-0000-00000000c111', 'c0000000-0000-0000-0000-00000000c111',
        'e0000000-0000-0000-0000-0000000000b1', '90000000-0000-0000-0000-00000000c0a1',
        '70000000-0000-0000-0000-00000000c111', 1, 8, 100.00);

-- ---------- 1. a coach program can never leave private ----------
select throws_ok(
  $$update public.programs set visibility = 'public'
    where id = '40000000-0000-0000-0000-00000000c0a1'$$,
  '23514', null,
  'a program with a coach cannot be made public — the check constraint refuses'
);

-- ---------- 2. what a stranger sees ----------
select pg_temp.authenticate_as('c0000000-0000-0000-0000-000000005747');
select is(
  (select count(*)::int from public.programs where id = '40000000-0000-0000-0000-0000000000b1'),
  1, 'a stranger reads a public program');
select is(
  (select count(*)::int from public.program_exercises
   where program_day_id = 'd0000000-0000-0000-0000-0000000000b1'),
  2, 'and the exercises inside it');
select is(
  (select count(*)::int from public.programs where id = '40000000-0000-0000-0000-000000000521'),
  0, 'a stranger cannot read a private program');
select is(
  (select count(*)::int from public.program_days where program_id = '40000000-0000-0000-0000-000000000521'),
  0, 'nor its days');
select is(
  (select count(*)::int from public.programs where id = '40000000-0000-0000-0000-00000000f011'),
  0, 'nor a followers-only program they do not follow');
select is(
  (select count(*)::int from public.programs where id = '40000000-0000-0000-0000-00000000c0a1'),
  0, 'nor somebody else''s coached program');
select is(
  (select public.can_see_program('40000000-0000-0000-0000-000000000521')),
  false, 'can_see_program agrees about the private one');

-- ---------- 3. a follower sees the followers-only one ----------
select pg_temp.authenticate_as('c0000000-0000-0000-0000-00000000fa11');
select is(
  (select count(*)::int from public.programs where id = '40000000-0000-0000-0000-00000000f011'),
  1, 'a follower reads a followers-only program');
select is(
  (select count(*)::int from public.programs where id = '40000000-0000-0000-0000-000000000521'),
  0, 'but still not the private one');

-- ---------- 4. a stranger cannot write to what they can read ----------
select pg_temp.authenticate_as('c0000000-0000-0000-0000-000000005747');
select is(
  pg_temp.rows_touched($$update public.programs set name = 'Hijacked'
                        where id = '40000000-0000-0000-0000-0000000000b1'$$),
  0, 'a stranger cannot rename a public program they can read');

-- ---------- 5. copying ----------
select lives_ok(
  $$select public.copy_program('40000000-0000-0000-0000-0000000000b1', 'My PPL')$$,
  'a stranger copies a public program');
select is(
  (select count(*)::int from public.programs
   where client_id = 'c0000000-0000-0000-0000-000000005747' and coach_id is null),
  1, 'the copy belongs to them');
select is(
  (select count(*)::int from public.program_exercises e
   join public.program_days d on d.id = e.program_day_id
   join public.programs p on p.id = d.program_id
   where p.client_id = 'c0000000-0000-0000-0000-000000005747'),
  2, 'with every prescribed exercise carried over');
select is(
  (select visibility from public.programs
   where client_id = 'c0000000-0000-0000-0000-000000005747' and coach_id is null),
  'private', 'a copy starts private — copying does not republish');
select is(
  (select source_program_id from public.programs
   where client_id = 'c0000000-0000-0000-0000-000000005747' and coach_id is null),
  '40000000-0000-0000-0000-0000000000b1'::uuid, 'and records where it came from');

select throws_ok(
  $$select public.copy_program('40000000-0000-0000-0000-000000000521')$$,
  'P0002', null,
  'a private program cannot be copied by someone who cannot see it'
);

-- ---------- 6. the copy is independent ----------
-- Change the copy; the original must not move.
update public.program_exercises e set target_sets = 12
from public.program_days d, public.programs p
where e.program_day_id = d.id and d.program_id = p.id
  and p.client_id = 'c0000000-0000-0000-0000-000000005747';
select is(
  (select max(target_sets)::int from public.program_exercises
   where program_day_id = 'd0000000-0000-0000-0000-0000000000b1'),
  4, 'editing the copy leaves the original''s prescription alone');

reset role;
select is(
  (select copy_count from public.programs where id = '40000000-0000-0000-0000-0000000000b1'),
  1, 'copying somebody else''s program counts towards "most copied"');

-- ---------- 7. duplicating your own does not inflate the count ----------
select pg_temp.authenticate_as('c0000000-0000-0000-0000-00000000501a');
select lives_ok(
  $$select public.copy_program('40000000-0000-0000-0000-0000000000b1', 'Public PPL v2')$$,
  'the author duplicates their own program');
reset role;
select is(
  (select copy_count from public.programs where id = '40000000-0000-0000-0000-0000000000b1'),
  1, 'duplicating your own program is housekeeping, not popularity');

-- ---------- 8. a coached client may not author programs ----------
select pg_temp.authenticate_as('c0000000-0000-0000-0000-00000000c111');
select throws_ok(
  $$select public.copy_program('40000000-0000-0000-0000-0000000000b1', 'Mine now')$$,
  '42501', null,
  'a client with an active coach cannot copy a program into one of their own'
);
select is(
  pg_temp.rows_touched($$update public.program_exercises set target_sets = 10
                        where id = '90000000-0000-0000-0000-00000000c0a1'$$),
  0, 'and cannot edit the program their coach assigned');

-- ---------- 9. assigning ----------
select pg_temp.authenticate_as('c0000000-0000-0000-0000-00000000c0a1');
select lives_ok(
  $$select public.copy_program('40000000-0000-0000-0000-0000000000b1', 'PPL for Client',
                               'c0000000-0000-0000-0000-00000000c111')$$,
  'a coach assigns a public program to their client'
);
select is(
  (select status::text from public.programs
   where coach_id = 'c0000000-0000-0000-0000-00000000c0a1' and name = 'PPL for Client'),
  'draft', 'the assignment lands as a draft for the coach to review');
select throws_ok(
  $$select public.copy_program('40000000-0000-0000-0000-0000000000b1', 'Uninvited',
                               'c0000000-0000-0000-0000-000000005747')$$,
  '42501', null,
  'but not to somebody who is not their client'
);

-- ---------- 10. bookmarks ----------
select pg_temp.authenticate_as('c0000000-0000-0000-0000-000000005747');
select lives_ok(
  $$insert into public.program_saves (user_id, program_id)
    values ('c0000000-0000-0000-0000-000000005747', '40000000-0000-0000-0000-0000000000b1')$$,
  'a public program can be saved'
);
select throws_ok(
  $$insert into public.program_saves (user_id, program_id)
    values ('c0000000-0000-0000-0000-000000005747', '40000000-0000-0000-0000-0000000000b1')$$,
  '23505', null,
  'the same program cannot be saved twice — the unique pair makes the toggle race-safe'
);
select throws_ok(
  $$insert into public.program_saves (user_id, program_id)
    values ('c0000000-0000-0000-0000-000000005747', '40000000-0000-0000-0000-000000000521')$$,
  '42501', null,
  'a private program cannot be saved by its id'
);

-- ---------- 11. the plan moves, the history does not ----------
-- The coach rewrites the prescription the client already trained, then deletes
-- the day outright. Both are everyday edits; neither may touch what was lifted.
reset role;
update public.program_exercises set target_sets = 5, target_reps = '12'
where id = '90000000-0000-0000-0000-00000000c0a1';
select is(
  (select weight_kg::numeric from public.logged_sets
   where client_generated_id = '70000000-0000-0000-0000-00000000c111'),
  100.00::numeric,
  'rewriting the prescription leaves the logged set exactly as performed'
);

delete from public.program_days where id = 'd0000000-0000-0000-0000-00000000c0a1';
select is(
  (select reps from public.logged_sets
   where client_generated_id = '70000000-0000-0000-0000-00000000c111'),
  8,
  'and deleting the day keeps the session — only the link back to the plan is cut'
);

select * from finish();
rollback;
