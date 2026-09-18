-- pgTAP · deleting an account erases the account, and nothing else.
--
-- The dangerous half of a purge is not what it removes but what it takes with
-- it. A coach who leaves must not drag away the programs their clients still
-- train on, and a custom exercise sitting inside someone's program must not
-- break the delete either — program_exercises.exercise_id has no cascade, so
-- an owned exercise that is still referenced would abort the whole thing.
--
-- Run with a local stack up:  npm run db:test

begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email, raw_user_meta_data) values
  ('c0000000-0000-0000-0000-00000000000c', 'coach@purge.local',  '{"full_name":"Coach P","role":"coach"}'),
  ('c0000000-0000-0000-0000-000000000001', 'client@purge.local', '{"full_name":"Client P","role":"client"}');

update public.users set username = 'coachp' where id = 'c0000000-0000-0000-0000-00000000000c';

insert into public.trainer_clients (coach_id, client_id, status, started_at)
values ('c0000000-0000-0000-0000-00000000000c', 'c0000000-0000-0000-0000-000000000001', 'active', now());

-- The coach's own exercise, used inside the client's program: the case that
-- would make a naive delete fail on a foreign key.
insert into public.exercises (id, owner_id, source, name_en, primary_muscles)
values ('e0000000-0000-0000-0000-0000000000e1', 'c0000000-0000-0000-0000-00000000000c',
        'custom', 'Coach Special Row', '{"back"}');

insert into public.programs (id, coach_id, client_id, name, status)
values ('40000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-00000000000c',
        'c0000000-0000-0000-0000-000000000001', 'Client Program', 'published');
insert into public.program_days (id, program_id, week_index, day_index, name)
values ('4d000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 1, 1, 'Pull');
insert into public.program_exercises (program_day_id, exercise_id, position, target_sets, target_reps)
values ('4d000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-0000000000e1', 0, 3, '8');

-- ---------- request: hidden immediately ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-00000000000c","role":"authenticated"}';
select lives_ok($$ select public.request_account_deletion() $$, 'a signed-in user can request deletion');
reset role;

select is((select full_name from public.users where id = 'c0000000-0000-0000-0000-00000000000c'),
  'Deleted user', 'the name is anonymised at once');
select isnt((select username from public.users where id = 'c0000000-0000-0000-0000-00000000000c'),
  'coachp', 'the searchable username is replaced, not left behind');
select is((select status from public.trainer_clients
           where coach_id = 'c0000000-0000-0000-0000-00000000000c'),
  'ended', 'the coaching relationship ends at once');

-- ---------- purge: nothing happens before the window ----------
select is(public.purge_deleted_accounts(), 0, 'a fresh request is not purged yet');
select isnt((select count(*)::int from public.users where id = 'c0000000-0000-0000-0000-00000000000c'),
  0, 'the account still exists during the 30-day window');

-- ---------- purge: after the window ----------
update public.account_deletion_requests set purge_after = now() - interval '1 day'
where user_id = 'c0000000-0000-0000-0000-00000000000c';

select is(public.purge_deleted_accounts(), 1, 'an expired request is purged');
select is((select count(*)::int from public.users where id = 'c0000000-0000-0000-0000-00000000000c'),
  0, 'the account row is gone');

-- The whole point: the client keeps what they trained on.
select is((select count(*)::int from public.program_exercises
           where program_day_id = '4d000000-0000-0000-0000-000000000001'),
  1, "the client's program survives its coach's deletion");

select * from finish();
rollback;
