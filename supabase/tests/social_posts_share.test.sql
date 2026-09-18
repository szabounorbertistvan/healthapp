-- pgTAP · sharing to the feed: an insert that asks for its row back.
--
-- The app never inserts a post blind — it wants the id (insert … select id).
-- RETURNING runs the SELECT policy on the new row, so a policy that can only
-- see a post through a STABLE function (its own snapshot, no new row) refuses
-- the insert with 42501 while a bare insert sails through. This test asks
-- for the row back, exactly like the app, so that regression cannot return
-- unnoticed. Then the visibility rules for everyone else, unchanged.
--
-- Run with a local stack up:  npm run db:test

begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

create or replace function pg_temp.authenticate_as(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$fn$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-0000-0000-0000000000f1', 'author@share.local',   '{"full_name":"Author","username":"author"}'),
  ('b0000000-0000-0000-0000-0000000000f2', 'follower@share.local', '{"full_name":"Follower","username":"follower"}'),
  ('c0000000-0000-0000-0000-0000000000f3', 'stranger@share.local', '{"full_name":"Stranger","username":"stranger"}');

insert into public.social_follows (follower_id, following_id)
values ('b0000000-0000-0000-0000-0000000000f2', 'a0000000-0000-0000-0000-0000000000f1');

-- ---------- the author shares, and gets the row back ----------
select pg_temp.authenticate_as('a0000000-0000-0000-0000-0000000000f1');

select lives_ok($$
  insert into public.social_posts (id, user_id, type, text, payload, visibility)
  values ('90000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000000f1', 'text', 'followers only', null, 'followers')
  returning id
$$, 'a followers-only post can be inserted with RETURNING');

select lives_ok($$
  insert into public.social_posts (id, user_id, type, text, payload, visibility)
  values ('90000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-0000000000f1', 'text', 'only me', null, 'private')
  returning id
$$, 'a private post can be inserted with RETURNING');

select is((select count(*)::int from public.social_posts where user_id = 'a0000000-0000-0000-0000-0000000000f1'),
  2, 'the author reads both of their own posts back');

select throws_ok($$
  insert into public.social_posts (user_id, type, text, payload, visibility)
  values ('b0000000-0000-0000-0000-0000000000f2', 'text', 'as someone else', null, 'public')
$$, '42501', null, 'nobody can post as another user');

-- ---------- a follower ----------
select pg_temp.authenticate_as('b0000000-0000-0000-0000-0000000000f2');
select is((select count(*)::int from public.social_posts where user_id = 'a0000000-0000-0000-0000-0000000000f1'),
  1, 'a follower sees the followers-only post and not the private one');
select is((select count(*)::int from public.social_feed(20, null, null)),
  1, 'and the home feed carries it');

-- ---------- a stranger ----------
select pg_temp.authenticate_as('c0000000-0000-0000-0000-0000000000f3');
select is((select count(*)::int from public.social_posts where user_id = 'a0000000-0000-0000-0000-0000000000f1'),
  0, 'someone who does not follow the author sees neither');
select is((select count(*)::int from public.social_feed(20, null, null)),
  0, 'and their feed is empty');

select * from finish();
rollback;
