-- pgTAP · premium routines foundation (20260930100000).
--
-- Pins down: RIR 0 is a valid prescription; set_type is checked; owners cannot
-- write the columns that are not theirs to write (copy_count, lineage,
-- ownership, featured, official); only an admin features a PUBLIC routine and
-- the flag drops when it stops being public; Discover filters on style,
-- session length and featured without ever showing a private routine; copies
-- keep structure and metadata but never the admin flags; duplicating an
-- exercise is atomic and owner-only; deleting a prescription never touches
-- what was logged against it.
--
-- Run with a local stack up:  npm run db:test   (or: npm run db:test:offline)

begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

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
  ('a3000000-0000-0000-0000-000000000001', 'author@routines.local',   '{"full_name":"Author","username":"author"}'),
  ('a3000000-0000-0000-0000-000000000002', 'stranger@routines.local', '{"full_name":"Stranger","username":"stranger"}'),
  ('a3000000-0000-0000-0000-000000000003', 'coach@routines.local',    '{"full_name":"Coach","username":"coach"}'),
  ('a3000000-0000-0000-0000-000000000004', 'client@routines.local',   '{"full_name":"Client","username":"client"}'),
  ('a3000000-0000-0000-0000-000000000005', 'admin@routines.local',    '{"full_name":"Admin","username":"admin"}');

update public.users set role = 'coach' where id = 'a3000000-0000-0000-0000-000000000003';
update public.users set role = 'admin' where id = 'a3000000-0000-0000-0000-000000000005';
insert into public.trainer_clients (coach_id, client_id, status, started_at) values
  ('a3000000-0000-0000-0000-000000000003', 'a3000000-0000-0000-0000-000000000004', 'active', now());

insert into public.exercises (id, source, external_id, name_en, primary_muscles, equipment) values
  ('b3000000-0000-0000-0000-000000000001', 'custom', 'pr-bench', 'Bench', '{chest}', 'barbell'),
  ('b3000000-0000-0000-0000-000000000002', 'custom', 'pr-row',   'Row',   '{lats}',  'barbell');

-- The author's public routine: one day, a superset of two, 3 sets each at
-- 60 s rest → (3·(40+60))·2 = 600 s = 10 min per session.
insert into public.programs (id, coach_id, client_id, name, status, visibility, intensity_mode, training_style, weeks) values
  ('c3000000-0000-0000-0000-000000000001', null, 'a3000000-0000-0000-0000-000000000001', 'Upper', 'published', 'public', 'rir', 'upper_lower', 6),
  ('c3000000-0000-0000-0000-000000000002', null, 'a3000000-0000-0000-0000-000000000001', 'Secret', 'published', 'private', 'rir', 'full_body', 1);
insert into public.program_days (id, program_id, week_index, day_index, name) values
  ('d3000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-000000000001', 1, 1, 'Upper A'),
  ('d3000000-0000-0000-0000-000000000002', 'c3000000-0000-0000-0000-000000000002', 1, 1, 'Everything');
insert into public.program_exercises (id, program_day_id, exercise_id, position, target_sets, target_reps, target_rpe, rest_seconds, circuit, set_type) values
  ('e3000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-000000000001', 'b3000000-0000-0000-0000-000000000001', 0, 3, '8', 2, 60, 1, 'normal'),
  ('e3000000-0000-0000-0000-000000000002', 'd3000000-0000-0000-0000-000000000001', 'b3000000-0000-0000-0000-000000000002', 1, 3, '10', 1, 60, 1, 'amrap'),
  ('e3000000-0000-0000-0000-000000000003', 'd3000000-0000-0000-0000-000000000002', 'b3000000-0000-0000-0000-000000000001', 0, 3, '5', 2, 120, null, 'normal');

-- The coach's program for the client, published.
insert into public.programs (id, coach_id, client_id, name, status, intensity_mode) values
  ('c3000000-0000-0000-0000-000000000003', 'a3000000-0000-0000-0000-000000000003', 'a3000000-0000-0000-0000-000000000004', 'Client plan', 'published', 'rir');
