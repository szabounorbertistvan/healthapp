-- pgTAP · social feed: follows, post visibility, kudos, comments — and that
-- nobody can act in someone else's name.
--
-- Run with a local stack up:  npm run db:test

begin;
create extension if not exists pgtap with schema extensions;
select plan(39);

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
  ('a0000000-0000-0000-0000-00000000000a', 'alex@social.local',   '{"full_name":"Alex","username":"alex"}'),
  ('b0000000-0000-0000-0000-00000000000b', 'maria@social.local',  '{"full_name":"Maria D.","username":"maria"}'),
  ('c0000000-0000-0000-0000-00000000000c', 'stranger@social.local', '{"full_name":"Stranger","username":"stranger"}');

-- Alex follows Maria (fixture, as postgres)
insert into public.social_follows (follower_id, following_id) values
  ('a0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000b');

insert into public.social_posts (id, user_id, type, text, visibility) values
  ('90000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000b', 'text', 'public post', 'public'),
  ('90000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000b', 'text', 'followers post', 'followers'),
  ('90000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000b', 'text', 'private post', 'private');

-- ---------- follows ----------
select pg_temp.authenticate_as('c0000000-0000-0000-0000-00000000000c');
select lives_ok($$
  insert into public.social_follows (follower_id, following_id)
  values ('c0000000-0000-0000-0000-00000000000c', 'b0000000-0000-0000-0000-00000000000b')
$$, 'a user follows someone');
select throws_ok($$
  insert into public.social_follows (follower_id, following_id)
  values ('c0000000-0000-0000-0000-00000000000c', 'b0000000-0000-0000-0000-00000000000b')
$$, '23505', null, 'a duplicate follow is refused');
select throws_ok($$
  insert into public.social_follows (follower_id, following_id)
  values ('c0000000-0000-0000-0000-00000000000c', 'c0000000-0000-0000-0000-00000000000c')
$$, '23514', null, 'self-follow is refused');
select throws_ok($$
  insert into public.social_follows (follower_id, following_id)
  values ('a0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-00000000000c')
$$, '42501', null, 'nobody can create a follow on someone else''s behalf');
delete from public.social_follows where follower_id = 'c0000000-0000-0000-0000-00000000000c';
select is((select count(*)::int from public.social_follows where follower_id = 'c0000000-0000-0000-0000-00000000000c'),
  0, 'unfollow removes the row');

-- ---------- visibility ----------
select pg_temp.authenticate_as('c0000000-0000-0000-0000-00000000000c');
select is((select count(*)::int from public.social_posts), 1, 'a stranger sees only the public post');

select pg_temp.authenticate_as('a0000000-0000-0000-0000-00000000000a');
select is((select count(*)::int from public.social_posts), 2, 'a follower sees public + followers-only, not private');

select pg_temp.authenticate_as('b0000000-0000-0000-0000-00000000000b');
select is((select count(*)::int from public.social_posts), 3, 'the author sees all three');

-- ---------- feed ordering & pagination ----------
select pg_temp.authenticate_as('a0000000-0000-0000-0000-00000000000a');
select is((select count(*)::int from public.social_feed(20, null, null)), 2, 'the home feed carries own + followed posts the caller may see');
select is((select count(*)::int from public.social_feed(1, null, null)), 1, 'the page size is honoured');
select ok(
  (select bool_and(prev >= created_at) from (
     select created_at, lag(created_at) over (order by created_at desc) as prev
     from public.social_feed(20, null, null)) x where prev is not null) is distinct from false,
  'the feed is newest first');

-- ---------- posts ----------
select lives_ok($$
  insert into public.social_posts (user_id, type, text, visibility)
  values ('a0000000-0000-0000-0000-00000000000a', 'text', 'hello', 'followers')
$$, 'a user creates a text post');
select lives_ok($$
  insert into public.social_posts (user_id, type, payload, visibility)
  values ('a0000000-0000-0000-0000-00000000000a', 'workout',
          '{"kind":"workout","name":"Legs","date":"2026-09-12","duration_min":60,"exercises":3,"sets":10,"volume_kg":9586,"load":61,"prs":1}', 'public')
$$, 'a user creates a workout post from a snapshot');
select throws_ok($$
  insert into public.social_posts (user_id, type, text, visibility)
  values ('b0000000-0000-0000-0000-00000000000b', 'text', 'forged', 'public')
$$, '42501', null, 'nobody can create a post for another user');
select throws_ok($$
  insert into public.social_posts (user_id, type, text, visibility)
  values ('a0000000-0000-0000-0000-00000000000a', 'text', repeat('x', 501), 'public')
$$, '23514', null, 'post text is capped at 500 characters');
update public.social_posts set text = 'edited' where id = '90000000-0000-0000-0000-000000000001';
select is((select text from public.social_posts where id = '90000000-0000-0000-0000-000000000001'),
  'public post', 'updating another user''s post changes nothing (RLS filters it out)');

-- ---------- kudos ----------
-- Alex (follows Maria) on Maria's public post.
-- created_at is spelled out because every row in this file is written inside
-- one transaction, where now() is the same instant for all of them: the givers
-- would tie and `order by created_at` — what the feed names them by — would be
-- free to return either order. In the app each kudos is its own transaction.
select lives_ok($$
  insert into public.social_reactions (post_id, user_id, created_at)
  values ('90000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', now() - interval '1 minute')
$$, 'kudos on a visible public post');
select throws_ok($$
  insert into public.social_reactions (post_id, user_id)
  values ('90000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a')
$$, '23505', null, 'duplicate kudos is refused');
select lives_ok($$
  insert into public.social_reactions (post_id, user_id)
  values ('90000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-00000000000a')
$$, 'a follower gives kudos on a followers-only post');
select throws_ok($$
  insert into public.social_reactions (post_id, user_id)
  values ('90000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-00000000000a')
$$, '42501', null, 'kudos on a private post you cannot see is refused');
select throws_ok($$
  insert into public.social_reactions (post_id, user_id)
  values ('90000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-00000000000c')
$$, '42501', null, 'nobody can give kudos in someone else''s name');
select is((select kudos_count from public.social_feed(20, null, null) where id = '90000000-0000-0000-0000-000000000001'),
  1, 'the feed counts the kudos');
