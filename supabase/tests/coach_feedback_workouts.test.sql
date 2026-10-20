-- pgTAP · a coach comments on a client's workout or one set (20261207110000):
-- only on that client's own rows, the client is notified, nobody else reads it,
-- the coach may take a comment back within a day.

begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

create or replace function pg_temp.authenticate_as(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$fn$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('fb000000-0000-0000-0000-000000000001', 'client@fb.local',   '{"full_name":"Client","username":"fb_client"}'),
  ('fb000000-0000-0000-0000-000000000002', 'other@fb.local',    '{"full_name":"Other","username":"fb_other"}'),
  ('fb000000-0000-0000-0000-000000000003', 'coach@fb.local',    '{"full_name":"Coach","username":"fb_coach"}'),
  ('fb000000-0000-0000-0000-000000000004', 'stranger@fb.local', '{"full_name":"Stranger","username":"fb_stranger"}');
update public.users set role = 'coach'
 where id in ('fb000000-0000-0000-0000-000000000003', 'fb000000-0000-0000-0000-000000000004');
insert into public.trainer_clients (coach_id, client_id, status, started_at) values
  ('fb000000-0000-0000-0000-000000000003', 'fb000000-0000-0000-0000-000000000001', 'active', now());

insert into public.exercises (id, source, name_en) values ('fb000000-0000-0000-0000-0000000000e1', 'free-exercise-db', 'Squat');
insert into public.logged_sessions (id, user_id, client_generated_id, started_at, completed_at) values
  ('fb000000-0000-0000-0000-0000000000a1', 'fb000000-0000-0000-0000-000000000001', 'fb000000-0000-0000-0000-0000000000a1', now() - interval '1 hour', now()),
  ('fb000000-0000-0000-0000-0000000000a2', 'fb000000-0000-0000-0000-000000000002', 'fb000000-0000-0000-0000-0000000000a2', now() - interval '1 hour', now());
insert into public.logged_sets (id, session_id, user_id, exercise_id, client_generated_id, set_index, reps, weight_kg) values
  ('fb000000-0000-0000-0000-0000000000b1', 'fb000000-0000-0000-0000-0000000000a1', 'fb000000-0000-0000-0000-000000000001',
   'fb000000-0000-0000-0000-0000000000e1', 'fb000000-0000-0000-0000-0000000000b1', 1, 5, 100);

select pg_temp.authenticate_as('fb000000-0000-0000-0000-000000000003');

-- 1-2  the coach comments on the client's session and on one set
select lives_ok($$
  insert into public.coach_feedback (id, coach_id, client_id, reference_type, reference_id, body)
  values ('fb000000-0000-0000-0000-0000000000f1', 'fb000000-0000-0000-0000-000000000003', 'fb000000-0000-0000-0000-000000000001',
          'session', 'fb000000-0000-0000-0000-0000000000a1', '  Great depth today  ')
$$, 'the active coach comments on the client''s session');
select lives_ok($$
  insert into public.coach_feedback (coach_id, client_id, reference_type, reference_id, body)
  values ('fb000000-0000-0000-0000-000000000003', 'fb000000-0000-0000-0000-000000000001',
          'set', 'fb000000-0000-0000-0000-0000000000b1', 'Keep the chest up here')
$$, 'the active coach comments on one of the client''s sets');

-- 3  the body is trimmed
select is((select body from public.coach_feedback where id = 'fb000000-0000-0000-0000-0000000000f1'), 'Great depth today',
  'the comment is stored trimmed');

-- 4-6  the reference must be this client's
select throws_ok($$
  insert into public.coach_feedback (coach_id, client_id, reference_type, reference_id, body)
  values ('fb000000-0000-0000-0000-000000000003', 'fb000000-0000-0000-0000-000000000001',
          'session', 'fb000000-0000-0000-0000-0000000000a2', 'not theirs')
$$, '23503', null, 'a session of someone else is refused even under the client''s id');
select throws_ok($$
  insert into public.coach_feedback (coach_id, client_id, reference_type, reference_id, body)
  values ('fb000000-0000-0000-0000-000000000003', 'fb000000-0000-0000-0000-000000000001',
          'set', gen_random_uuid(), 'nothing')
$$, '23503', null, 'a reference that does not exist is refused');
select throws_ok($$
  insert into public.coach_feedback (coach_id, client_id, reference_type, reference_id, body)
  values ('fb000000-0000-0000-0000-000000000003', 'fb000000-0000-0000-0000-000000000001',
          'session', 'fb000000-0000-0000-0000-0000000000a1', '   ')
$$, '23514', null, 'an empty comment is refused');

-- 7  a coach who is not theirs cannot comment
select pg_temp.authenticate_as('fb000000-0000-0000-0000-000000000004');
select throws_ok($$
  insert into public.coach_feedback (coach_id, client_id, reference_type, reference_id, body)
  values ('fb000000-0000-0000-0000-000000000004', 'fb000000-0000-0000-0000-000000000001',
          'session', 'fb000000-0000-0000-0000-0000000000a1', 'hi')
$$, '42501', null, 'another coach cannot comment on the client''s workout');
select is((select count(*)::int from public.coach_feedback), 0, 'another coach reads none of it');

-- 9-10  the client is notified (two comments, two notices) and reads both
reset role;
select is((select count(*)::int from public.notifications
            where user_id = 'fb000000-0000-0000-0000-000000000001' and category = 'coach_feedback'), 2,
  'the client gets one notice per comment');
select is((select payload ->> 'session_id' from public.notifications
            where user_id = 'fb000000-0000-0000-0000-000000000001' and category = 'coach_feedback'
              and payload ->> 'reference_type' = 'set'),
  'fb000000-0000-0000-0000-0000000000a1', 'a set comment''s notice points at its session');
select pg_temp.authenticate_as('fb000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.coach_feedback), 2, 'the client reads both comments');

-- 12  the client cannot delete them
delete from public.coach_feedback;
select is((select count(*)::int from public.coach_feedback), 2, 'the client cannot delete a coach''s comment');

-- 13-14  the coach takes one back within a day; an older one stays
select pg_temp.authenticate_as('fb000000-0000-0000-0000-000000000003');
delete from public.coach_feedback where id = 'fb000000-0000-0000-0000-0000000000f1';
select is((select count(*)::int from public.coach_feedback where id = 'fb000000-0000-0000-0000-0000000000f1'), 0,
  'the coach deletes their own fresh comment');
reset role;
update public.coach_feedback set created_at = now() - interval '2 days';
select pg_temp.authenticate_as('fb000000-0000-0000-0000-000000000003');
delete from public.coach_feedback;
select is((select count(*)::int from public.coach_feedback), 1, 'a comment older than a day is a record and stays');

select * from finish();
rollback;