insert into public.program_days (id, program_id, week_index, day_index, name) values
  ('d3000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000003', 1, 1, 'Day 1');
insert into public.program_exercises (id, program_day_id, exercise_id, position, target_sets, target_reps) values
  ('e3000000-0000-0000-0000-000000000004', 'd3000000-0000-0000-0000-000000000003', 'b3000000-0000-0000-0000-000000000001', 0, 3, '8');

-- ---------- prescriptions ----------
select pg_temp.authenticate_as('a3000000-0000-0000-0000-000000000001');

select lives_ok(
  $$ update public.program_exercises set target_rpe = 0 where id = 'e3000000-0000-0000-0000-000000000001' $$,
  'RIR 0 is a valid prescription');

select throws_ok(
  $$ update public.program_exercises set set_type = 'mystery' where id = 'e3000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'an unknown set type is refused');

-- ---------- columns an owner may not write ----------
select throws_ok(
  $$ update public.programs set copy_count = 999999 where id = 'c3000000-0000-0000-0000-000000000001' $$,
  '42501', null, 'an owner cannot inflate their own copy count');

select throws_ok(
  $$ update public.programs set featured_at = now() where id = 'c3000000-0000-0000-0000-000000000001' $$,
  '42501', null, 'an owner cannot feature their own routine');

select throws_ok(
  $$ update public.programs set is_official = true where id = 'c3000000-0000-0000-0000-000000000001' $$,
  '42501', null, 'an owner cannot mark their routine as Voinic''s');

select throws_ok(
  $$ update public.programs set client_id = 'a3000000-0000-0000-0000-000000000002' where id = 'c3000000-0000-0000-0000-000000000001' $$,
  '42501', null, 'an owner cannot hand the row to someone else');

select throws_ok(
  $$ insert into public.programs (client_id, name, source_program_id)
     values ('a3000000-0000-0000-0000-000000000001', 'Fake copy', 'c3000000-0000-0000-0000-000000000003') $$,
  '42501', null, 'lineage cannot be forged to inflate someone else''s usage');

select lives_ok(
  $$ update public.programs set name = 'Upper Power', description = 'Six weeks.', training_style = 'upper_lower', weeks = 6
     where id = 'c3000000-0000-0000-0000-000000000001' $$,
  'the owner still edits what is theirs to edit');

select throws_ok(
  $$ update public.programs set training_style = 'bro_split' where id = 'c3000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'an unknown training style is refused');

-- ---------- featuring ----------
select throws_ok(
  $$ select public.admin_set_program_flags('c3000000-0000-0000-0000-000000000001', true, true) $$,
  '42501', null, 'a non-admin cannot feature anything, their own included');

select pg_temp.authenticate_as('a3000000-0000-0000-0000-000000000005');

select throws_ok(
  $$ select public.admin_set_program_flags('c3000000-0000-0000-0000-000000000002', true, false) $$,
  '22023', null, 'even an admin cannot feature a private routine');

select lives_ok(
  $$ select public.admin_set_program_flags('c3000000-0000-0000-0000-000000000001', true, true) $$,
  'an admin features a public routine and marks it official');

-- ---------- the card and Discover, as a stranger ----------
select pg_temp.authenticate_as('a3000000-0000-0000-0000-000000000002');

select is(
  (select featured::text || ' ' || source || ' ' || training_style || ' ' || weeks || ' ' || days_per_week || ' ' || session_minutes
     from public.program_card_rows(array['c3000000-0000-0000-0000-000000000001'::uuid])),
  'true voinic upper_lower 6 1 10',
  'the card carries featured, source, style, weeks, days per week and session length');

select is(
  (select string_agg(name, ',') from public.discover_programs(p_featured => true)),
  'Upper Power', 'the featured shelf holds the featured routine');

select is(
  (select count(*)::int from public.discover_programs(p_style => 'full_body')),
  0, 'a style filter never reaches the private full-body routine');

select is(
  (select count(*)::int from public.discover_programs(p_max_minutes => 10)),
  1, 'a 10-minute session passes a 10-minute ceiling');

select is(
  (select count(*)::int from public.discover_programs(p_max_minutes => 5)),
  0, 'and fails a 5-minute one');

-- ---------- copying ----------
select lives_ok(
  $$ select public.copy_program('c3000000-0000-0000-0000-000000000001') $$,
  'a stranger copies the public routine');

select is(
  (select p.featured_at is null and not p.is_official and p.training_style = 'upper_lower' and p.weeks = 6
     from public.programs p
     where p.client_id = 'a3000000-0000-0000-0000-000000000002' and p.source_program_id = 'c3000000-0000-0000-0000-000000000001'),
  true, 'the copy keeps style and weeks but never the admin flags');

select is(
  (select string_agg(e.circuit::text || ':' || e.set_type, ',' order by e.position)
     from public.program_exercises e
     join public.program_days d on d.id = e.program_day_id
     join public.programs p on p.id = d.program_id
     where p.client_id = 'a3000000-0000-0000-0000-000000000002'),
  '1:normal,1:amrap', 'the copy keeps the superset and each set type');

-- ---------- duplicating an exercise ----------
select throws_ok(
  $$ select public.duplicate_program_exercise('e3000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'a stranger cannot duplicate an exercise in someone else''s routine');

select pg_temp.authenticate_as('a3000000-0000-0000-0000-000000000004');
select throws_ok(
  $$ select public.duplicate_program_exercise('e3000000-0000-0000-0000-000000000004') $$,
  '42501', null, 'a coached client cannot change the program their coach assigned');

select pg_temp.authenticate_as('a3000000-0000-0000-0000-000000000001');
select lives_ok(
  $$ select public.duplicate_program_exercise('e3000000-0000-0000-0000-000000000001') $$,
  'the owner duplicates an exercise');

select is(
  (select string_agg(position::text || ':' || set_type, ',' order by position)
     from public.program_exercises where program_day_id = 'd3000000-0000-0000-0000-000000000001'),
  '0:normal,1:normal,2:amrap', 'the copy lands right after its source and the rest move down one');

-- ---------- the flag follows visibility ----------
update public.programs set visibility = 'private' where id = 'c3000000-0000-0000-0000-000000000001';
reset role;
select is(
  (select featured_at is null from public.programs where id = 'c3000000-0000-0000-0000-000000000001'),
  true, 'making a featured routine private drops the feature');

-- ---------- usage ----------
select pg_temp.authenticate_as('a3000000-0000-0000-0000-000000000001');
insert into public.program_saves (user_id, program_id) values
  ('a3000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-000000000001');
select is(
  (select saves from public.program_usage('c3000000-0000-0000-0000-000000000001')),
  1, 'usage reports how many people saved it — a count, never who');

-- ---------- history never moves ----------
reset role;
insert into public.logged_sessions (id, user_id, program_day_id, client_generated_id, started_at, completed_at) values
  ('f3000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-000000000001',
   'f3000000-0000-0000-0000-0000000000a1', now() - interval '1 day', now() - interval '1 day');
insert into public.logged_sets (session_id, user_id, exercise_id, program_exercise_id, client_generated_id, set_index, reps, weight_kg) values
  ('f3000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000001', 'b3000000-0000-0000-0000-000000000002',
   'e3000000-0000-0000-0000-000000000002', 'f3000000-0000-0000-0000-0000000000b1', 1, 10, 60.00);

select pg_temp.authenticate_as('a3000000-0000-0000-0000-000000000001');
delete from public.program_exercises where id = 'e3000000-0000-0000-0000-000000000002';
update public.program_exercises set target_reps = '3' where program_day_id = 'd3000000-0000-0000-0000-000000000001';

select is(
  (select reps || ' x ' || weight_kg::text || ' ' || coalesce(program_exercise_id::text, 'unlinked')
     from public.logged_sets where client_generated_id = 'f3000000-0000-0000-0000-0000000000b1'),
  '10 x 60.00 unlinked', 'editing and deleting the prescription leaves the logged set exactly as lifted');

select is(
  (select count(*)::int from public.logged_sessions where id = 'f3000000-0000-0000-0000-000000000001' and program_day_id is not null),
  1, 'and the session still belongs to its day');

select * from finish();
rollback;
