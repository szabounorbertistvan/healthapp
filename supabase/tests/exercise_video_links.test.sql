-- pgTAP · exercise videos: only an admin sets the demo of an official library
-- exercise, only the owner that of a custom one; nobody makes a personal link
-- (exercise_video_links) any more, but an old one can still be removed and is
-- still read across an active coaching relationship; only a bare video id is
-- stored in a link.
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

-- ---------- fixtures ----------
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'coach@evl.local',  '{"full_name":"Coach Alex"}'),
  ('22222222-2222-2222-2222-222222222222', 'maria@evl.local',  '{"full_name":"Maria D."}'),
  ('33333333-3333-3333-3333-333333333333', 'andrei@evl.local', '{"full_name":"Andrei P."}'),
  ('44444444-4444-4444-4444-444444444444', 'admin@evl.local',  '{"full_name":"Admin"}');
update public.users set role = 'coach' where id = '11111111-1111-1111-1111-111111111111';
update public.users set role = 'admin' where id = '44444444-4444-4444-4444-444444444444';
insert into public.trainer_clients (coach_id, client_id, status, started_at) values
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'active', now());

insert into public.exercises (id, source, external_id, owner_id, name_en) values
  ('e0000000-0000-0000-0000-000000000001', 'free-exercise-db', 'evl_squat', null, 'Barbell Squat'),
  ('e0000000-0000-0000-0000-000000000002', 'custom', 'evl_andrei_row', '33333333-3333-3333-3333-333333333333', 'Andrei''s Row');

-- Links as they could exist from before 20260925.
insert into public.exercise_video_links (user_id, exercise_id, video_id) values
  ('11111111-1111-1111-1111-111111111111', 'e0000000-0000-0000-0000-000000000001', 'dQw4w9WgXcQ'),
  ('33333333-3333-3333-3333-333333333333', 'e0000000-0000-0000-0000-000000000001', 'M7lc1UVf-VE');

-- ---------- the official list ----------
select pg_temp.authenticate_as('11111111-1111-1111-1111-111111111111');
update public.exercises set video_url = 'https://youtu.be/aaaaaaaaaaa' where id = 'e0000000-0000-0000-0000-000000000001';
select pg_temp.authenticate_as('44444444-4444-4444-4444-444444444444');
select is(
  (select video_url from public.exercises where id = 'e0000000-0000-0000-0000-000000000001'),
  null, 'a coach cannot set the video of a library exercise');
update public.exercises set video_url = 'https://youtu.be/bbbbbbbbbbb' where id = 'e0000000-0000-0000-0000-000000000001';
select is(
  (select video_url from public.exercises where id = 'e0000000-0000-0000-0000-000000000001'),
  'https://youtu.be/bbbbbbbbbbb', 'an admin sets the video of a library exercise');

-- ---------- own exercises ----------
select pg_temp.authenticate_as('33333333-3333-3333-3333-333333333333');
update public.exercises set video_url = 'https://youtu.be/ccccccccccc' where id = 'e0000000-0000-0000-0000-000000000002';
select is(
  (select video_url from public.exercises where id = 'e0000000-0000-0000-0000-000000000002'),
  'https://youtu.be/ccccccccccc', 'a client sets the video of their own custom exercise');

-- ---------- personal links: no new ones ----------
select throws_ok($$
  insert into public.exercise_video_links (user_id, exercise_id, video_id)
  values ('33333333-3333-3333-3333-333333333333', 'e0000000-0000-0000-0000-000000000002', 'M7lc1UVf-VE')
$$, '42501', null, 'a client cannot make a personal link');
select pg_temp.authenticate_as('11111111-1111-1111-1111-111111111111');
select throws_ok($$
  update public.exercise_video_links set video_id = 'aaaaaaaaaaa'
  where user_id = '11111111-1111-1111-1111-111111111111'
$$, '42501', null, 'a coach cannot change an old link');

-- ---------- reads across the relationship ----------
select pg_temp.authenticate_as('22222222-2222-2222-2222-222222222222');
select is(
  (select video_id from public.exercise_video_links where user_id = '11111111-1111-1111-1111-111111111111'),
  'dQw4w9WgXcQ', 'the client still sees an old link of their active coach');
select is(
  (select count(*)::int from public.exercise_video_links where user_id = '33333333-3333-3333-3333-333333333333'),
  0, 'the client does not see a stranger''s link');

-- ---------- removing an old link ----------
select pg_temp.authenticate_as('33333333-3333-3333-3333-333333333333');
delete from public.exercise_video_links where user_id = '11111111-1111-1111-1111-111111111111';
delete from public.exercise_video_links where user_id = '33333333-3333-3333-3333-333333333333';
reset role;
select is(
  (select count(*)::int from public.exercise_video_links where user_id = '33333333-3333-3333-3333-333333333333'),
  0, 'the owner removes their old link');
select is(
  (select count(*)::int from public.exercise_video_links where user_id = '11111111-1111-1111-1111-111111111111'),
  1, 'nobody removes someone else''s');

update public.trainer_clients set status = 'ended'
  where client_id = '22222222-2222-2222-2222-222222222222';
select pg_temp.authenticate_as('22222222-2222-2222-2222-222222222222');
select is(
  (select count(*)::int from public.exercise_video_links),
  0, 'ending the relationship hides the coach''s links');

select * from finish();
rollback;
