-- pgTAP · Report / Mute / Block (20261007100000_social_block_mute_report.sql)
--
-- Every case is asked of the tables and RPCs directly, as the wrong person —
-- the UI hides nothing that the database would still hand over.
--
-- Run with a local stack up:  npm run db:test
-- Or without Docker:          npm run db:test:offline

begin;
create extension if not exists pgtap with schema extensions;
select plan(63);

create or replace function pg_temp.authenticate_as(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$fn$;

create or replace function pg_temp.follows(p_a uuid, p_b uuid)
returns int language sql stable security definer as $fn$
  select count(*)::int from public.social_follows
  where (follower_id = p_a and following_id = p_b) or (follower_id = p_b and following_id = p_a);
$fn$;

-- ---------- people ----------
-- A blocks B. A mutes M. C follows everyone and posts. S is suspended.
insert into auth.users (id, email, raw_user_meta_data) values
  ('1a000000-0000-0000-0000-00000000000a', 'a@bmr.test', '{"full_name":"Alpha","username":"alphabmr"}'),
  ('1a000000-0000-0000-0000-00000000000b', 'b@bmr.test', '{"full_name":"Bravo","username":"bravobmr"}'),
  ('1a000000-0000-0000-0000-00000000000c', 'c@bmr.test', '{"full_name":"Charlie","username":"charliebmr"}'),
  ('1a000000-0000-0000-0000-00000000000d', 'm@bmr.test', '{"full_name":"Mike","username":"mikebmr"}');

insert into public.social_follows (follower_id, following_id) values
  ('1a000000-0000-0000-0000-00000000000a', '1a000000-0000-0000-0000-00000000000b'),
  ('1a000000-0000-0000-0000-00000000000b', '1a000000-0000-0000-0000-00000000000a'),
  ('1a000000-0000-0000-0000-00000000000a', '1a000000-0000-0000-0000-00000000000d'),
  ('1a000000-0000-0000-0000-00000000000a', '1a000000-0000-0000-0000-00000000000c'),
  ('1a000000-0000-0000-0000-00000000000c', '1a000000-0000-0000-0000-00000000000b');

insert into public.social_posts (id, user_id, type, text, visibility, created_at) values
  ('1b000000-0000-0000-0000-00000000000a', '1a000000-0000-0000-0000-00000000000a', 'text', 'alpha public', 'public', now() - interval '1 hour'),
  ('1b000000-0000-0000-0000-0000000000a2', '1a000000-0000-0000-0000-00000000000a', 'text', 'alpha private', 'private', now() - interval '2 hours'),
  ('1b000000-0000-0000-0000-00000000000b', '1a000000-0000-0000-0000-00000000000b', 'text', 'bravo public', 'public', now() - interval '3 hours'),
  ('1b000000-0000-0000-0000-00000000000c', '1a000000-0000-0000-0000-00000000000c', 'text', 'charlie public', 'public', now() - interval '4 hours'),
  ('1b000000-0000-0000-0000-00000000000d', '1a000000-0000-0000-0000-00000000000d', 'text', 'mike public', 'public', now() - interval '5 hours');
insert into public.social_comments (id, post_id, user_id, body) values
  ('1c000000-0000-0000-0000-00000000000b', '1b000000-0000-0000-0000-00000000000c', '1a000000-0000-0000-0000-00000000000b', 'bravo on charlie'),
  ('1c000000-0000-0000-0000-00000000000a', '1b000000-0000-0000-0000-00000000000c', '1a000000-0000-0000-0000-00000000000a', 'alpha on charlie');
insert into public.social_stories (user_id, body) values
  ('1a000000-0000-0000-0000-00000000000b', 'bravo story'),
  ('1a000000-0000-0000-0000-00000000000d', 'mike story');
insert into public.social_post_saves (user_id, post_id) values
  ('1a000000-0000-0000-0000-00000000000a', '1b000000-0000-0000-0000-00000000000b');

-- ================= BLOCK =================
select pg_temp.authenticate_as('1a000000-0000-0000-0000-00000000000a');
select throws_ok($$ select public.social_block_user('1a000000-0000-0000-0000-00000000000a') $$,
  '22023', null, 'nobody can block themselves');
select throws_ok(
  $$ insert into public.social_user_blocks (blocker_id, blocked_id)
     values ('1a000000-0000-0000-0000-00000000000c', '1a000000-0000-0000-0000-00000000000b') $$,
  '42501', null, 'blocks are not written by hand — least of all on someone else''s behalf');
select throws_ok($$ select public.social_block_user('1a000000-0000-0000-0000-0000000000ff') $$,
  'P0002', null, 'blocking a user who does not exist is refused');

select lives_ok($$ select public.social_block_user('1a000000-0000-0000-0000-00000000000b') $$, 'A blocks B');
select lives_ok($$ select public.social_block_user('1a000000-0000-0000-0000-00000000000b') $$, 'blocking again is a quiet no-op');
select is((select count(*)::int from public.social_user_blocks), 1, 'one block row');
select is(pg_temp.follows('1a000000-0000-0000-0000-00000000000a', '1a000000-0000-0000-0000-00000000000b'), 0,
  'the follows between them, both ways, are gone');
select is(pg_temp.follows('1a000000-0000-0000-0000-00000000000a', '1a000000-0000-0000-0000-00000000000d'), 1,
  'A''s other follows are untouched');
select is(pg_temp.follows('1a000000-0000-0000-0000-00000000000c', '1a000000-0000-0000-0000-00000000000b'), 1,
  '…and so are other people''s follows of B');

-- what A sees of B
select is((select count(*)::int from public.social_feed(50, null, null, 'all') where user_id = '1a000000-0000-0000-0000-00000000000b'), 0,
  'A''s feed has none of B''s posts');
select is((select count(*)::int from public.social_post('1b000000-0000-0000-0000-00000000000b')), 0, 'nor B''s post by id');
select is((select count(*)::int from public.social_posts where id = '1b000000-0000-0000-0000-00000000000b'), 0,
  'nor the row, asked of the table directly');
select is(
  (select row(blocked, stats_visible, workouts, is_following)::text from public.social_profile('1a000000-0000-0000-0000-00000000000b')),
  '(t,f,,f)', 'A still reaches B''s profile, to unblock from — flagged, with nothing behind it');
select is((select count(*)::int from public.social_feed(50, null, '1a000000-0000-0000-0000-00000000000b')), 0,
  'and no posts on it');
select is((select count(*)::int from public.social_follow_list('1a000000-0000-0000-0000-00000000000b', 'followers', 50)), 0,
  'B''s lists are closed to A');
select is((select count(*)::int from public.social_follow_list('1a000000-0000-0000-0000-00000000000c', 'following', 50)
           where id = '1a000000-0000-0000-0000-00000000000b'), 0, 'B leaves other people''s lists, for A');
select is((select count(*)::int from public.social_search_users('bravo', null, 50)), 0, 'B is not found in People');
select is((select count(*)::int from public.social_suggested_people(20) where id = '1a000000-0000-0000-0000-00000000000b'), 0,
  'nor suggested');
select is((select count(*)::int from public.social_story_tray() where user_id = '1a000000-0000-0000-0000-00000000000b'), 0,
  'B''s stories leave A''s tray');
select is((select count(*)::int from public.social_user_stories('1a000000-0000-0000-0000-00000000000b')), 0,
  '…and cannot be asked for by id');
select is((select count(*)::int from public.social_post_comments('1b000000-0000-0000-0000-00000000000c')
           where user_id = '1a000000-0000-0000-0000-00000000000b'), 0, 'B''s comments leave the thread A reads');
select is(
  (select count(*)::int from public.social_feed(50, null, null, 'all') f, jsonb_array_elements(f.comment_preview) c
   where f.id = '1b000000-0000-0000-0000-00000000000c' and c ->> 'user_id' = '1a000000-0000-0000-0000-00000000000b'), 0,
  '…and the comment preview');
select is((select count(*)::int from public.social_saved_posts(50) where id = '1b000000-0000-0000-0000-00000000000b'), 0,
  'a post of B''s that A saved leaves the saved list');
select throws_ok(
  $$ insert into public.social_follows (follower_id, following_id)
     values ('1a000000-0000-0000-0000-00000000000a', '1a000000-0000-0000-0000-00000000000b') $$,
  '42501', null, 'A cannot follow B');
select throws_ok(
  $$ insert into public.social_posts (user_id, type, payload)
     values ('1a000000-0000-0000-0000-00000000000a', 'shared_post',
             '{"kind":"shared_post","original_post_id":"1b000000-0000-0000-0000-00000000000b"}') $$,
  'P0002', null, 'nor share B''s post');

-- and the other way: what B sees of A
select pg_temp.authenticate_as('1a000000-0000-0000-0000-00000000000b');
select is((select count(*)::int from public.social_feed(50, null, null, 'all') where user_id = '1a000000-0000-0000-0000-00000000000a'), 0,
  'the block works both ways: B does not see A''s posts');
select is((select count(*)::int from public.social_profile('1a000000-0000-0000-0000-00000000000a')), 0,
  'A''s profile reads as absent to B');
select is((select count(*)::int from public.social_user_blocks), 0, 'B cannot read that they are blocked');
select throws_ok(
  $$ insert into public.social_follows (follower_id, following_id)
     values ('1a000000-0000-0000-0000-00000000000b', '1a000000-0000-0000-0000-00000000000a') $$,
  '42501', null, 'B cannot follow A');
select throws_ok(
  $$ insert into public.social_comments (post_id, user_id, body)
     values ('1b000000-0000-0000-0000-00000000000a', '1a000000-0000-0000-0000-00000000000b', 'hi') $$,
  '42501', null, 'B cannot comment on A''s post');
select throws_ok(
  $$ insert into public.social_reactions (post_id, user_id) values ('1b000000-0000-0000-0000-00000000000a', '1a000000-0000-0000-0000-00000000000b') $$,
  '42501', null, 'B cannot give A kudos');
select throws_ok($$ select public.social_blocked_between('1a000000-0000-0000-0000-00000000000a', '1a000000-0000-0000-0000-00000000000b') $$,
  '42501', null, 'the block test is not callable directly — it would be an oracle');
select lives_ok($$ select public.social_unblock_user('1a000000-0000-0000-0000-00000000000a') $$,
  'B "unblocking" A removes nothing — only the blocker can');

select pg_temp.authenticate_as('1a000000-0000-0000-0000-00000000000a');
select is((select count(*)::int from public.social_user_blocks), 1, '…A''s block is still there');
select lives_ok($$ select public.social_unblock_user('1a000000-0000-0000-0000-00000000000b') $$, 'A unblocks B');
select is(pg_temp.follows('1a000000-0000-0000-0000-00000000000a', '1a000000-0000-0000-0000-00000000000b'), 0,
  'unblocking does not bring the follows back');
select is((select count(*)::int from public.social_feed(50, null, null, 'all') where user_id = '1a000000-0000-0000-0000-00000000000b'), 1,
  'B''s public post is back in A''s "all" feed');

-- ================= MUTE =================
select lives_ok(
  $$ insert into public.social_user_mutes (muter_id, muted_id)
     values ('1a000000-0000-0000-0000-00000000000a', '1a000000-0000-0000-0000-00000000000d') $$, 'A mutes M');
select throws_ok(
  $$ insert into public.social_user_mutes (muter_id, muted_id)
     values ('1a000000-0000-0000-0000-00000000000a', '1a000000-0000-0000-0000-00000000000d') $$,
  '23505', null, 'muting twice is impossible');
select throws_ok(
  $$ insert into public.social_user_mutes (muter_id, muted_id)
     values ('1a000000-0000-0000-0000-00000000000a', '1a000000-0000-0000-0000-00000000000a') $$,
  '23514', null, 'nobody mutes themselves');
select throws_ok(
  $$ insert into public.social_user_mutes (muter_id, muted_id)
     values ('1a000000-0000-0000-0000-00000000000c', '1a000000-0000-0000-0000-00000000000d') $$,
  '42501', null, 'nobody mutes on someone else''s behalf');
select is((select count(*)::int from public.social_feed(50) where user_id = '1a000000-0000-0000-0000-00000000000d'), 0,
  'M''s posts leave A''s home feed');
select is(
  (select row(count(*), bool_and(author_muted))::text from public.social_feed(50, null, '1a000000-0000-0000-0000-00000000000d')),
  '(1,t)', 'but stay on M''s profile, flagged as muted for the post menu');
select is((select row(muted, is_following)::text from public.social_profile('1a000000-0000-0000-0000-00000000000d')), '(t,t)',
  'the profile says muted — and A still follows M');
select is((select count(*)::int from public.social_story_tray() where user_id = '1a000000-0000-0000-0000-00000000000d'), 0,
  'M''s stories leave A''s tray');
select is((select count(*)::int from public.social_user_stories('1a000000-0000-0000-0000-00000000000d')), 1,
  '…but can still be opened from the profile');
select pg_temp.authenticate_as('1a000000-0000-0000-0000-00000000000d');
select is((select count(*)::int from public.social_user_mutes), 0, 'M cannot read that they are muted');
select pg_temp.authenticate_as('1a000000-0000-0000-0000-00000000000a');
delete from public.social_user_mutes where muted_id = '1a000000-0000-0000-0000-00000000000d';
select is((select count(*)::int from public.social_feed(50) where user_id = '1a000000-0000-0000-0000-00000000000d'), 1,
  'unmuted: M is back in the feed');

-- ================= REPORT =================
select pg_temp.authenticate_as('1a000000-0000-0000-0000-00000000000c');
select lives_ok($$ select public.social_report('post', '1b000000-0000-0000-0000-00000000000b', 'spam') $$, 'C reports B''s post');
select lives_ok($$ select public.social_report('post', '1b000000-0000-0000-0000-00000000000b', 'spam') $$,
  'reporting it again, for the same reason, is accepted…');
select lives_ok($$ select public.social_report('user', '1a000000-0000-0000-0000-00000000000b', 'other', '  keeps posting ads  ') $$,
  'C reports B the person, with details');
select throws_ok($$ select public.social_report('user', '1a000000-0000-0000-0000-00000000000c', 'spam') $$,
  '22023', null, 'nobody reports themselves');
select throws_ok($$ select public.social_report('post', '1b000000-0000-0000-0000-00000000000c', 'spam') $$,
  '22023', null, '…or their own post');
select throws_ok($$ select public.social_report('post', '1b000000-0000-0000-0000-00000000000b', 'boring') $$,
  '22023', null, 'only the listed reasons');
select throws_ok($$ select public.social_report('user', '1a000000-0000-0000-0000-00000000000b', 'other', repeat('x', 501)) $$,
  '22023', null, 'details are capped at 500 characters');
select throws_ok($$ select public.social_report('post', '1b000000-0000-0000-0000-0000000000a2', 'spam') $$,
  'P0002', null, 'a private post answers exactly like…');
select throws_ok($$ select public.social_report('post', '1b000000-0000-0000-0000-0000000000ff', 'spam') $$,
  'P0002', null, '…a post that does not exist');
select throws_ok(
  $$ insert into public.social_reports (reporter_id, reported_user_id, reason)
     values ('1a000000-0000-0000-0000-00000000000a', '1a000000-0000-0000-0000-00000000000b', 'spam') $$,
  '42501', null, 'reports are not written by hand — no spoofed reporter');
select throws_ok($$ select * from public.social_reports $$, '42501', null, 'nobody reads reports through the app');

reset role;
select set_config('request.jwt.claims', '', true);
select is(
  (select array_agg(row(reporter_id = '1a000000-0000-0000-0000-00000000000c', reason, details)::text order by reason)::text
   from public.social_reports),
  '{"(t,other,\"keeps posting ads\")","(t,spam,)"}',
  'two reports, one per target, the reporter taken from the session, details trimmed; the repeat was ignored');

set local role anon;
select throws_ok($$ select public.social_block_user('1a000000-0000-0000-0000-00000000000b') $$, '42501', null,
  'anonymous callers cannot block');
select throws_ok($$ select public.social_report('user', '1a000000-0000-0000-0000-00000000000b', 'spam') $$, '42501', null,
  '…nor report');
select throws_ok($$ select * from public.social_user_mutes $$, '42501', null, '…nor read mutes');
reset role;

select * from finish();
rollback;
