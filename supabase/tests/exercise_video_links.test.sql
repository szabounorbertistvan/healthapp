-- pgTAP · exercise_video_links: anyone pins a YouTube id to any exercise; the
-- owner and the other side of an active coaching relationship can read it;
-- nobody writes on someone else's behalf; only a bare video id is stored.
--
-- Run with a local stack up:  npm run db:test

begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

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
  ('33333333-3333-3333-3333-333333333333', 'andrei@evl.local', '{"full_name":"Andrei P."}');
update public.users set role = 'coach' where id = '11111111-1111-1111-1111-111111111111';
insert into public.trainer_clients (coach_id, client_id, status, started_at) values
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'active', now());

-- A shared library row: owner_id null, which exercises.video_url never let anyone annotate.
insert into public.exercises (id, source, external_id, owner_id, name_en) values
  ('e0000000-0000-0000-0000-000000000001', 'free-exercise-db', 'evl_squat', null, 'Barbell Squat');

-- ---------- writes ----------
select pg_temp.authenticate_as('11111111-1111-1111-1111-111111111111');
select lives_ok($$
  insert into public.exercise_video_links (user_id, exercise_id, video_id)
  values ('11111111-1111-1111-1111-111111111111', 'e0000000-0000-0000-0000-000000000001', 'dQw4w9WgXcQ')
$$, 'a coach pins a video to a shared library exercise');
select throws_ok($$
  insert into public.exercise_video_links (user_id, exercise_id, video_id)
  values ('11111111-1111-1111-1111-111111111111', 'e0000000-0000-0000-0000-000000000001', 'aaaaaaaaaaa')
$$, '23505', null, 'one link per person per exercise');

select pg_temp.authenticate_as('33333333-3333-3333-3333-333333333333');
select lives_ok($$
  insert into public.exercise_video_links (user_id, exercise_id, video_id)
  values ('33333333-3333-3333-3333-333333333333', 'e0000000-0000-0000-0000-000000000001', 'M7lc1UVf-VE')
$$, 'a client with no coach pins their own video too');
select throws_ok($$
  insert into public.exercise_video_links (user_id, exercise_id, video_id)
  values ('33333333-3333-3333-3333-333333333333', 'e0000000-0000-0000-0000-000000000001', 'https://evil')
$$, '23514', null, 'only a bare 11-char YouTube id is accepted');
select throws_ok($$
  insert into public.exercise_video_links (user_id, exercise_id, video_id)
  values ('22222222-2222-2222-2222-222222222222', 'e0000000-0000-0000-0000-000000000001', 'M7lc1UVf-VE')
$$, '42501', null, 'nobody pins a video on someone else''s behalf');
select is(
  (select count(*)::int from public.exercise_video_links),
  1, 'an unconnected user sees only their own link');

-- ---------- reads across the relationship ----------
select pg_temp.authenticate_as('22222222-2222-2222-2222-222222222222');
select is(
  (select video_id from public.exercise_video_links where user_id = '11111111-1111-1111-1111-111111111111'),
  'dQw4w9WgXcQ', 'the client sees the video their active coach picked');
select is(
  (select count(*)::int from public.exercise_video_links where user_id = '33333333-3333-3333-3333-333333333333'),
  0, 'the client does not see a stranger''s link');

reset role;
update public.trainer_clients set status = 'ended'
  where client_id = '22222222-2222-2222-2222-222222222222';
select pg_temp.authenticate_as('22222222-2222-2222-2222-222222222222');
select is(
  (select count(*)::int from public.exercise_video_links),
  0, 'ending the relationship hides the coach''s links');

select * from finish();
rollback;
