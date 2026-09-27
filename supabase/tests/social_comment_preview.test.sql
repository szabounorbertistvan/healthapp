-- pgTAP · Comment preview in the feed (20261006100000_social_comment_preview.sql)
--
-- The preview rides inside social_feed; social_comment_preview() is also
-- callable on its own, so every access question is asked of both — the
-- direct call is the one a hand-made request would try to get around
-- can_see_post with.
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

-- the preview's comment ids, in order
create or replace function pg_temp.preview_ids(p jsonb)
returns text language sql as $fn$
  select coalesce(string_agg(e ->> 'id', ',' order by n), '') from jsonb_array_elements(p) with ordinality x(e, n);
$fn$;

-- ---------- people ----------
-- OWNER posts. FAN follows OWNER. COACH coaches OWNER. STRANGER follows nobody.
-- SUS comments, then is suspended.
insert into auth.users (id, email, raw_user_meta_data) values
  ('2c000000-0000-0000-0000-000000000001', 'owner@cp.test',    '{"full_name":"Owner","username":"ownercp"}'),
  ('2c000000-0000-0000-0000-000000000002', 'fan@cp.test',      '{"full_name":"Fan","username":"fancp"}'),
  ('2c000000-0000-0000-0000-000000000003', 'stranger@cp.test', '{"full_name":"Stranger","username":"strangercp"}'),
  ('2c000000-0000-0000-0000-000000000004', 'coach@cp.test',    '{"full_name":"Coach","username":"coachcp","role":"coach"}'),
  ('2c000000-0000-0000-0000-000000000005', 'sus@cp.test',      '{"full_name":"Sus","username":"suscp"}');
insert into public.trainer_clients (coach_id, client_id, status, started_at) values
  ('2c000000-0000-0000-0000-000000000004', '2c000000-0000-0000-0000-000000000001', 'active', now());
insert into public.social_follows (follower_id, following_id) values
  ('2c000000-0000-0000-0000-000000000002', '2c000000-0000-0000-0000-000000000001');

-- P1 public, P2 followers-only, P3 private, P4 public with no comments, P5 public then deleted
insert into public.social_posts (id, user_id, type, text, visibility, created_at) values
  ('2d000000-0000-0000-0000-000000000001', '2c000000-0000-0000-0000-000000000001', 'text', 'public', 'public', now() - interval '1 hour'),
  ('2d000000-0000-0000-0000-000000000002', '2c000000-0000-0000-0000-000000000001', 'text', 'followers', 'followers', now() - interval '2 hours'),
  ('2d000000-0000-0000-0000-000000000003', '2c000000-0000-0000-0000-000000000001', 'text', 'private', 'private', now() - interval '3 hours'),
  ('2d000000-0000-0000-0000-000000000004', '2c000000-0000-0000-0000-000000000001', 'text', 'quiet', 'public', now() - interval '4 hours'),
  ('2d000000-0000-0000-0000-000000000005', '2c000000-0000-0000-0000-000000000001', 'text', 'gone', 'public', now() - interval '5 hours');

-- P1: three top-level comments at known times, a reply (newest of all), and
-- the newest top-level comment of all — by SUS, who will be suspended.
insert into public.social_comments (id, post_id, user_id, body, created_at) values
  ('2e000000-0000-0000-0000-000000000001', '2d000000-0000-0000-0000-000000000001', '2c000000-0000-0000-0000-000000000002', 'first',  now() - interval '50 minutes'),
  ('2e000000-0000-0000-0000-000000000002', '2d000000-0000-0000-0000-000000000001', '2c000000-0000-0000-0000-000000000004', 'second', now() - interval '40 minutes'),
  ('2e000000-0000-0000-0000-000000000003', '2d000000-0000-0000-0000-000000000001', '2c000000-0000-0000-0000-000000000002', 'third @ownercp', now() - interval '30 minutes'),
  ('2e000000-0000-0000-0000-000000000005', '2d000000-0000-0000-0000-000000000001', '2c000000-0000-0000-0000-000000000005', 'by sus', now() - interval '10 minutes');
insert into public.social_comments (id, post_id, user_id, body, parent_id, created_at) values
  ('2e000000-0000-0000-0000-000000000004', '2d000000-0000-0000-0000-000000000001', '2c000000-0000-0000-0000-000000000001', 'a reply', '2e000000-0000-0000-0000-000000000001', now() - interval '5 minutes');
insert into public.social_comment_mentions (comment_id, user_id) values
  ('2e000000-0000-0000-0000-000000000003', '2c000000-0000-0000-0000-000000000001');
update public.social_comments set edited_at = now() - interval '20 minutes' where id = '2e000000-0000-0000-0000-000000000002';
-- one comment on each of P2, P3, P5
insert into public.social_comments (post_id, user_id, body) values
  ('2d000000-0000-0000-0000-000000000002', '2c000000-0000-0000-0000-000000000002', 'on followers'),
  ('2d000000-0000-0000-0000-000000000003', '2c000000-0000-0000-0000-000000000001', 'on private'),
  ('2d000000-0000-0000-0000-000000000005', '2c000000-0000-0000-0000-000000000002', 'on gone');
update public.social_posts set deleted_at = now() where id = '2d000000-0000-0000-0000-000000000005';
update public.users set suspended_at = now() where id = '2c000000-0000-0000-0000-000000000005';

-- ---------- what the preview holds ----------
select pg_temp.authenticate_as('2c000000-0000-0000-0000-000000000002');
select is(
  (select pg_temp.preview_ids(comment_preview) from public.social_feed(50, null, null, 'all')
   where id = '2d000000-0000-0000-0000-000000000001'),
  '2e000000-0000-0000-0000-000000000003,2e000000-0000-0000-0000-000000000002',
  'two comments, newest top-level first — the thread''s own order; no replies, no suspended author');
