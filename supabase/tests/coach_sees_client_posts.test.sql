-- pgTAP · a coach reads their active clients' posts, and stops when the
-- relationship ends.
--
-- The feed was built on one relationship, social_follows. Coaching granted
-- nothing there, so a client's 'followers' post never reached their coach.
-- 20260921100000 added is_active_coach_of() to that branch. What must hold:
--
--   * the coach sees 'public' and 'followers', through both the table and
--     social_feed(p_author)
--   * 'private' stays the author's alone — coaching is not a master key
--   * access follows the relationship: ending it takes the posts away
--   * nothing leaks sideways: another coach's client is still a stranger
--   * the coach's own home feed does not fill up with client activity
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

insert into auth.users (id, email, raw_user_meta_data) values
  ('c0000000-0000-0000-0000-0000000000c1', 'coach@csp.local',   '{"full_name":"Coach CSP","username":"coachcsp","role":"coach"}'),
  ('c0000000-0000-0000-0000-0000000000c2', 'other@csp.local',   '{"full_name":"Other CSP","username":"othercsp","role":"coach"}'),
  ('a0000000-0000-0000-0000-0000000000a1', 'client@csp.local',  '{"full_name":"Client CSP","username":"clientcsp"}'),
  ('a0000000-0000-0000-0000-0000000000a2', 'theirs@csp.local',  '{"full_name":"Theirs CSP","username":"theirscsp"}');

-- Coach 1 trains client 1; coach 2 trains client 2. Nobody follows anybody:
-- the whole point is that coaching alone has to carry it.
insert into public.trainer_clients (coach_id, client_id, status, started_at) values
  ('c0000000-0000-0000-0000-0000000000c1', 'a0000000-0000-0000-0000-0000000000a1', 'active', now()),
  ('c0000000-0000-0000-0000-0000000000c2', 'a0000000-0000-0000-0000-0000000000a2', 'active', now());

insert into public.social_posts (id, user_id, type, text, payload, visibility) values
  ('50000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a1', 'text', 'followers post', null, 'followers'),
  ('50000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-0000000000a1', 'text', 'public post',    null, 'public'),
  ('50000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-0000000000a1', 'text', 'private post',   null, 'private'),
  ('50000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-0000000000a2', 'text', 'not yours',      null, 'followers');

-- ---------- the client's own coach ----------
select pg_temp.authenticate_as('c0000000-0000-0000-0000-0000000000c1');

select is((select count(*)::int from public.social_posts where user_id = 'a0000000-0000-0000-0000-0000000000a1'),
  2, 'the coach reads the public and the followers post, not the private one');

select ok(public.can_see_post('50000000-0000-0000-0000-000000000001'),
  'can_see_post says yes to the followers post');
select ok(not public.can_see_post('50000000-0000-0000-0000-000000000003'),
  'and no to the private one — coaching is not a master key');

select is((select count(*)::int from public.social_feed(20, null, 'a0000000-0000-0000-0000-0000000000a1')),
  2, 'the client feed on the coach side carries the same two');

-- The coach follows nobody and posted nothing, so their own home feed is
-- still empty: client activity does not bleed into it.
select is((select count(*)::int from public.social_feed(20, null, null)),
  0, 'the home feed stays mine + people I follow');

-- ---------- another coach's client ----------
select is((select count(*)::int from public.social_posts where user_id = 'a0000000-0000-0000-0000-0000000000a2'),
  0, 'someone else''s client is still a stranger');

-- ---------- the relationship ends ----------
set local role postgres;
update public.trainer_clients set status = 'ended', ended_at = now()
where coach_id = 'c0000000-0000-0000-0000-0000000000c1'
  and client_id = 'a0000000-0000-0000-0000-0000000000a1';

select pg_temp.authenticate_as('c0000000-0000-0000-0000-0000000000c1');
select is((select count(*)::int from public.social_posts where user_id = 'a0000000-0000-0000-0000-0000000000a1'),
  1, 'after it ends only the public post remains');
select ok(not public.can_see_post('50000000-0000-0000-0000-000000000001'),
  'the followers post is gone with the relationship');

-- ---------- one direction only ----------
-- The client gains nothing over their coach from this change.
set local role postgres;
insert into public.social_posts (id, user_id, type, text, payload, visibility)
values ('50000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-0000000000c2', 'text', 'coach post', null, 'followers');

select pg_temp.authenticate_as('a0000000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from public.social_posts where user_id = 'c0000000-0000-0000-0000-0000000000c2'),
  0, 'a client does not gain sight of their coach''s followers-only posts');

select * from finish();
rollback;
