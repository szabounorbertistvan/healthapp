-- pgTAP · challenges: who sees what, who may join, and that the progress RPC
-- hands out rollups only for challenges the caller can see.
--
-- Run with a local stack up:  npm run db:test

begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

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
  ('11111111-1111-1111-1111-111111111111', 'coach@ch.local',  '{"full_name":"Coach Alex"}'),
  ('22222222-2222-2222-2222-222222222222', 'maria@ch.local',  '{"full_name":"Maria D."}'),
  ('33333333-3333-3333-3333-333333333333', 'andrei@ch.local', '{"full_name":"Andrei P."}'),
  ('44444444-4444-4444-4444-444444444444', 'other@ch.local',  '{"full_name":"Other Coach"}');
update public.users set role = 'coach'
where id in ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444');
insert into public.trainer_clients (coach_id, client_id, status, started_at) values
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'active', now());

-- the seed inserted four public platform challenges; add a private one of Maria's and an ended one
insert into public.challenges (id, title_en, title_ro, type, target_value, start_date, end_date, creator_id, visibility) values
  ('c0000000-0000-0000-0000-000000000001', 'Maria private', 'Maria privat', 'workouts', 5,
   current_date - 10, current_date + 10, '22222222-2222-2222-2222-222222222222', 'private'),
  ('c0000000-0000-0000-0000-000000000002', 'Ended', 'Încheiat', 'workouts', 5,
   current_date - 40, current_date - 10, null, 'public');

insert into public.challenge_participants (challenge_id, user_id) values
  ('c0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222');

-- one completed session for Maria inside the private challenge's window
insert into public.exercises (id, name_en, name_ro, source) values
  ('e0000000-0000-0000-0000-000000000001', 'Squat', 'Genuflexiuni', 'custom');
insert into public.logged_sessions (id, user_id, started_at, completed_at, client_generated_id) values
  ('a0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   now() - interval '2 days', now() - interval '2 days' + interval '50 minutes', gen_random_uuid());
insert into public.logged_sets (session_id, user_id, exercise_id, set_index, reps, weight_kg, rpe, client_generated_id) values
  ('a0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   'e0000000-0000-0000-0000-000000000001', 1, 8, 80, 8, gen_random_uuid());

-- ---------- visibility ----------
select pg_temp.authenticate_as('33333333-3333-3333-3333-333333333333');
select is(
  (select count(*)::int from public.challenges where visibility = 'public'),
  5, 'anyone signed in sees every public challenge');
select is(
  (select count(*)::int from public.challenges where id = 'c0000000-0000-0000-0000-000000000001'),
  0, 'an unrelated client does not see a private challenge');

select pg_temp.authenticate_as('11111111-1111-1111-1111-111111111111');
select is(
  (select count(*)::int from public.challenges where id = 'c0000000-0000-0000-0000-000000000001'),
  1, 'the active coach of a participant sees their private challenge');

select pg_temp.authenticate_as('44444444-4444-4444-4444-444444444444');
select is(
  (select count(*)::int from public.challenges where id = 'c0000000-0000-0000-0000-000000000001'),
  0, 'a coach with no relationship does not');

-- ---------- join / leave ----------
select pg_temp.authenticate_as('33333333-3333-3333-3333-333333333333');
select lives_ok($$
  insert into public.challenge_participants (challenge_id, user_id)
  select id, '33333333-3333-3333-3333-333333333333' from public.challenges where title_en = '10 Workouts'
$$, 'a client joins a public challenge');

select throws_ok($$
  insert into public.challenge_participants (challenge_id, user_id)
  values ('c0000000-0000-0000-0000-000000000002', '33333333-3333-3333-3333-333333333333')
$$, '42501', null, 'joining an ended challenge is refused by RLS');

select throws_ok($$
  insert into public.challenge_participants (challenge_id, user_id)
  select id, '22222222-2222-2222-2222-222222222222' from public.challenges where title_en = '10 Workouts'
$$, '42501', null, 'nobody can join on someone else''s behalf');

select throws_ok($$
  insert into public.challenge_participants (challenge_id, user_id)
  values ('c0000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333')
$$, '42501', null, 'a private challenge cannot be joined by an outsider');

delete from public.challenge_participants where user_id = '33333333-3333-3333-3333-333333333333';
select is(
  (select count(*)::int from public.challenge_participants where user_id = '33333333-3333-3333-3333-333333333333'),
  0, 'a client leaves a challenge by deleting their own row');

-- ---------- progress RPC ----------
select pg_temp.authenticate_as('22222222-2222-2222-2222-222222222222');
select is(
  (select count(*)::int from public.challenge_progress_rows('c0000000-0000-0000-0000-000000000001')
   where kind = 'session'),
  1, 'the RPC returns the participant''s own session rollup');
select is(
  (select volume_kg from public.challenge_progress_rows('c0000000-0000-0000-0000-000000000001')
   where kind = 'session'),
  640::numeric, 'the rollup carries volume (80 kg × 8)');

select pg_temp.authenticate_as('33333333-3333-3333-3333-333333333333');
select is(
  (select count(*)::int from public.challenge_progress_rows('c0000000-0000-0000-0000-000000000001')),
  0, 'the RPC returns nothing for a challenge the caller cannot see');

select * from finish();
rollback;