select is(
  (select comment_count from public.social_feed(50, null, null, 'all') where id = '2d000000-0000-0000-0000-000000000001'),
  4, 'the total is the server-side count, not the two in the preview — and, since 20261013100000, only the 4 the reader can see (not the suspended author''s)');
select is(
  (select jsonb_array_length(comment_preview) from public.social_feed(50, null, null, 'all')
   where id = '2d000000-0000-0000-0000-000000000004'),
  0, 'no comments: an empty preview');
select is(
  (select comment_preview -> 1 ->> 'edited_at' is not null from public.social_feed(50, null, null, 'all')
   where id = '2d000000-0000-0000-0000-000000000001'),
  true, 'an edited comment says so');
select is(
  (select comment_preview -> 0 -> 'mentions' -> 0 ->> 'username' from public.social_feed(50, null, null, 'all')
   where id = '2d000000-0000-0000-0000-000000000001'),
  'ownercp', 'mentions come resolved, for MentionText');
select is(
  (select comment_preview -> 0 ->> 'author_name' from public.social_feed(50, null, null, 'all')
   where id = '2d000000-0000-0000-0000-000000000001'),
  'fancp', 'the author is named by username');
select is(
  (select array_agg(k order by k)::text from public.social_feed(50, null, null, 'all') f,
     jsonb_object_keys(f.comment_preview -> 0) k
   where f.id = '2d000000-0000-0000-0000-000000000001'),
  '{author_avatar,author_name,body,created_at,edited_at,id,mentions,user_id}',
  'only the fields the preview shows travel');

-- one comment
select pg_temp.authenticate_as('2c000000-0000-0000-0000-000000000002');
select is(
  (select row(jsonb_array_length(comment_preview), comment_count)::text from public.social_feed(50, null, null, 'all')
   where id = '2d000000-0000-0000-0000-000000000002'),
  '(1,1)', 'one comment: one in the preview, a total of one');

-- ---------- who may see it ----------
select is(
  public.social_comment_preview('2d000000-0000-0000-0000-000000000003'), '[]'::jsonb,
  'a follower asking directly for a private post''s comments gets nothing');

select pg_temp.authenticate_as('2c000000-0000-0000-0000-000000000003');
select is(
  public.social_comment_preview('2d000000-0000-0000-0000-000000000002'), '[]'::jsonb,
  'a stranger asking directly for a followers-only post''s comments gets nothing');
select is(
  (select count(*)::int from public.social_feed(50, null, null, 'all') where id = '2d000000-0000-0000-0000-000000000002'),
  0, '…and the post is not in their feed at all');
select is(
  (select jsonb_array_length(comment_preview) from public.social_feed(50, null, null, 'all')
   where id = '2d000000-0000-0000-0000-000000000001'),
  2, 'a stranger sees the preview of a public post');

select pg_temp.authenticate_as('2c000000-0000-0000-0000-000000000004');
select is(
  jsonb_array_length(public.social_comment_preview('2d000000-0000-0000-0000-000000000002')), 1,
  'the active coach sees the followers-only preview');
select is(
  public.social_comment_preview('2d000000-0000-0000-0000-000000000003'), '[]'::jsonb,
  '…but not the private one');

select pg_temp.authenticate_as('2c000000-0000-0000-0000-000000000001');
select is(
  jsonb_array_length(public.social_comment_preview('2d000000-0000-0000-0000-000000000003')), 1,
  'the owner sees the preview of their own private post');
select is(
  public.social_comment_preview('2d000000-0000-0000-0000-000000000005'), '[]'::jsonb,
  'a deleted post has no preview, even for its owner');

-- the direct call cannot be steered by a user id: there is no parameter for one
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'social_comment_preview' and p.pronargs = 1),
  1, 'the helper takes a post id and nothing else');

-- ---------- paging still works ----------
select pg_temp.authenticate_as('2c000000-0000-0000-0000-000000000002');
select is(
  (select array_agg(id order by created_at desc)::text from public.social_feed(2, null, null, 'all')),
  '{2d000000-0000-0000-0000-000000000001,2d000000-0000-0000-0000-000000000002}', 'page one');
select is(
  (select array_agg(id order by created_at desc)::text from public.social_feed(2,
     (select min(created_at) from public.social_feed(2, null, null, 'all')), null, 'all')),
  '{2d000000-0000-0000-0000-000000000004}', 'page two continues from the cursor (private P3 is not FAN''s)');

-- the saved list carries it too
insert into public.social_post_saves (user_id, post_id)
  values ('2c000000-0000-0000-0000-000000000002', '2d000000-0000-0000-0000-000000000001');
select is(
  (select jsonb_array_length(comment_preview) from public.social_saved_posts(10)
   where id = '2d000000-0000-0000-0000-000000000001'),
  2, '/saved shows the same preview');

-- ---------- no session ----------
select pg_temp.authenticate_as(null);
select is(public.social_comment_preview('2d000000-0000-0000-0000-000000000001'), '[]'::jsonb,
  'no session: not even a public post''s comments');
reset role;
set local role anon;
select throws_ok($$ select public.social_comment_preview('2d000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'anonymous callers cannot call the helper');
select throws_ok($$ select * from public.social_feed(20) $$, '42501', null, '…nor the feed that carries it');
reset role;

-- the suspended commenter is not deleted, only hidden: the thread's count keeps them
select is(
  (select count(*)::int from public.social_comments where post_id = '2d000000-0000-0000-0000-000000000001'),
  5, 'the comment rows themselves are untouched');

select * from finish();
rollback;
