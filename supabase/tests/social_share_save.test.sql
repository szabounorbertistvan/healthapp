-- pgTAP · Social 2.0 Share + Save (20261005100000_social_share_save.sql)
--
-- Asked straight at the tables and RPCs, as the wrong person, the way a
-- hand-made PostgREST call would.
--
-- Run with a local stack up:  npm run db:test
-- Or without Docker:          npm run db:test:offline

begin;
create extension if not exists pgtap with schema extensions;
select plan(47);

create or replace function pg_temp.authenticate_as(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$fn$;

create or replace function pg_temp.as_owner()
returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', '', true);
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

-- ---------- people and posts ----------
-- OWNER posts public P1, followers-only P2, private P3, deleted P4.
-- FAN and OTHER follow OWNER; OTHER also follows FAN. COACH coaches OWNER.
-- STRANGER follows nobody. SUS (to be suspended) and GONE (to ask for
-- deletion) each post one public post.
insert into auth.users (id, email, raw_user_meta_data) values
  ('3c000000-0000-0000-0000-000000000001', 'owner@ss.test',    '{"full_name":"Owner","username":"ownerss"}'),
  ('3c000000-0000-0000-0000-000000000002', 'fan@ss.test',      '{"full_name":"Fan","username":"fanss"}'),
  ('3c000000-0000-0000-0000-000000000003', 'stranger@ss.test', '{"full_name":"Stranger","username":"strangerss"}'),
  ('3c000000-0000-0000-0000-000000000004', 'coach@ss.test',    '{"full_name":"Coach","username":"coachss","role":"coach"}'),
  ('3c000000-0000-0000-0000-000000000005', 'other@ss.test',    '{"full_name":"Other","username":"otherss"}'),
  ('3c000000-0000-0000-0000-000000000006', 'sus@ss.test',      '{"full_name":"Sus","username":"susss"}'),
  ('3c000000-0000-0000-0000-000000000007', 'gone@ss.test',     '{"full_name":"Gone","username":"goness"}');

insert into public.trainer_clients (coach_id, client_id, status, started_at) values
  ('3c000000-0000-0000-0000-000000000004', '3c000000-0000-0000-0000-000000000001', 'active', now());
insert into public.social_follows (follower_id, following_id) values
  ('3c000000-0000-0000-0000-000000000002', '3c000000-0000-0000-0000-000000000001'),
  ('3c000000-0000-0000-0000-000000000005', '3c000000-0000-0000-0000-000000000001'),
  ('3c000000-0000-0000-0000-000000000005', '3c000000-0000-0000-0000-000000000002');
insert into public.social_posts (id, user_id, type, text, visibility, deleted_at) values
  ('3d000000-0000-0000-0000-000000000001', '3c000000-0000-0000-0000-000000000001', 'text', 'public post', 'public', null),
  ('3d000000-0000-0000-0000-000000000002', '3c000000-0000-0000-0000-000000000001', 'text', 'followers post', 'followers', null),
  ('3d000000-0000-0000-0000-000000000003', '3c000000-0000-0000-0000-000000000001', 'text', 'private post', 'private', null),
  ('3d000000-0000-0000-0000-000000000004', '3c000000-0000-0000-0000-000000000001', 'text', 'deleted post', 'public', now()),
  ('3d000000-0000-0000-0000-000000000005', '3c000000-0000-0000-0000-000000000006', 'text', 'suspended author', 'public', null),
  ('3d000000-0000-0000-0000-000000000006', '3c000000-0000-0000-0000-000000000007', 'text', 'deleting author', 'public', null);

-- ================= SAVE =================
select pg_temp.authenticate_as('3c000000-0000-0000-0000-000000000002');
select lives_ok(
  $$ insert into public.social_post_saves (user_id, post_id)
     values ('3c000000-0000-0000-0000-000000000002', '3d000000-0000-0000-0000-000000000002') $$,
  'a follower saves a followers-only post');
select throws_ok(
  $$ insert into public.social_post_saves (user_id, post_id)
     values ('3c000000-0000-0000-0000-000000000002', '3d000000-0000-0000-0000-000000000002') $$,
  '23505', null, 'saving it twice is impossible');
select throws_ok(
  $$ insert into public.social_post_saves (user_id, post_id)
     values ('3c000000-0000-0000-0000-000000000002', '3d000000-0000-0000-0000-000000000003') $$,
  '42501', null, 'a private post cannot be saved by anyone else');
select throws_ok(
  $$ insert into public.social_post_saves (user_id, post_id)
     values ('3c000000-0000-0000-0000-000000000002', '3d000000-0000-0000-0000-000000000004') $$,
  '42501', null, 'a deleted post cannot be saved');
select throws_ok(
  $$ insert into public.social_post_saves (user_id, post_id)
     values ('3c000000-0000-0000-0000-000000000003', '3d000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'nobody saves on someone else''s behalf');
select throws_ok(
  $$ insert into public.social_post_saves (user_id, post_id, created_at)
     values ('3c000000-0000-0000-0000-000000000002', '3d000000-0000-0000-0000-000000000001', now() + interval '1 year') $$,
  '42501', null, 'the save time is the server''s, not the client''s');
select lives_ok(
  $$ insert into public.social_post_saves (user_id, post_id)
     values ('3c000000-0000-0000-0000-000000000002', '3d000000-0000-0000-0000-000000000001') $$,
  'FAN saves the public post too');

select pg_temp.authenticate_as('3c000000-0000-0000-0000-000000000003');
select throws_ok(
  $$ insert into public.social_post_saves (user_id, post_id)
     values ('3c000000-0000-0000-0000-000000000003', '3d000000-0000-0000-0000-000000000002') $$,
  '42501', null, 'a non-follower cannot save a followers-only post');
select lives_ok(
  $$ insert into public.social_post_saves (user_id, post_id)
     values ('3c000000-0000-0000-0000-000000000003', '3d000000-0000-0000-0000-000000000001') $$,
  '…but can save a public one');
select is((select count(*)::int from public.social_post_saves), 1, 'STRANGER reads only their own saves');
select is(pg_temp.rows_touched(
  $$ delete from public.social_post_saves where user_id = '3c000000-0000-0000-0000-000000000002' $$),
  0, 'and cannot remove anyone else''s');
select is((select count(*)::int from public.social_saved_posts(50)), 1, 'the saved list is the caller''s own');

select pg_temp.authenticate_as('3c000000-0000-0000-0000-000000000004');
select lives_ok(
  $$ insert into public.social_post_saves (user_id, post_id)
     values ('3c000000-0000-0000-0000-000000000004', '3d000000-0000-0000-0000-000000000002') $$,
  'the active coach can save a followers-only post of their client');

select pg_temp.authenticate_as('3c000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.social_post_saves), 0,
  'the author sees nobody''s saves of their posts — saving is private');

-- the saved list: newest save first, and it reflects visibility right now
select pg_temp.as_owner();
reset role;
update public.social_post_saves set created_at = now() - interval '1 hour'
  where user_id = '3c000000-0000-0000-0000-000000000002' and post_id = '3d000000-0000-0000-0000-000000000002';
select pg_temp.authenticate_as('3c000000-0000-0000-0000-000000000002');
select is(
  (select array_agg(t.id order by t.n)::text from public.social_saved_posts(50) with ordinality t(
     id, user_id, author_name, author_username, author_avatar, type, text, payload, visibility, created_at,
     activity_id, challenge_id, kudos_count, comment_count, my_kudos, kudos_names, mentions, edited_at, saved, shared, saved_at,
     comment_preview, author_muted, n)),
  '{3d000000-0000-0000-0000-000000000001,3d000000-0000-0000-0000-000000000002}', 'newest save first');
select is(
  (select array_agg(id)::text from public.social_saved_posts(1,
     (select min(saved_at) from public.social_saved_posts(1)))),
  '{3d000000-0000-0000-0000-000000000002}', 'the cursor continues from the last save shown');
select is(
  (select saved from public.social_feed(50, null, null, 'all') where id = '3d000000-0000-0000-0000-000000000002'),
  true, 'the feed row knows it is saved');

select pg_temp.authenticate_as('3c000000-0000-0000-0000-000000000001');
update public.social_posts set visibility = 'private' where id = '3d000000-0000-0000-0000-000000000002';
select pg_temp.authenticate_as('3c000000-0000-0000-0000-000000000002');
select is(
  (select count(*)::int from public.social_saved_posts(50) where id = '3d000000-0000-0000-0000-000000000002'),
  0, 'made private after it was saved: it leaves the saver''s list');
select pg_temp.authenticate_as('3c000000-0000-0000-0000-000000000001');
update public.social_posts set visibility = 'followers' where id = '3d000000-0000-0000-0000-000000000002';

-- ================= SHARE =================
select pg_temp.authenticate_as('3c000000-0000-0000-0000-000000000002');
select lives_ok(
  $$ insert into public.social_posts (id, user_id, type, text, visibility, payload)
     values ('3e000000-0000-0000-0000-000000000001', '3c000000-0000-0000-0000-000000000002', 'shared_post',
             'look at this', 'public',
             jsonb_build_object('kind', 'shared_post', 'original_post_id', '3d000000-0000-0000-0000-000000000002',
                                'text', 'forged words', 'name', 'Fake workout', 'volume_kg', 99999)) $$,
  'FAN shares OWNER''s followers-only post');
select is(
  (select payload from public.social_posts where id = '3e000000-0000-0000-0000-000000000001'),
  jsonb_build_object('kind', 'shared_post', 'original_post_id', '3d000000-0000-0000-0000-000000000002'),
  'the payload is rebuilt to the reference alone — nothing forged survives');
select is(
  (select row(user_id, (payload ->> 'original_post_id'))::text from public.social_posts where id = '3e000000-0000-0000-0000-000000000001'),
  '(3c000000-0000-0000-0000-000000000002,3d000000-0000-0000-0000-000000000002)', 'FAN is the sharer; the original stays OWNER''s post');
select throws_ok(
  $$ insert into public.social_posts (user_id, type, payload)
     values ('3c000000-0000-0000-0000-000000000002', 'shared_post',
             '{"kind":"shared_post","original_post_id":"3d000000-0000-0000-0000-000000000003"}') $$,
  'P0002', null, 'a private post cannot be shared');
select throws_ok(
  $$ insert into public.social_posts (user_id, type, payload)
     values ('3c000000-0000-0000-0000-000000000002', 'shared_post',
             '{"kind":"shared_post","original_post_id":"3d000000-0000-0000-0000-000000000004"}') $$,
  'P0002', null, 'a deleted post cannot be shared');
select throws_ok(
  $$ insert into public.social_posts (user_id, type, payload)
     values ('3c000000-0000-0000-0000-000000000002', 'shared_post',
             '{"kind":"shared_post","original_post_id":"3d000000-0000-0000-0000-0000000000ff"}') $$,
  'P0002', null, 'a made-up original_post_id is refused');
select throws_ok(
  $$ insert into public.social_posts (user_id, type, payload)
     values ('3c000000-0000-0000-0000-000000000002', 'shared_post',
             '{"kind":"shared_post","original_post_id":"not-a-uuid"}') $$,
  'P0002', null, '…and so is a malformed one');
select throws_ok(
  $$ insert into public.social_posts (user_id, type, payload)
     values ('3c000000-0000-0000-0000-000000000005', 'shared_post',
             '{"kind":"shared_post","original_post_id":"3d000000-0000-0000-0000-000000000001"}') $$,
  '42501', null, 'nobody shares as someone else');
select throws_ok(
  $$ insert into public.social_posts (user_id, type, payload)
     values ('3c000000-0000-0000-0000-000000000002', 'workout',
             '{"kind":"shared_post","original_post_id":"3d000000-0000-0000-0000-000000000001"}') $$,
  '22023', null, 'a share cannot pose as a workout');
select throws_ok(
  $$ update public.social_posts
     set payload = '{"kind":"shared_post","original_post_id":"3d000000-0000-0000-0000-000000000003"}'
     where id = '3e000000-0000-0000-0000-000000000001' $$,
  '42501', null, 'a share cannot be re-pointed at another post afterwards');

select pg_temp.authenticate_as('3c000000-0000-0000-0000-000000000003');
select throws_ok(
  $$ insert into public.social_posts (user_id, type, payload)
     values ('3c000000-0000-0000-0000-000000000003', 'shared_post',
             '{"kind":"shared_post","original_post_id":"3d000000-0000-0000-0000-000000000002"}') $$,
  'P0002', null, 'a non-follower cannot share a followers-only post');

select pg_temp.authenticate_as('3c000000-0000-0000-0000-000000000001');
select throws_ok(
  $$ insert into public.social_posts (user_id, type, payload)
     values ('3c000000-0000-0000-0000-000000000001', 'shared_post',
             '{"kind":"shared_post","original_post_id":"3d000000-0000-0000-0000-000000000001"}') $$,
  '22023', null, 'you cannot share your own post');

-- a share of a share is a share of the original
select pg_temp.authenticate_as('3c000000-0000-0000-0000-000000000005');
select lives_ok(
  $$ insert into public.social_posts (id, user_id, type, visibility, payload)
     values ('3e000000-0000-0000-0000-000000000002', '3c000000-0000-0000-0000-000000000005', 'shared_post', 'public',
             '{"kind":"shared_post","original_post_id":"3e000000-0000-0000-0000-000000000001"}') $$,
  'OTHER shares FAN''s share');
select is(
  (select payload ->> 'original_post_id' from public.social_posts where id = '3e000000-0000-0000-0000-000000000002'),
  '3d000000-0000-0000-0000-000000000002', '…and it points at OWNER''s original, not at the share');

-- reading a share: the original only for readers who may see it
select pg_temp.authenticate_as('3c000000-0000-0000-0000-000000000002');
select is(
  (select row(shared ->> 'id', shared ->> 'user_id', shared ->> 'text')::text
   from public.social_feed(50, null, null, 'all') where id = '3e000000-0000-0000-0000-000000000001'),
  '(3d000000-0000-0000-0000-000000000002,3c000000-0000-0000-0000-000000000001,"followers post")',
  'a follower reading the share sees the original, under its own author');
select pg_temp.authenticate_as('3c000000-0000-0000-0000-000000000004');
select isnt(
  (select shared from public.social_post('3e000000-0000-0000-0000-000000000001')), null,
  'the coach sees it too');
select pg_temp.authenticate_as('3c000000-0000-0000-0000-000000000003');
select is(
  (select count(*)::int from public.social_post('3e000000-0000-0000-0000-000000000001')), 1,
  'a stranger can open FAN''s public share…');
select is(
  (select shared from public.social_post('3e000000-0000-0000-0000-000000000001')), null,
  '…but gets nothing of the followers-only original inside it');

-- the original goes away: every share of it goes empty
select pg_temp.authenticate_as('3c000000-0000-0000-0000-000000000001');
update public.social_posts set deleted_at = now() where id = '3d000000-0000-0000-0000-000000000002';
select pg_temp.authenticate_as('3c000000-0000-0000-0000-000000000002');
select is(
  (select shared from public.social_feed(50, null, null, 'all') where id = '3e000000-0000-0000-0000-000000000001'),
  null, 'deleted original: the share stays, with nothing of the original in it');
select is(
  (select count(*)::int from public.social_saved_posts(50) where id = '3d000000-0000-0000-0000-000000000002'),
  0, '…and the deleted post leaves the saved list');

-- ================= suspended and deleting authors =================
select pg_temp.as_owner();
reset role;
update public.users set suspended_at = now() where id = '3c000000-0000-0000-0000-000000000006';
insert into public.account_deletion_requests (user_id) values ('3c000000-0000-0000-0000-000000000007');
select pg_temp.authenticate_as('3c000000-0000-0000-0000-000000000002');
select throws_ok(
  $$ insert into public.social_post_saves (user_id, post_id)
     values ('3c000000-0000-0000-0000-000000000002', '3d000000-0000-0000-0000-000000000005') $$,
  '42501', null, 'a suspended author''s post cannot be saved');
select throws_ok(
  $$ insert into public.social_post_saves (user_id, post_id)
     values ('3c000000-0000-0000-0000-000000000002', '3d000000-0000-0000-0000-000000000006') $$,
  '42501', null, '…nor a deleting author''s');
select throws_ok(
  $$ insert into public.social_posts (user_id, type, payload)
     values ('3c000000-0000-0000-0000-000000000002', 'shared_post',
             '{"kind":"shared_post","original_post_id":"3d000000-0000-0000-0000-000000000005"}') $$,
  'P0002', null, 'a suspended author''s post cannot be shared');
select throws_ok(
  $$ insert into public.social_posts (user_id, type, payload)
     values ('3c000000-0000-0000-0000-000000000002', 'shared_post',
             '{"kind":"shared_post","original_post_id":"3d000000-0000-0000-0000-000000000006"}') $$,
  'P0002', null, '…nor a deleting author''s');

-- ================= no session =================
select pg_temp.authenticate_as(null);
select is((select count(*)::int from public.social_feed(50, null, null, 'all')), 0, 'no session: an empty feed');
select is((select count(*)::int from public.social_saved_posts(50)), 0, 'no session: no saved list');
select pg_temp.as_owner();
reset role;
set local role anon;
select throws_ok($$ select * from public.social_feed(50, null, null, 'all') $$, '42501', null,
  'anonymous callers cannot call the feed at all');
select throws_ok($$ select * from public.social_saved_posts(50) $$, '42501', null,
  '…nor the saved list');
select throws_ok($$ select * from public.social_post_saves $$, '42501', null,
  '…nor read saves');
reset role;

select * from finish();
rollback;