select is((select my_kudos from public.social_feed(20, null, null) where id = '90000000-0000-0000-0000-000000000001'),
  true, 'the feed knows the caller gave it');
select is((select kudos_names from public.social_feed(20, null, null) where id = '90000000-0000-0000-0000-000000000001'),
  array['alex'], 'the feed names the giver');
select is((select count(*)::int from public.social_post_kudos('90000000-0000-0000-0000-000000000001', 20, null)),
  1, 'the kudos list shows who gave it');

-- a stranger: public yes, followers-only no
select pg_temp.authenticate_as('c0000000-0000-0000-0000-00000000000c');
select throws_ok($$
  insert into public.social_reactions (post_id, user_id)
  values ('90000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-00000000000c')
$$, '42501', null, 'a non-follower cannot give kudos on a followers-only post');
select lives_ok($$
  insert into public.social_reactions (post_id, user_id)
  values ('90000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-00000000000c')
$$, 'a stranger gives kudos on a public post');
select is((select count(*)::int from public.social_post_kudos('90000000-0000-0000-0000-000000000002', 20, null)),
  0, 'the kudos list of a post you cannot see is empty');
select is((select kudos_names from public.social_feed(20, null, 'b0000000-0000-0000-0000-00000000000b') where id = '90000000-0000-0000-0000-000000000001'),
  array['alex', 'stranger'], 'the feed names the first two givers in order');

-- the author: no self-kudos, but the notification arrived
select pg_temp.authenticate_as('b0000000-0000-0000-0000-00000000000b');
select throws_ok($$
  insert into public.social_reactions (post_id, user_id)
  values ('90000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000b')
$$, '42501', null, 'self-kudos is refused');
select is((select count(*)::int from public.notifications
           where user_id = 'b0000000-0000-0000-0000-00000000000b' and category = 'new_kudos'
             and payload ->> 'post_id' = '90000000-0000-0000-0000-000000000001'),
  2, 'the author gets one new_kudos notification per giver');

-- taking it back, and the deleted post
select pg_temp.authenticate_as('c0000000-0000-0000-0000-00000000000c');
delete from public.social_reactions
  where post_id = '90000000-0000-0000-0000-000000000001' and user_id = 'a0000000-0000-0000-0000-00000000000a';
select is((select count(*)::int from public.social_reactions where post_id = '90000000-0000-0000-0000-000000000001'),
  2, 'another user cannot remove your kudos');
delete from public.social_reactions
  where post_id = '90000000-0000-0000-0000-000000000001' and user_id = 'c0000000-0000-0000-0000-00000000000c';
select is((select kudos_count from public.social_feed(20, null, 'b0000000-0000-0000-0000-00000000000b') where id = '90000000-0000-0000-0000-000000000001'),
  1, 'removing your kudos drops the count');
select lives_ok($$
  insert into public.social_reactions (post_id, user_id)
  values ('90000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-00000000000c')
$$, 'kudos can be given again after being taken back');
select pg_temp.authenticate_as('b0000000-0000-0000-0000-00000000000b');
select is((select count(*)::int from public.notifications
           where user_id = 'b0000000-0000-0000-0000-00000000000b' and category = 'new_kudos'
             and payload ->> 'post_id' = '90000000-0000-0000-0000-000000000001'),
  2, 'giving kudos again does not notify the author twice');

-- ---------- comments ----------
-- Before the delete below, on purpose: a soft delete is one way under RLS.
-- The author's own `update ... set deleted_at = null` reads the row through
-- the SELECT policy (can_see_post), which hides deleted posts, so nothing
-- brings post 1 back — and a comment needs a post you can see.
select pg_temp.authenticate_as('a0000000-0000-0000-0000-00000000000a');
insert into public.social_comments (id, post_id, user_id, body) values
  ('70000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-00000000000a', 'nice one');
select pg_temp.authenticate_as('c0000000-0000-0000-0000-00000000000c');
delete from public.social_comments where id = '70000000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.social_comments where id = '70000000-0000-0000-0000-000000000001'),
  1, 'another user cannot delete your comment');
select pg_temp.authenticate_as('a0000000-0000-0000-0000-00000000000a');
delete from public.social_comments where id = '70000000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.social_comments where id = '70000000-0000-0000-0000-000000000001'),
  0, 'the author deletes their own comment');

-- ---------- the deleted post ----------
select pg_temp.authenticate_as('b0000000-0000-0000-0000-00000000000b');
update public.social_posts set deleted_at = now() where id = '90000000-0000-0000-0000-000000000001';
select pg_temp.authenticate_as('a0000000-0000-0000-0000-00000000000a');
delete from public.social_reactions
  where post_id = '90000000-0000-0000-0000-000000000001' and user_id = 'a0000000-0000-0000-0000-00000000000a';
select throws_ok($$
  insert into public.social_reactions (post_id, user_id)
  values ('90000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a')
$$, '42501', null, 'kudos on a deleted post is refused');
select is((select count(*)::int from public.social_post_kudos('90000000-0000-0000-0000-000000000001', 20, null)),
  0, 'the kudos list of a deleted post is empty');

select * from finish();
rollback;
