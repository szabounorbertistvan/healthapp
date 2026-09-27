-- pgTAP · Social safety: Block / Mute / Report end to end
-- (20261007100000 block/mute/report, 20261008100000 notifications,
--  20261009100000 comment reports, reasons, per-reason uniqueness)
--
-- The Bucata 7 suite covers each surface of a block; this one asks the
-- safety questions across the pieces: notifications around block and mute,
-- comment reports, per-reason duplicates, and every write attempted by hand
-- as the wrong person.
--
-- Run with a local stack up:  npm run db:test
-- Or without Docker:          npm run db:test:offline

begin;
create extension if not exists pgtap with schema extensions;
select plan(53);

create or replace function pg_temp.authenticate_as(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$fn$;

create or replace function pg_temp.rows_touched(p_sql text)
returns int language plpgsql as $fn$
declare v_n int;
begin
  execute p_sql;
  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

create or replace function pg_temp.notes(p_user uuid)
returns int language sql stable security definer as $fn$
  select count(*)::int from public.notifications where user_id = p_user;
$fn$;
create or replace function pg_temp.reports()
returns int language sql stable security definer as $fn$
  select count(*)::int from public.social_reports;
$fn$;
create or replace function pg_temp.follows(p_a uuid, p_b uuid)
returns int language sql stable security definer as $fn$
  select count(*)::int from public.social_follows
  where (follower_id = p_a and following_id = p_b) or (follower_id = p_b and following_id = p_a);
$fn$;

-- ---------- people ----------
-- A blocks B; A mutes M; C reports; T is a stranger.
insert into auth.users (id, email, raw_user_meta_data) values
  ('9a000000-0000-0000-0000-00000000000a', 'a@sf.test', '{"full_name":"Ana","username":"anasf"}'),
  ('9a000000-0000-0000-0000-00000000000b', 'b@sf.test', '{"full_name":"Bogdan","username":"bogdansf"}'),
  ('9a000000-0000-0000-0000-00000000000c', 'c@sf.test', '{"full_name":"Cara","username":"carasf"}'),
  ('9a000000-0000-0000-0000-00000000000d', 'm@sf.test', '{"full_name":"Mihai","username":"mihaisf"}'),
  ('9a000000-0000-0000-0000-00000000000e', 't@sf.test', '{"full_name":"Toma","username":"tomasf"}');
insert into public.social_follows (follower_id, following_id) values
  ('9a000000-0000-0000-0000-00000000000a', '9a000000-0000-0000-0000-00000000000b'),
  ('9a000000-0000-0000-0000-00000000000b', '9a000000-0000-0000-0000-00000000000a'),
  ('9a000000-0000-0000-0000-00000000000a', '9a000000-0000-0000-0000-00000000000d'),
  ('9a000000-0000-0000-0000-00000000000d', '9a000000-0000-0000-0000-00000000000a');
insert into public.social_posts (id, user_id, type, text, visibility) values
  ('9b000000-0000-0000-0000-00000000000a', '9a000000-0000-0000-0000-00000000000a', 'text', 'ana public', 'public'),
  ('9b000000-0000-0000-0000-0000000000a2', '9a000000-0000-0000-0000-00000000000a', 'text', 'ana private', 'private'),
  ('9b000000-0000-0000-0000-00000000000b', '9a000000-0000-0000-0000-00000000000b', 'text', 'bogdan public', 'public'),
  ('9b000000-0000-0000-0000-00000000000d', '9a000000-0000-0000-0000-00000000000d', 'text', 'mihai public', 'public');
insert into public.social_comments (id, post_id, user_id, body) values
  ('9c000000-0000-0000-0000-00000000000b', '9b000000-0000-0000-0000-00000000000a', '9a000000-0000-0000-0000-00000000000b', 'bogdan on ana'),
  ('9c000000-0000-0000-0000-00000000000c', '9b000000-0000-0000-0000-00000000000a', '9a000000-0000-0000-0000-00000000000c', 'cara on ana'),
  ('9c000000-0000-0000-0000-0000000000a2', '9b000000-0000-0000-0000-0000000000a2', '9a000000-0000-0000-0000-00000000000a', 'ana on her private');
insert into public.social_stories (user_id, body) values
  ('9a000000-0000-0000-0000-00000000000b', 'bogdan story'),
  ('9a000000-0000-0000-0000-00000000000d', 'mihai story');

-- The fixture's follows and comments notified people as they were inserted;
-- every notification question below starts from nothing.
delete from public.notifications;

-- ================= BLOCK =================
select pg_temp.authenticate_as('9a000000-0000-0000-0000-00000000000a');
select throws_ok($$ select public.social_block_user('9a000000-0000-0000-0000-00000000000a') $$, '22023', null, 'self-block is refused');
select lives_ok($$ select public.social_unblock_user('9a000000-0000-0000-0000-00000000000b') $$, 'unblocking someone never blocked is a quiet no-op');
select lives_ok($$ select public.social_block_user('9a000000-0000-0000-0000-00000000000b') $$, 'A blocks B');
select lives_ok($$ select public.social_block_user('9a000000-0000-0000-0000-00000000000b') $$, 'blocking twice is a quiet no-op');
select is((select count(*)::int from public.social_user_blocks), 1, 'one block row, whatever the retries');
select is(pg_temp.follows('9a000000-0000-0000-0000-00000000000a', '9a000000-0000-0000-0000-00000000000b'), 0,
  'the follows between them went with the block, both ways');
select is((select count(*)::int from public.social_feed(50, null, null, 'all') where user_id = '9a000000-0000-0000-0000-00000000000b'), 0,
  'B''s posts are gone from A''s feed');
select is((select count(*)::int from public.social_story_tray() where user_id = '9a000000-0000-0000-0000-00000000000b'), 0,
  'B''s stories are gone from A''s tray');
select is((select row(blocked, is_following)::text from public.social_profile('9a000000-0000-0000-0000-00000000000b')), '(t,f)',
  'A reaches B''s profile only to unblock, flagged');
select is((select count(*)::int from public.social_post_comments('9b000000-0000-0000-0000-00000000000a')
           where user_id = '9a000000-0000-0000-0000-00000000000b'), 0,
  'B''s comment is gone from the thread A reads — on A''s own post');
select throws_ok(
  $$ insert into public.social_posts (user_id, type, payload)
     values ('9a000000-0000-0000-0000-00000000000a', 'shared_post',
             '{"kind":"shared_post","original_post_id":"9b000000-0000-0000-0000-00000000000b"}') $$,
  'P0002', null, 'a repost cannot go around the block');
select throws_ok($$ update public.social_user_blocks set blocked_id = '9a000000-0000-0000-0000-00000000000e' $$,
  '42501', null, 'a block cannot be edited into a different one');

select pg_temp.authenticate_as('9a000000-0000-0000-0000-00000000000b');
select is((select count(*)::int from public.social_profile('9a000000-0000-0000-0000-00000000000a')), 0, 'A''s profile is absent to B');
select is((select count(*)::int from public.social_post('9b000000-0000-0000-0000-00000000000a')), 0, 'A''s post, asked for by id, is absent to B');
select throws_ok(
  $$ insert into public.social_comments (post_id, user_id, body, parent_id)
     values ('9b000000-0000-0000-0000-00000000000a', '9a000000-0000-0000-0000-00000000000b', 'reply', '9c000000-0000-0000-0000-00000000000c') $$,
  '42501', null, 'B cannot reply in A''s thread');
select throws_ok(
  $$ insert into public.social_follows (follower_id, following_id)
     values ('9a000000-0000-0000-0000-00000000000b', '9a000000-0000-0000-0000-00000000000a') $$,
  '42501', null, 'B cannot follow A back');
select is(pg_temp.notes('9a000000-0000-0000-0000-00000000000a'), 0, 'so no notice of any of it reached A');
select is((select count(*)::int from public.social_user_blocks), 0, 'B cannot see the block');
select throws_ok($$ delete from public.social_user_blocks where blocked_id = '9a000000-0000-0000-0000-00000000000b' $$,
  '42501', null, 'B cannot delete A''s block by hand — nobody deletes block rows outside social_unblock_user');
select throws_ok($$ select public.social_notify_ok('9a000000-0000-0000-0000-00000000000a', '9a000000-0000-0000-0000-00000000000b') $$,
  '42501', null, 'the notification rule is not callable directly');

select pg_temp.authenticate_as('9a000000-0000-0000-0000-00000000000a');
select lives_ok($$ select public.social_unblock_user('9a000000-0000-0000-0000-00000000000b') $$, 'A unblocks B');
select is(pg_temp.follows('9a000000-0000-0000-0000-00000000000a', '9a000000-0000-0000-0000-00000000000b'), 0,
  'the follows are not restored');
select is(pg_temp.notes('9a000000-0000-0000-0000-00000000000b') + pg_temp.notes('9a000000-0000-0000-0000-00000000000a'), 0,
  'unblocking tells nobody');
select is((select count(*)::int from public.social_feed(50, null, null, 'all') where user_id = '9a000000-0000-0000-0000-00000000000b'), 1,
  'B''s public post is back in A''s "all" feed — by the normal rules, not the old follow');

-- ================= MUTE =================
select lives_ok($$ insert into public.social_user_mutes (muter_id, muted_id) values
  ('9a000000-0000-0000-0000-00000000000a', '9a000000-0000-0000-0000-00000000000d') $$, 'A mutes M');
select throws_ok($$ insert into public.social_user_mutes (muter_id, muted_id) values
  ('9a000000-0000-0000-0000-00000000000a', '9a000000-0000-0000-0000-00000000000d') $$, '23505', null, 'muting twice is refused');
select is((select count(*)::int from public.social_feed(50) where user_id = '9a000000-0000-0000-0000-00000000000d'), 0, 'M leaves A''s feed');
select is((select count(*)::int from public.social_story_tray() where user_id = '9a000000-0000-0000-0000-00000000000d'), 0, 'M leaves A''s tray');
select is(pg_temp.follows('9a000000-0000-0000-0000-00000000000a', '9a000000-0000-0000-0000-00000000000d'), 2, 'both follows stay');
select is((select row(muted, is_following, follows_me)::text from public.social_profile('9a000000-0000-0000-0000-00000000000d')), '(t,t,t)',
  'M''s profile is intact');
select pg_temp.authenticate_as('9a000000-0000-0000-0000-00000000000d');
insert into public.social_comments (post_id, user_id, body) values ('9b000000-0000-0000-0000-00000000000a', '9a000000-0000-0000-0000-00000000000d', 'mihai on ana');
select is(pg_temp.notes('9a000000-0000-0000-0000-00000000000a'), 1, 'mute does not silence notifications: A hears M''s comment');
select is((select count(*)::int from public.social_user_mutes), 0, 'M cannot tell they are muted');
select is(pg_temp.rows_touched($$ delete from public.social_user_mutes where muted_id = '9a000000-0000-0000-0000-00000000000d' $$), 0,
  'M cannot undo A''s mute');
select pg_temp.authenticate_as('9a000000-0000-0000-0000-00000000000a');
delete from public.social_user_mutes where muted_id = '9a000000-0000-0000-0000-00000000000d';
select is((select count(*)::int from public.social_feed(50) where user_id = '9a000000-0000-0000-0000-00000000000d'), 1, 'unmuted: M is back');

-- ================= REPORT =================
select pg_temp.authenticate_as('9a000000-0000-0000-0000-00000000000c');
select lives_ok($$ select public.social_report('comment', '9c000000-0000-0000-0000-00000000000b', 'harassment') $$, 'C reports B''s comment');
select lives_ok($$ select public.social_report('comment', '9c000000-0000-0000-0000-00000000000b', 'harassment') $$, 'the same report again…');
select is(pg_temp.reports(), 1, '…stays one report');
select lives_ok($$ select public.social_report('comment', '9c000000-0000-0000-0000-00000000000b', 'hate', 'slur in the second line') $$,
  'a different reason for the same comment is its own report');
select lives_ok($$ select public.social_report('post', '9b000000-0000-0000-0000-00000000000b', 'scam') $$, 'C reports a post as a scam');
select lives_ok($$ select public.social_report('user', '9a000000-0000-0000-0000-00000000000b', 'impersonation') $$, 'C reports B for impersonation');
select throws_ok($$ select public.social_report('comment', '9c000000-0000-0000-0000-00000000000c', 'spam') $$, '22023', null,
  'nobody reports their own comment');
select throws_ok($$ select public.social_report('comment', '9c000000-0000-0000-0000-0000000000a2', 'spam') $$, 'P0002', null,
  'a comment on a post you cannot see answers like…');
select throws_ok($$ select public.social_report('comment', '9c000000-0000-0000-0000-0000000000ff', 'spam') $$, 'P0002', null,
  '…a comment that does not exist');
select throws_ok($$ select public.social_report('comment', '9b000000-0000-0000-0000-00000000000a', 'spam') $$, 'P0002', null,
  'a post id passed off as a comment id is no comment');
select throws_ok($$ select public.social_report('comment', '9c000000-0000-0000-0000-00000000000b', 'rude') $$, '22023', null,
  'only the listed reasons');
select throws_ok(
  $$ insert into public.social_reports (reporter_id, reported_comment_id, reason)
     values ('9a000000-0000-0000-0000-00000000000e', '9c000000-0000-0000-0000-00000000000b', 'spam') $$,
  '42501', null, 'a report cannot be written by hand, with anybody''s name on it');
select throws_ok($$ select * from public.social_reports $$, '42501', null, 'nobody reads reports through the app');

reset role;
select set_config('request.jwt.claims', '', true);
select is(
  (select array_agg(row(reason, status, details)::text order by reason)::text
   from public.social_reports where reported_comment_id = '9c000000-0000-0000-0000-00000000000b'),
  '{"(harassment,open,)","(hate,open,\"slur in the second line\")"}',
  'the comment''s two reports: open, details kept only where given');
select is(pg_temp.notes('9a000000-0000-0000-0000-00000000000b'), 0, 'being reported tells nobody anything');
select is((select count(*)::int from public.social_reports where reporter_id <> '9a000000-0000-0000-0000-00000000000c'), 0,
  'every report carries the session''s reporter');

set local role anon;
select throws_ok($$ select public.social_report('user', '9a000000-0000-0000-0000-00000000000b', 'spam') $$, '42501', null, 'anonymous: no reports');
select throws_ok($$ select public.social_unblock_user('9a000000-0000-0000-0000-00000000000b') $$, '42501', null, '…no blocks');
select throws_ok($$ select * from public.social_user_blocks $$, '42501', null, '…and no reading them');
reset role;

select * from finish();
rollback;
