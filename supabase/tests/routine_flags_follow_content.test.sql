-- pgTAP · admin flags describe the content an admin looked at (20260930150000).
--
-- featured_at and is_official are an admin's judgement of ONE version of a
-- routine. Any change by someone who is not an admin — leaving public, or
-- editing the program, a day or a prescribed exercise — clears both, so the
-- "By Voinic" badge and the Featured shelf can never be carried over to
-- content nobody reviewed. An admin's own edits keep them.
--
-- Run with a local stack up:  npm run db:test   (or: npm run db:test:offline)

begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

create or replace function pg_temp.authenticate_as(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$fn$;

create or replace function pg_temp.flag_it() returns void language sql as $fn$
  update public.programs set featured_at = now(), is_official = true
  where id = 'c4000000-0000-0000-0000-000000000001';
$fn$;

create or replace function pg_temp.flags() returns text language sql as $fn$
  select (featured_at is not null)::text || '/' || is_official::text
  from public.programs where id = 'c4000000-0000-0000-0000-000000000001';
$fn$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('a4000000-0000-0000-0000-000000000001', 'owner@flags.local', '{"full_name":"Owner","username":"owner"}'),
  ('a4000000-0000-0000-0000-000000000002', 'admin@flags.local', '{"full_name":"Admin","username":"admin"}');
update public.users set role = 'admin' where id = 'a4000000-0000-0000-0000-000000000002';

insert into public.exercises (id, source, external_id, name_en, primary_muscles) values
  ('b4000000-0000-0000-0000-000000000001', 'custom', 'flags-bench', 'Bench', '{chest}');
insert into public.programs (id, coach_id, client_id, name, status, visibility, intensity_mode) values
  ('c4000000-0000-0000-0000-000000000001', null, 'a4000000-0000-0000-0000-000000000001', 'Reviewed', 'published', 'public', 'rir');
insert into public.program_days (id, program_id, week_index, day_index, name) values
  ('d4000000-0000-0000-0000-000000000001', 'c4000000-0000-0000-0000-000000000001', 1, 1, 'Day 1');
insert into public.program_exercises (id, program_day_id, exercise_id, position, target_sets, target_reps) values
  ('e4000000-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-000000000001', 'b4000000-0000-0000-0000-000000000001', 0, 3, '8');

-- ---------- the owner changes something ----------
select pg_temp.flag_it();
select pg_temp.authenticate_as('a4000000-0000-0000-0000-000000000001');
update public.programs set visibility = 'private' where id = 'c4000000-0000-0000-0000-000000000001';
update public.programs set visibility = 'public'  where id = 'c4000000-0000-0000-0000-000000000001';
reset role;
select is(pg_temp.flags(), 'false/false', 'private and back: neither the feature nor the Voinic mark survives');

select pg_temp.flag_it();
select pg_temp.authenticate_as('a4000000-0000-0000-0000-000000000001');
update public.programs set description = 'Something else entirely' where id = 'c4000000-0000-0000-0000-000000000001';
reset role;
select is(pg_temp.flags(), 'false/false', 'editing the program''s own fields clears both flags');

select pg_temp.flag_it();
select pg_temp.authenticate_as('a4000000-0000-0000-0000-000000000001');
update public.program_exercises set target_reps = '20' where id = 'e4000000-0000-0000-0000-000000000001';
reset role;
select is(pg_temp.flags(), 'false/false', 'editing a prescribed exercise clears both flags');

select pg_temp.flag_it();
select pg_temp.authenticate_as('a4000000-0000-0000-0000-000000000001');
insert into public.program_exercises (program_day_id, exercise_id, position, target_sets, target_reps)
values ('d4000000-0000-0000-0000-000000000001', 'b4000000-0000-0000-0000-000000000001', 1, 3, '8');
reset role;
select is(pg_temp.flags(), 'false/false', 'adding an exercise clears both flags');

select pg_temp.flag_it();
select pg_temp.authenticate_as('a4000000-0000-0000-0000-000000000001');
delete from public.program_exercises where id = 'e4000000-0000-0000-0000-000000000001';
reset role;
select is(pg_temp.flags(), 'false/false', 'removing an exercise clears both flags');

select pg_temp.flag_it();
select pg_temp.authenticate_as('a4000000-0000-0000-0000-000000000001');
update public.program_days set name = 'Renamed' where id = 'd4000000-0000-0000-0000-000000000001';
reset role;
select is(pg_temp.flags(), 'false/false', 'renaming a day clears both flags');

select pg_temp.flag_it();
select pg_temp.authenticate_as('a4000000-0000-0000-0000-000000000001');
insert into public.program_days (program_id, week_index, day_index, name)
values ('c4000000-0000-0000-0000-000000000001', 1, 2, 'Day 2');
reset role;
select is(pg_temp.flags(), 'false/false', 'adding a day clears both flags');

-- ---------- things that are not content ----------
select pg_temp.flag_it();
select pg_temp.authenticate_as('a4000000-0000-0000-0000-000000000001');
insert into public.program_saves (user_id, program_id) values
  ('a4000000-0000-0000-0000-000000000001', 'c4000000-0000-0000-0000-000000000001');
reset role;
select is(pg_temp.flags(), 'true/true', 'saving it is not an edit');

-- ---------- an admin's own edits ----------
select pg_temp.authenticate_as('a4000000-0000-0000-0000-000000000002');
select public.admin_set_program_flags('c4000000-0000-0000-0000-000000000001', true, true);
reset role;
select is(pg_temp.flags(), 'true/true', 'the admin flags it');

-- An admin fixing a typo through the admin flags RPC or an admin-run session
-- keeps the judgement: the rule is about edits nobody reviewed.
update public.program_exercises set target_reps = '10' where id <> 'e4000000-0000-0000-0000-000000000001'
  and program_day_id = 'd4000000-0000-0000-0000-000000000001';
select is(pg_temp.flags(), 'true/true', 'a service-level write (no signed-in user) keeps the flags');

select * from finish();
rollback;
