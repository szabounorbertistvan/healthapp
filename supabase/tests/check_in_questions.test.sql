-- pgTAP · coach-written check-in questions and their answers (20261207120000)

begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

create or replace function pg_temp.authenticate_as(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$fn$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('c1000000-0000-0000-0000-000000000001', 'client@ciq.local',   '{"full_name":"Client","username":"ciq_client"}'),
  ('c1000000-0000-0000-0000-000000000002', 'client2@ciq.local',  '{"full_name":"Client2","username":"ciq_client2"}'),
  ('c1000000-0000-0000-0000-000000000003', 'coach@ciq.local',    '{"full_name":"Coach","username":"ciq_coach"}'),
  ('c1000000-0000-0000-0000-000000000004', 'stranger@ciq.local', '{"full_name":"Stranger","username":"ciq_stranger"}');
update public.users set role = 'coach'
 where id in ('c1000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000004');
insert into public.trainer_clients (coach_id, client_id, status, started_at) values
  ('c1000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000001', 'active', now()),
  ('c1000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000002', 'active', now());

select pg_temp.authenticate_as('c1000000-0000-0000-0000-000000000003');

-- 1-3  the coach writes questions for everyone and for one client
select lives_ok($$
  insert into public.check_in_questions (id, coach_id, prompt, kind, position) values
    ('c1000000-0000-0000-0000-0000000000a1', 'c1000000-0000-0000-0000-000000000003', '  Steps a day?  ', 'number', 0),
    ('c1000000-0000-0000-0000-0000000000a2', 'c1000000-0000-0000-0000-000000000003', 'Any pain this week?', 'yes_no', 1)
$$, 'the coach adds questions for all their clients');
select lives_ok($$
  insert into public.check_in_questions (id, coach_id, client_id, prompt, kind) values
    ('c1000000-0000-0000-0000-0000000000a3', 'c1000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000002', 'Knee 1-10?', 'scale')
$$, 'the coach adds a question for one client');
select throws_ok($$
  insert into public.check_in_questions (coach_id, client_id, prompt, kind) values
    ('c1000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000004', 'Not mine', 'text')
$$, '42501', null, 'a question for someone who is not their client is refused');
select is((select prompt from public.check_in_questions where id = 'c1000000-0000-0000-0000-0000000000a1'), 'Steps a day?',
  'the prompt is stored trimmed');

-- 5  the cap of 12 active questions
select throws_ok($$
  insert into public.check_in_questions (coach_id, prompt, kind)
  select 'c1000000-0000-0000-0000-000000000003', 'Q' || g, 'text' from generate_series(1, 10) g
$$, '23514', null, 'more than 12 active questions are refused');

-- 6-7  each client reads the questions meant for them
select pg_temp.authenticate_as('c1000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.check_in_questions), 2, 'client 1 sees the two shared questions');
select pg_temp.authenticate_as('c1000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.check_in_questions), 3, 'client 2 also sees their own question');

-- 8-11  client 1 answers with this week's check-in
select pg_temp.authenticate_as('c1000000-0000-0000-0000-000000000001');
insert into public.check_ins (id, user_id, week_start, sleep) values
  ('c1000000-0000-0000-0000-0000000000c1', 'c1000000-0000-0000-0000-000000000001', '2026-12-07', 7);
select lives_ok($$
  insert into public.check_in_answers (check_in_id, question_id, value_num) values
    ('c1000000-0000-0000-0000-0000000000c1', 'c1000000-0000-0000-0000-0000000000a1', 8500)
$$, 'the client answers a number question');
select throws_ok($$
  insert into public.check_in_answers (check_in_id, question_id, value_num) values
    ('c1000000-0000-0000-0000-0000000000c1', 'c1000000-0000-0000-0000-0000000000a2', 1)
$$, '23514', null, 'an answer of the wrong kind is refused');
select throws_ok($$
  insert into public.check_in_answers (check_in_id, question_id, value_num) values
    ('c1000000-0000-0000-0000-0000000000c1', 'c1000000-0000-0000-0000-0000000000a3', 5)
$$, '23503', null, 'a question meant for another client cannot be answered');
select is((select prompt from public.check_in_answers where question_id = 'c1000000-0000-0000-0000-0000000000a1'), 'Steps a day?',
  'the answer keeps a copy of the question''s words');

-- 12-13  the coach reads the answer; a stranger does not
select pg_temp.authenticate_as('c1000000-0000-0000-0000-000000000003');
select is((select value_num from public.check_in_answers), 8500.00::numeric(10,2), 'the coach reads the answer');
select pg_temp.authenticate_as('c1000000-0000-0000-0000-000000000004');
select is((select count(*)::int from public.check_in_answers), 0, 'another coach reads no answer');

-- 14-15  an answered question keeps its kind and cannot be deleted, only deactivated
select pg_temp.authenticate_as('c1000000-0000-0000-0000-000000000003');
select throws_ok($$ delete from public.check_in_questions where id = 'c1000000-0000-0000-0000-0000000000a1' $$,
  '23514', null, 'an answered question cannot be deleted');
select throws_ok($$ update public.check_in_questions set kind = 'text' where id = 'c1000000-0000-0000-0000-0000000000a1' $$,
  '23514', null, 'an answered question keeps its kind');

-- 16-17  deactivated: clients stop seeing it; once reviewed, answers are frozen
update public.check_in_questions set active = false where id = 'c1000000-0000-0000-0000-0000000000a1';
select pg_temp.authenticate_as('c1000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.check_in_questions), 1, 'a deactivated question disappears for the client');
reset role;
update public.check_ins set coach_reviewed_at = now() where id = 'c1000000-0000-0000-0000-0000000000c1';
select pg_temp.authenticate_as('c1000000-0000-0000-0000-000000000001');
update public.check_in_answers set value_num = 1;
select is((select value_num from public.check_in_answers), 8500.00::numeric(10,2), 'a reviewed check-in''s answers do not change');

select * from finish();
rollback;
