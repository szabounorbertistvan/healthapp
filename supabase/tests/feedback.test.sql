-- pgTAP · feedback: anyone signed in can send, nobody but an admin reads or
-- triages, and each account is capped at ten an hour.
--
-- Run with a local stack up:  npm run db:test

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

insert into auth.users (id, email, raw_user_meta_data) values
  ('c5000000-0000-0000-0000-000000000001', 'me@feedback.local',    '{"full_name":"Me","username":"me_feedback"}'),
  ('c5000000-0000-0000-0000-000000000002', 'admin@feedback.local', '{"full_name":"Admin","username":"admin_feedback"}');
update public.users set role = 'admin' where id = 'c5000000-0000-0000-0000-000000000002';

select pg_temp.authenticate_as('c5000000-0000-0000-0000-000000000001');

select lives_ok(
  $$ select public.submit_feedback('bug', 'The set logger jumps', '/workout', 'test-agent', 'ro') $$,
  'a signed-in user can send feedback');
select throws_ok(
  $$ select public.submit_feedback('bug', '   ') $$,
  '22023', 'FEEDBACK_EMPTY', 'an empty message is refused');
select throws_ok(
  $$ select public.submit_feedback('rant', 'hello') $$,
  '22023', 'FEEDBACK_KIND', 'an unknown kind is refused');
select throws_ok(
  $$ insert into public.feedback (user_id, kind, message) values ('c5000000-0000-0000-0000-000000000001', 'idea', 'x') $$,
  '42501', null, 'the table cannot be written directly');
select is((select count(*)::int from public.feedback), 0, 'the author cannot read feedback back');
select throws_ok(
  $$ select public.admin_feedback() $$,
  '42501', null, 'a non-admin cannot open the feedback page');

-- nine more reach the cap of ten; the eleventh is refused
select public.submit_feedback('idea', 'idea ' || g) from generate_series(1, 9) g;
select throws_ok(
  $$ select public.submit_feedback('idea', 'one too many') $$,
  'P0001', 'FEEDBACK_RATE', 'the eleventh message in an hour is refused');

select pg_temp.authenticate_as('c5000000-0000-0000-0000-000000000002');

select is((public.admin_feedback() -> 'stats' ->> 'new')::int, 10, 'an admin sees every message as new');
select lives_ok(
  $$ select public.admin_set_feedback_status(
       (select id from public.feedback where message = 'The set logger jumps'), 'done') $$,
  'an admin can mark an item done');
select is((select status from public.feedback where message = 'The set logger jumps'), 'done', 'the status sticks');

select * from finish();
rollback;
