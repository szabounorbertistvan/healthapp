-- pgTAP · Block on the boards (20261010100000_social_safety_boards.sql)
--
-- Four people train, join one challenge, and only then does a block happen —
-- the order it happens in real life. The questions: who each of them is
-- shown, and that nothing about the scoring moved for anyone.
--
-- Run with a local stack up:  npm run db:test
-- Or without Docker:          npm run db:test:offline

begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

create or replace function pg_temp.authenticate_as(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$fn$;

-- the workouts board as the caller sees it: "username:rank:score", in order
create or replace function pg_temp.board()
returns text language sql as $fn$
  select string_agg(username || ':' || rank || ':' || score::int, ',' order by rank)
  from public.social_leaderboard('workouts', 'all', 'global', 10);
$fn$;
-- the challenge's ranking as the caller sees it: "username:rank:value"
create or replace function pg_temp.cboard()
returns text language sql as $fn$
  select string_agg(username || ':' || rank || ':' || value::int, ',' order by rank, username)
  from public.challenge_leaderboard('d4000000-0000-0000-0000-000000000001', 10);
$fn$;

-- ---------- people, training, a challenge ----------
-- B trains 5 times, C 4, A 3, D 2. K coaches B and D.
insert into auth.users (id, email, raw_user_meta_data) values
  ('d1000000-0000-0000-0000-00000000000a', 'a@bd.test', '{"full_name":"Ana","username":"anabd"}'),
  ('d1000000-0000-0000-0000-00000000000b', 'b@bd.test', '{"full_name":"Bogdan","username":"bogdanbd"}'),
  ('d1000000-0000-0000-0000-00000000000c', 'c@bd.test', '{"full_name":"Cara","username":"carabd"}'),
  ('d1000000-0000-0000-0000-00000000000d', 'd@bd.test', '{"full_name":"Dan","username":"danbd"}'),
  ('d1000000-0000-0000-0000-0000000000cc', 'k@bd.test', '{"full_name":"Coach","username":"coachbd","role":"coach"}');
update public.users set leaderboard_visibility = 'public'
  where id in ('d1000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-00000000000b',
               'd1000000-0000-0000-0000-00000000000c', 'd1000000-0000-0000-0000-00000000000d');
insert into public.trainer_clients (coach_id, client_id, status, started_at) values
  ('d1000000-0000-0000-0000-0000000000cc', 'd1000000-0000-0000-0000-00000000000b', 'active', now()),
  ('d1000000-0000-0000-0000-0000000000cc', 'd1000000-0000-0000-0000-00000000000d', 'active', now());

insert into public.logged_sessions (user_id, client_generated_id, started_at, completed_at)
select u.id, gen_random_uuid(), now() - make_interval(hours => 2 + g), now() - make_interval(hours => 1 + g)
from (values ('d1000000-0000-0000-0000-00000000000b'::uuid, 5), ('d1000000-0000-0000-0000-00000000000c'::uuid, 4),
             ('d1000000-0000-0000-0000-00000000000a'::uuid, 3), ('d1000000-0000-0000-0000-00000000000d'::uuid, 2)) u(id, n)
cross join lateral generate_series(0, u.n - 1) g;

insert into public.challenges (id, title_en, title_ro, type, target_value, start_date, end_date, visibility, exercise_id, creator_id)
values ('d4000000-0000-0000-0000-000000000001', 'Ten workouts', 'Zece antrenamente', 'workouts', 10,
        current_date - 10, current_date + 10, 'public', null, null);
insert into public.challenge_participants (challenge_id, user_id)
select 'd4000000-0000-0000-0000-000000000001', id from public.users
where id in ('d1000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-00000000000b',
             'd1000000-0000-0000-0000-00000000000c', 'd1000000-0000-0000-0000-00000000000d');

-- ---------- before any block ----------
select pg_temp.authenticate_as('d1000000-0000-0000-0000-00000000000a');
select is(pg_temp.board(), 'bogdanbd:1:5,carabd:2:4,anabd:3:3,danbd:4:2', 'the board before any block');
select is(pg_temp.cboard(), 'bogdanbd:1:5,carabd:2:4,anabd:3:3,danbd:4:2', 'the challenge ranking before any block');

-- ---------- A blocks B, after everyone joined and trained ----------
select public.social_block_user('d1000000-0000-0000-0000-00000000000b');

select is(pg_temp.board(), 'carabd:2:4,anabd:3:3,danbd:4:2',
  'A no longer sees B on the board; everyone else keeps their rank and score');
select is(pg_temp.cboard(), 'carabd:2:4,anabd:3:3,danbd:4:2',
  'nor in the challenge ranking — ranks unchanged, not recomputed over who is left');
select is((select distinct participant_count from public.challenge_leaderboard('d4000000-0000-0000-0000-000000000001', 10)), 4,
  'the participant count is the challenge''s, not the visible rows''');
select is((select value::int from public.challenge_cards('d4000000-0000-0000-0000-000000000001')), 3,
  'A''s own progress is untouched');
select is(
  (select string_agg(username, ',' order by rank) from public.social_leaderboard('workouts', 'all', 'global', 2)),
  'carabd,anabd', 'the top of a short board fills from the next visible rows');
select is(
  (select string_agg(username, ',' order by rank) from public.challenge_leaderboard('d4000000-0000-0000-0000-000000000001', 1)),
  'carabd,anabd', 'a one-row challenge board shows the first visible row, and the caller');
select is((select count(*)::int from public.challenge_participants where user_id = 'd1000000-0000-0000-0000-00000000000b'), 0,
  'B''s participant row cannot be read from the table either');
select throws_ok(
  $$ select public.challenge_value('d4000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-00000000000b') $$,
  '42501', null, 'nor B''s progress, asked for directly');
select is((select count(*)::int from public.social_profile('d1000000-0000-0000-0000-00000000000b') where not blocked), 0,
  'a profile link to B leads to the blocked page, not to B''s profile');

-- and the other way
select pg_temp.authenticate_as('d1000000-0000-0000-0000-00000000000b');
select is(pg_temp.board(), 'bogdanbd:1:5,carabd:2:4,danbd:4:2', 'B no longer sees A on the board — the block works both ways');
select is(pg_temp.cboard(), 'bogdanbd:1:5,carabd:2:4,danbd:4:2', '…nor in the challenge ranking');
select is((select count(*)::int from public.social_profile('d1000000-0000-0000-0000-00000000000a')), 0, 'A''s profile is absent to B');

-- a third person sees exactly what they saw before
select pg_temp.authenticate_as('d1000000-0000-0000-0000-00000000000c');
select is(pg_temp.board(), 'bogdanbd:1:5,carabd:2:4,anabd:3:3,danbd:4:2', 'C, blocked by nobody, sees the full board unchanged');
select is(pg_temp.cboard(), 'bogdanbd:1:5,carabd:2:4,anabd:3:3,danbd:4:2', '…and the full challenge ranking unchanged');

-- nothing about the scoring moved
reset role;
select set_config('request.jwt.claims', '', true);
select is(public.challenge_value('d4000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-00000000000b')::int, 5,
  'B''s own progress is still counted in full');
select is((select count(*)::int from public.challenge_participants where challenge_id = 'd4000000-0000-0000-0000-000000000001'), 4,
  'nobody left the challenge');

-- ---------- a coach's view of their clients ----------
select pg_temp.authenticate_as('d1000000-0000-0000-0000-00000000000b');
select public.social_block_user('d1000000-0000-0000-0000-0000000000cc');
select pg_temp.authenticate_as('d1000000-0000-0000-0000-0000000000cc');
select is((select string_agg(username, ',') from public.coach_challenge_progress()), 'danbd',
  'a client who blocked their coach leaves the coach''s challenge list; the other client stays');

-- ---------- unblock ----------
select pg_temp.authenticate_as('d1000000-0000-0000-0000-00000000000a');
select public.social_unblock_user('d1000000-0000-0000-0000-00000000000b');
select is(pg_temp.board(), 'bogdanbd:1:5,carabd:2:4,anabd:3:3,danbd:4:2', 'unblocked: the full board is back, exactly as it was');

-- ---------- no session ----------
select pg_temp.authenticate_as(null);
select is((select count(*)::int from public.challenge_leaderboard('d4000000-0000-0000-0000-000000000001', 10)), 0,
  'no session: a public challenge''s ranking is not readable');
select is((select count(*)::int from public.social_leaderboard('workouts', 'all', 'global', 10)), 0, 'no session: no board');
reset role;
set local role anon;
select throws_ok($$ select * from public.challenge_leaderboard('d4000000-0000-0000-0000-000000000001', 10) $$, '42501', null,
  'anonymous callers cannot call the challenge ranking');
select throws_ok($$ select * from public.social_leaderboard('workouts', 'all', 'global', 10) $$, '42501', null,
  '…nor the boards');
reset role;

select * from finish();
rollback;
