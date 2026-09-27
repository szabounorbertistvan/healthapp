-- pgTAP · Comment thread integrity (20261013100000_social_comment_integrity.sql)
--
-- One rule for who a comment is shown to — the author is the reader, or is
-- listed for the reader (not suspended, not being deleted, no block) — and
-- every count and list agrees with it: comment_count, reply_count, the
-- preview, the thread, "show more replies". Mute is not part of it. Mention
-- rows are links only while still true; an edit prunes the ones its text no
-- longer names, and nothing is ever notified twice.
--
-- Run with a local stack up:  npm run db:test
-- Or without Docker:          npm run db:test:offline

begin;
create extension if not exists pgtap with schema extensions;
select plan(91);

create or replace function pg_temp.authenticate_as(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$fn$;
-- Owner-side reads: rows the reader's RLS would hide.
create or replace function pg_temp.comment_mentioned(p_comment uuid)
returns text language sql stable security definer as $fn$
  select coalesce(array_agg(u.username order by u.username)::text, '{}')
  from public.social_comment_mentions m join public.users u on u.id = m.user_id where m.comment_id = p_comment;
$fn$;
create or replace function pg_temp.post_mentioned(p_post uuid)
returns text language sql stable security definer as $fn$
  select coalesce(array_agg(u.username order by u.username)::text, '{}')
  from public.social_post_mentions m join public.users u on u.id = m.user_id where m.post_id = p_post;
$fn$;
create or replace function pg_temp.mention_notes(p_user uuid)
returns int language sql stable security definer as $fn$
  select count(*)::int from public.notifications where user_id = p_user and category::text = 'new_mention';
$fn$;
create or replace function pg_temp.body_of(p_comment uuid)
returns text language sql stable security definer as $fn$
  select body from public.social_comments where id = p_comment;
$fn$;
-- The reader's view, as the app reads it.
create or replace function pg_temp.thread_ids(p_post uuid, p_limit int default 50, p_before timestamptz default null)
returns text language sql stable as $fn$
  select coalesce(string_agg(right(id::text, 2), ',' order by ord), '')
  from (select id, row_number() over () as ord from public.social_post_comments(p_post, p_limit, p_before)) x;
$fn$;
create or replace function pg_temp.reply_count(p_post uuid, p_comment uuid)
returns int language sql stable as $fn$
  select reply_count from public.social_post_comments(p_post, 50) where id = p_comment;
$fn$;
create or replace function pg_temp.comment_count(p_post uuid)
returns int language sql stable as $fn$
  select comment_count from public.social_post(p_post);
$fn$;
-- What the thread adds up to: every top-level comment and its reply_count.
create or replace function pg_temp.thread_total(p_post uuid)
returns int language sql stable as $fn$
  select coalesce(sum(1 + reply_count), 0)::int from public.social_post_comments(p_post, 50) where parent_id is null;
$fn$;
create or replace function pg_temp.preview_ids(p_post uuid)
returns text language sql stable as $fn$
  select coalesce(string_agg(right(x ->> 'id', 2), ',' order by o), '')
  from jsonb_array_elements(public.social_comment_preview(p_post)) with ordinality as e(x, o);
$fn$;
create or replace function pg_temp.reply_ids(p_parent uuid, p_after timestamptz default null)
returns text language sql stable as $fn$
  select coalesce(string_agg(right(id::text, 2), ',' order by created_at, id), '')
  from public.social_comment_replies(p_parent, p_after, 50);
$fn$;
create or replace function pg_temp.thread_mentions(p_post uuid, p_comment uuid)
returns text language sql stable as $fn$
  select coalesce(string_agg(x ->> 'username', ',' order by o), '')
  from public.social_post_comments(p_post, 50) c, jsonb_array_elements(c.mentions) with ordinality as e(x, o)
  where c.id = p_comment;
$fn$;
create or replace function pg_temp.post_mentions(p_post uuid)
returns text language sql stable as $fn$
  select coalesce(string_agg(x ->> 'username', ',' order by o), '')
  from public.social_post(p_post) p, jsonb_array_elements(p.mentions) with ordinality as e(x, o);
$fn$;

-- ---------- people ----------
-- A posts. F follows A and is the main reader. S is a stranger. X will be
-- suspended, D asked for deletion, B blocked F, F muted M. K coaches A.
insert into auth.users (id, email, raw_user_meta_data) values
  ('c1000000-0000-0000-0000-00000000000a', 'a@ci.test', '{"full_name":"Ana","username":"aci"}'),
  ('c1000000-0000-0000-0000-00000000000f', 'f@ci.test', '{"full_name":"Fan","username":"fci"}'),
  ('c1000000-0000-0000-0000-000000000005', 's@ci.test', '{"full_name":"Stranger","username":"sci"}'),
  ('c1000000-0000-0000-0000-000000000009', 'x@ci.test', '{"full_name":"Xena","username":"xci"}'),
  ('c1000000-0000-0000-0000-00000000000d', 'd@ci.test', '{"full_name":"Dan","username":"dci"}'),
  ('c1000000-0000-0000-0000-00000000000b', 'b@ci.test', '{"full_name":"Bogdan","username":"bci"}'),
  ('c1000000-0000-0000-0000-00000000000e', 'm@ci.test', '{"full_name":"Mara","username":"mci"}'),
  ('c1000000-0000-0000-0000-0000000000cc', 'k@ci.test', '{"full_name":"Coach","username":"kci","role":"coach"}');
insert into public.social_follows (follower_id, following_id) values
  ('c1000000-0000-0000-0000-00000000000f', 'c1000000-0000-0000-0000-00000000000a');
insert into public.trainer_clients (coach_id, client_id, status, started_at) values
  ('c1000000-0000-0000-0000-0000000000cc', 'c1000000-0000-0000-0000-00000000000a', 'active', now());

-- ---------- posts (A's, written as A) ----------
select pg_temp.authenticate_as('c1000000-0000-0000-0000-00000000000a');
insert into public.social_posts (id, user_id, type, text, visibility) values
  ('c2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-00000000000a', 'text', 'the thread', 'public'),
  ('c2000000-0000-0000-0000-000000000000', 'c1000000-0000-0000-0000-00000000000a', 'text', 'no comments', 'public'),
  ('c2000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-00000000000a', 'text', 'one comment', 'public'),
  ('c2000000-0000-0000-0000-000000000004', 'c1000000-0000-0000-0000-00000000000a', 'text', 'only a suspended one', 'public'),
  ('c2000000-0000-0000-0000-000000000005', 'c1000000-0000-0000-0000-00000000000a', 'text', 'only a blocked one', 'public'),
  ('c2000000-0000-0000-0000-000000000006', 'c1000000-0000-0000-0000-00000000000a', 'text', 'hey @fci @dci', 'public'),
  ('c2000000-0000-0000-0000-000000000007', 'c1000000-0000-0000-0000-00000000000a', 'text', 'for followers @sci @fci', 'followers');

-- ---------- comments, as they would have been written over time (owner) ----------
reset role;
select set_config('request.jwt.claims', '', true);
insert into public.social_comments (id, post_id, user_id, parent_id, body, created_at) values
  -- P1 top level: S, X, D, B, M
  ('c3000000-0000-0000-0000-000000000011', 'c2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000005', null, 'root S', now() - interval '60 min'),
  ('c3000000-0000-0000-0000-000000000012', 'c2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000009', null, 'root X', now() - interval '59 min'),
  ('c3000000-0000-0000-0000-000000000013', 'c2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-00000000000d', null, 'root D', now() - interval '58 min'),
  ('c3000000-0000-0000-0000-000000000014', 'c2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-00000000000b', null, 'root B', now() - interval '57 min'),
  ('c3000000-0000-0000-0000-000000000015', 'c2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-00000000000e', null, 'root M', now() - interval '56 min'),
  -- replies under S's comment: F, X, B, S, D, M, S, S
  ('c3000000-0000-0000-0000-000000000021', 'c2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-00000000000f', 'c3000000-0000-0000-0000-000000000011', 'reply F', now() - interval '50 min'),
  ('c3000000-0000-0000-0000-000000000022', 'c2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000009', 'c3000000-0000-0000-0000-000000000011', 'reply X', now() - interval '49 min'),
  ('c3000000-0000-0000-0000-000000000023', 'c2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-00000000000b', 'c3000000-0000-0000-0000-000000000011', 'reply B', now() - interval '48 min'),
  ('c3000000-0000-0000-0000-000000000024', 'c2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000005', 'c3000000-0000-0000-0000-000000000011', 'reply S', now() - interval '47 min'),
  ('c3000000-0000-0000-0000-000000000025', 'c2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-00000000000d', 'c3000000-0000-0000-0000-000000000011', 'reply D', now() - interval '46 min'),
  ('c3000000-0000-0000-0000-000000000026', 'c2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-00000000000e', 'c3000000-0000-0000-0000-000000000011', 'reply M', now() - interval '45 min'),
  ('c3000000-0000-0000-0000-000000000027', 'c2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000005', 'c3000000-0000-0000-0000-000000000011', 'reply S2', now() - interval '44 min'),
  ('c3000000-0000-0000-0000-000000000028', 'c2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000005', 'c3000000-0000-0000-0000-000000000011', 'reply S3', now() - interval '43 min'),
  -- a reply under X's comment
  ('c3000000-0000-0000-0000-000000000031', 'c2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000005', 'c3000000-0000-0000-0000-000000000012', 'reply under X', now() - interval '40 min'),
  -- the small posts
  ('c3000000-0000-0000-0000-000000000041', 'c2000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000005', null, 'the one', now() - interval '30 min'),
  ('c3000000-0000-0000-0000-000000000042', 'c2000000-0000-0000-0000-000000000004', 'c1000000-0000-0000-0000-000000000009', null, 'suspended one', now() - interval '30 min'),
  ('c3000000-0000-0000-0000-000000000043', 'c2000000-0000-0000-0000-000000000005', 'c1000000-0000-0000-0000-00000000000b', null, 'blocked one', now() - interval '30 min'),
  ('c3000000-0000-0000-0000-000000000044', 'c2000000-0000-0000-0000-000000000007', 'c1000000-0000-0000-0000-00000000000f', null, 'follower comment', now() - interval '30 min'),
  -- the mention post: A's comment and B's comment
  ('c3000000-0000-0000-0000-000000000051', 'c2000000-0000-0000-0000-000000000006', 'c1000000-0000-0000-0000-00000000000a', null, 'great @fci @sci @xci @bci', now() - interval '20 min'),
  ('c3000000-0000-0000-0000-000000000052', 'c2000000-0000-0000-0000-000000000006', 'c1000000-0000-0000-0000-00000000000b', null, '@fci and @sci', now() - interval '19 min');

-- Mention rows as they were before 20261012100000: written without the check
-- (the owner is not the author, so the check lets them through), some true,
-- some not. D is named in the post but is being deleted; S is not named.
insert into public.social_post_mentions (post_id, user_id) values
  ('c2000000-0000-0000-0000-000000000006', 'c1000000-0000-0000-0000-00000000000f'),
  ('c2000000-0000-0000-0000-000000000006', 'c1000000-0000-0000-0000-00000000000d'),
  ('c2000000-0000-0000-0000-000000000006', 'c1000000-0000-0000-0000-000000000005'),
  -- a followers post: S is named but cannot see it
  ('c2000000-0000-0000-0000-000000000007', 'c1000000-0000-0000-0000-000000000005'),
  ('c2000000-0000-0000-0000-000000000007', 'c1000000-0000-0000-0000-00000000000f');
insert into public.social_comment_mentions (comment_id, user_id) values
  -- named: F, S, X, B; not named: D
  ('c3000000-0000-0000-0000-000000000051', 'c1000000-0000-0000-0000-00000000000f'),
  ('c3000000-0000-0000-0000-000000000051', 'c1000000-0000-0000-0000-000000000005'),
  ('c3000000-0000-0000-0000-000000000051', 'c1000000-0000-0000-0000-000000000009'),
  ('c3000000-0000-0000-0000-000000000051', 'c1000000-0000-0000-0000-00000000000b'),
  ('c3000000-0000-0000-0000-000000000051', 'c1000000-0000-0000-0000-00000000000d'),
  -- B names F, and B blocked F
  ('c3000000-0000-0000-0000-000000000052', 'c1000000-0000-0000-0000-00000000000f'),
  ('c3000000-0000-0000-0000-000000000052', 'c1000000-0000-0000-0000-000000000005');

-- ---------- the moderation state ----------
update public.users set suspended_at = now() where id = 'c1000000-0000-0000-0000-000000000009';
insert into public.account_deletion_requests (user_id) values ('c1000000-0000-0000-0000-00000000000d');
insert into public.social_user_blocks (blocker_id, blocked_id) values
  ('c1000000-0000-0000-0000-00000000000b', 'c1000000-0000-0000-0000-00000000000f');
insert into public.social_user_mutes (muter_id, muted_id) values
  ('c1000000-0000-0000-0000-00000000000f', 'c1000000-0000-0000-0000-00000000000e');
delete from public.notifications;

-- ================= comments and replies, as F =================
select pg_temp.authenticate_as('c1000000-0000-0000-0000-00000000000f');
select is(pg_temp.thread_ids('c2000000-0000-0000-0000-000000000001'), '11,21,24,26,15',
  'F: the thread is S''s comment with its first three visible replies, then M''s with its first three visible replies — no X, D or B anywhere');
select is(pg_temp.reply_count('c2000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-000000000011'), 5,
  'F: reply_count counts only the replies F can see (F, S, M, S, S — not X, B, D)');
select is(pg_temp.reply_count('c2000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-000000000015'), 0,
  'F: a comment without replies says 0');
select is((select count(*)::int from public.social_post_comments('c2000000-0000-0000-0000-000000000001', 50)
           where parent_id is not null and reply_count <> 0), 0, 'a reply never carries a reply_count');
select is(pg_temp.comment_count('c2000000-0000-0000-0000-000000000001'), 7,
  'F: comment_count is the 7 comments F can reach, not the 14 stored');
select is(pg_temp.thread_total('c2000000-0000-0000-0000-000000000001'), 7,
  'F: the thread adds up to the same 7');
select is((select comment_count from public.social_feed(50, null, 'c1000000-0000-0000-0000-00000000000a')
           where id = 'c2000000-0000-0000-0000-000000000001'), 7, 'F: the feed card says 7 as well');
select is(pg_temp.preview_ids('c2000000-0000-0000-0000-000000000001'), '15,11',
  'F: the preview is the two newest top-level comments F can see');
select ok(position('15' in pg_temp.thread_ids('c2000000-0000-0000-0000-000000000001')) > 0,
  'mute does not hide a comment: M''s is in the thread although F muted M');

-- "Show N more replies"
select is(pg_temp.reply_count('c2000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-000000000011')
          - (select count(*)::int from public.social_post_comments('c2000000-0000-0000-0000-000000000001', 50)
             where parent_id = 'c3000000-0000-0000-0000-000000000011'),
  2, 'F: reply_count minus the replies on screen is "Show 2 more replies"');
select is(pg_temp.reply_ids('c3000000-0000-0000-0000-000000000011',
            (select created_at from public.social_comments where id = 'c3000000-0000-0000-0000-000000000026')),
  '27,28', '…and paging after the last shown brings exactly those 2');
select is(pg_temp.reply_ids('c3000000-0000-0000-0000-000000000011'), '21,24,26,27,28',
  'F: all visible replies, in order — the same 5 as reply_count');
select is(pg_temp.reply_ids('c3000000-0000-0000-0000-000000000011',
            (select created_at from public.social_comments where id = 'c3000000-0000-0000-0000-000000000028')),
  '', 'paging past the last reply is empty, not an error');

-- replies under a comment F cannot see
select is(pg_temp.reply_ids('c3000000-0000-0000-0000-000000000012'), '',
  'F: no replies are listed under a suspended author''s comment');
select is(pg_temp.reply_ids('c3000000-0000-0000-0000-000000000014'), '',
  'F: none under the comment of someone F is blocked with');
select is(pg_temp.reply_ids('c3000000-0000-0000-0000-000000000013'), '',
  'F: none under the comment of someone being deleted');
select is(pg_temp.reply_ids('c3000000-0000-0000-0000-000000000021'), '',
  'a reply has no replies to page through');

-- pagination of top-level comments
select is(pg_temp.thread_ids('c2000000-0000-0000-0000-000000000001', 1), '15',
  'F: the first page of one is M''s comment');
select is(pg_temp.thread_ids('c2000000-0000-0000-0000-000000000001', 1,
            (select created_at from public.social_comments where id = 'c3000000-0000-0000-0000-000000000015')),
  '11,21,24,26', '…the next page skips X, D and B and lands on S''s comment and its replies');
select is(pg_temp.thread_ids('c2000000-0000-0000-0000-000000000001', 1,
            (select created_at from public.social_comments where id = 'c3000000-0000-0000-0000-000000000011')),
  '', '…and the page after the oldest is empty');

-- ================= the same post, as others =================
select pg_temp.authenticate_as('c1000000-0000-0000-0000-00000000000a');
select is(pg_temp.thread_ids('c2000000-0000-0000-0000-000000000001'), '11,21,23,24,14,15',
  'A (owner): B''s comment and reply are there — the block is between B and F, not A');
select is(pg_temp.reply_count('c2000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-000000000011'), 6,
  'A: reply_count 6 (X and D still hidden)');
select is(pg_temp.comment_count('c2000000-0000-0000-0000-000000000001'), 9, 'A: comment_count 9');
select is(pg_temp.thread_total('c2000000-0000-0000-0000-000000000001'), 9, 'A: the thread adds up to 9');
select is(pg_temp.preview_ids('c2000000-0000-0000-0000-000000000001'), '15,14', 'A: the preview is M''s and B''s');

select pg_temp.authenticate_as('c1000000-0000-0000-0000-000000000005');
select is(pg_temp.comment_count('c2000000-0000-0000-0000-000000000001'), 9, 'S (stranger, public post): 9');
select is(pg_temp.thread_total('c2000000-0000-0000-0000-000000000001'), 9, 'S: the thread agrees');

select pg_temp.authenticate_as('c1000000-0000-0000-0000-000000000009');
select ok(position('12' in pg_temp.thread_ids('c2000000-0000-0000-0000-000000000001')) > 0,
  'X (suspended) still sees their own comment');
select is(pg_temp.comment_count('c2000000-0000-0000-0000-000000000001'), pg_temp.thread_total('c2000000-0000-0000-0000-000000000001'),
  'X: comment_count and the thread agree for the author as well');

-- ================= preview / thread parity: 0, 1, only hidden =================
select pg_temp.authenticate_as('c1000000-0000-0000-0000-00000000000f');
select is(pg_temp.comment_count('c2000000-0000-0000-0000-000000000000'), 0, 'no comments: comment_count 0');
select is(pg_temp.preview_ids('c2000000-0000-0000-0000-000000000000'), '', '…an empty preview');
select is(pg_temp.thread_ids('c2000000-0000-0000-0000-000000000000'), '', '…an empty thread');
select is(pg_temp.comment_count('c2000000-0000-0000-0000-000000000003'), 1, 'one comment: comment_count 1');
select is(pg_temp.preview_ids('c2000000-0000-0000-0000-000000000003'), '41', '…the preview shows it');
select is(pg_temp.thread_ids('c2000000-0000-0000-0000-000000000003'), '41', '…the thread shows it');
select is(pg_temp.comment_count('c2000000-0000-0000-0000-000000000004'), 0,
  'only a suspended author''s comment: comment_count 0 — no "View all 1 comment" into an empty thread');
select is(pg_temp.preview_ids('c2000000-0000-0000-0000-000000000004'), '', '…no preview');
select is(pg_temp.thread_ids('c2000000-0000-0000-0000-000000000004'), '', '…no thread');
select is(pg_temp.comment_count('c2000000-0000-0000-0000-000000000005'), 0, 'only a blocked author''s comment: 0 for F');
select is(pg_temp.preview_ids('c2000000-0000-0000-0000-000000000005'), '', '…no preview');
select is(pg_temp.thread_ids('c2000000-0000-0000-0000-000000000005'), '', '…no thread');
select pg_temp.authenticate_as('c1000000-0000-0000-0000-00000000000a');
select is(pg_temp.comment_count('c2000000-0000-0000-0000-000000000005'), 1, '…and 1 for A, who is not blocked with B');
select is(pg_temp.preview_ids('c2000000-0000-0000-0000-000000000005'), '43', '…with its preview');

-- the followers post: owner, follower, coach
select is(pg_temp.comment_count('c2000000-0000-0000-0000-000000000007'), 1, 'followers post: the owner counts 1');
select pg_temp.authenticate_as('c1000000-0000-0000-0000-0000000000cc');
select is(pg_temp.comment_count('c2000000-0000-0000-0000-000000000007'), 1, '…the coach counts 1');
select is(pg_temp.thread_ids('c2000000-0000-0000-0000-000000000007'), '44', '…and reads it');

-- ================= historical mentions, on read =================
select pg_temp.authenticate_as('c1000000-0000-0000-0000-00000000000f');
select is(pg_temp.post_mentions('c2000000-0000-0000-0000-000000000006'), 'fci',
  'post: only F is a mention — D is being deleted, S is not named in the text');
select pg_temp.authenticate_as('c1000000-0000-0000-0000-00000000000a');
select is(pg_temp.post_mentions('c2000000-0000-0000-0000-000000000007'), 'fci',
  'followers post: S is named but cannot see it, so S is not a mention');
select is(pg_temp.thread_mentions('c2000000-0000-0000-0000-000000000006', 'c3000000-0000-0000-0000-000000000051'), 'fci,sci,bci',
  'comment, as A: F, S, B in text order — X suspended, D not named');
select is((select string_agg(m ->> 'username', ',' order by o)
           from jsonb_array_elements(public.social_comment_preview('c2000000-0000-0000-0000-000000000006')) p,
                jsonb_array_elements(p -> 'mentions') with ordinality as e(m, o)
           where p ->> 'id' = 'c3000000-0000-0000-0000-000000000051'), 'fci,sci,bci',
  '…the preview carries exactly the same mentions');
select is(pg_temp.thread_mentions('c2000000-0000-0000-0000-000000000006', 'c3000000-0000-0000-0000-000000000052'), 'sci',
  'B''s comment, as A: F is not a mention of B''s — they are blocked');
select pg_temp.authenticate_as('c1000000-0000-0000-0000-00000000000f');
select is(pg_temp.thread_mentions('c2000000-0000-0000-0000-000000000006', 'c3000000-0000-0000-0000-000000000051'), 'fci,sci',
  'the same comment, as F: B is not shown to someone B blocked');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.comment_mentioned('c3000000-0000-0000-0000-000000000051'), '{bci,dci,fci,sci,xci}',
  'reading deletes nothing: the historical rows are all still stored');
select is(pg_temp.mention_notes('c1000000-0000-0000-0000-00000000000d') + pg_temp.mention_notes('c1000000-0000-0000-0000-000000000009')
          + pg_temp.mention_notes('c1000000-0000-0000-0000-000000000005'), 0,
  '…and reading notifies nobody');

-- ================= editing =================
-- An old comment with invalid rows: the edit prunes what the text no longer names.
select pg_temp.authenticate_as('c1000000-0000-0000-0000-00000000000a');
update public.social_comments set body = 'great @fci @sci' where id = 'c3000000-0000-0000-0000-000000000051';
select is(pg_temp.comment_mentioned('c3000000-0000-0000-0000-000000000051'), '{fci,sci}',
  'edit: X and B dropped from the text, D never in it — pruned; F and S kept');
select is(pg_temp.mention_notes('c1000000-0000-0000-0000-00000000000f') + pg_temp.mention_notes('c1000000-0000-0000-0000-000000000005'), 0,
  '…and the edit notified nobody');
update public.social_comments set body = 'great @fci @sci' where id = 'c3000000-0000-0000-0000-000000000051';
update public.social_comments set body = 'great  @fci  @sci!' where id = 'c3000000-0000-0000-0000-000000000051';
select is(pg_temp.comment_mentioned('c3000000-0000-0000-0000-000000000051'), '{fci,sci}',
  'pruning is idempotent: the same names again change nothing');

-- A new comment through its edits.
insert into public.social_comments (id, post_id, user_id, body)
  values ('c3000000-0000-0000-0000-000000000053', 'c2000000-0000-0000-0000-000000000006', 'c1000000-0000-0000-0000-00000000000a', 'hi @fci');
insert into public.social_comment_mentions (comment_id, user_id)
  values ('c3000000-0000-0000-0000-000000000053', 'c1000000-0000-0000-0000-00000000000f');
select is(pg_temp.mention_notes('c1000000-0000-0000-0000-00000000000f'), 1, 'a new mention notifies F once');
update public.social_comments set body = 'hi @fci @sci' where id = 'c3000000-0000-0000-0000-000000000053';
insert into public.social_comment_mentions (comment_id, user_id)
  values ('c3000000-0000-0000-0000-000000000053', 'c1000000-0000-0000-0000-000000000005');
select is(pg_temp.mention_notes('c1000000-0000-0000-0000-000000000005'), 1, 'edit adds S: S is notified');
select is(pg_temp.mention_notes('c1000000-0000-0000-0000-00000000000f'), 1, '…F, still named, is not notified again');
-- the delete-and-rewrite an older client does
delete from public.social_comment_mentions where comment_id = 'c3000000-0000-0000-0000-000000000053'
  and user_id = 'c1000000-0000-0000-0000-00000000000f';
insert into public.social_comment_mentions (comment_id, user_id)
  values ('c3000000-0000-0000-0000-000000000053', 'c1000000-0000-0000-0000-00000000000f');
select is(pg_temp.mention_notes('c1000000-0000-0000-0000-00000000000f'), 1, 'rewriting F''s row does not notify F twice');
update public.social_comments set body = 'hi @sci' where id = 'c3000000-0000-0000-0000-000000000053';
select is(pg_temp.comment_mentioned('c3000000-0000-0000-0000-000000000053'), '{sci}', 'edit removes F: F''s row is gone');
select is(pg_temp.thread_mentions('c2000000-0000-0000-0000-000000000006', 'c3000000-0000-0000-0000-000000000053'), 'sci',
  '…and the thread links only S');
select is(pg_temp.mention_notes('c1000000-0000-0000-0000-00000000000f'), 1, '…with no notification for the removal');
update public.social_comments set body = 'hi @sci @fci' where id = 'c3000000-0000-0000-0000-000000000053';
insert into public.social_comment_mentions (comment_id, user_id)
  values ('c3000000-0000-0000-0000-000000000053', 'c1000000-0000-0000-0000-00000000000f');
select is(pg_temp.mention_notes('c1000000-0000-0000-0000-00000000000f'), 1, 'F named again: a link again, never a second notification');
update public.social_comments set body = 'hi @sci @fci @xci' where id = 'c3000000-0000-0000-0000-000000000053';
insert into public.social_comment_mentions (comment_id, user_id)
  values ('c3000000-0000-0000-0000-000000000053', 'c1000000-0000-0000-0000-000000000009');
select is(pg_temp.comment_mentioned('c3000000-0000-0000-0000-000000000053'), '{fci,sci}', 'edit names X (suspended): no row');
select is(pg_temp.mention_notes('c1000000-0000-0000-0000-000000000009'), 0, '…and no notification');
insert into public.social_comment_mentions (comment_id, user_id)
  values ('c3000000-0000-0000-0000-000000000053', 'c1000000-0000-0000-0000-00000000000e');
select is(pg_temp.comment_mentioned('c3000000-0000-0000-0000-000000000053'), '{fci,sci}',
  'a row for someone the text does not name is never stored');
-- F names B, who blocked F
select pg_temp.authenticate_as('c1000000-0000-0000-0000-00000000000f');
insert into public.social_comments (id, post_id, user_id, body)
  values ('c3000000-0000-0000-0000-000000000054', 'c2000000-0000-0000-0000-000000000006', 'c1000000-0000-0000-0000-00000000000f', 'yo @bci');
insert into public.social_comment_mentions (comment_id, user_id)
  values ('c3000000-0000-0000-0000-000000000054', 'c1000000-0000-0000-0000-00000000000b');
select is(pg_temp.comment_mentioned('c3000000-0000-0000-0000-000000000054'), '{}', 'naming someone you are blocked with stores nothing');
select is(pg_temp.mention_notes('c1000000-0000-0000-0000-00000000000b'), 0, '…and tells them nothing');

-- A post edit prunes the same way — and keeps a named row even while hidden.
select pg_temp.authenticate_as('c1000000-0000-0000-0000-00000000000a');
update public.social_posts set text = 'hey @dci' where id = 'c2000000-0000-0000-0000-000000000006';
select is(pg_temp.post_mentioned('c2000000-0000-0000-0000-000000000006'), '{dci}',
  'post edit: F and S (no longer named) pruned; D kept — still named, only hidden while being deleted');

-- ================= security =================
select pg_temp.authenticate_as('c1000000-0000-0000-0000-00000000000f');
update public.social_comments set body = 'hijacked' where id = 'c3000000-0000-0000-0000-000000000053';
select is(pg_temp.body_of('c3000000-0000-0000-0000-000000000053'), 'hi @sci @fci @xci', 'F cannot edit A''s comment…');
select is(pg_temp.comment_mentioned('c3000000-0000-0000-0000-000000000053'), '{fci,sci}', '…so A''s mentions are untouched');
select throws_ok($$ insert into public.social_comment_mentions (comment_id, user_id)
  values ('c3000000-0000-0000-0000-000000000053', 'c1000000-0000-0000-0000-000000000005') $$,
  '42501', null, 'F cannot write a mention onto A''s comment');
select throws_ok($$ select public.social_visible_comment_count('c2000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'the count helper is not callable by a signed-in user');
select throws_ok($$ select public.social_visible_comment_mentions('c3000000-0000-0000-0000-000000000051') $$,
  '42501', null, 'nor the mention helper');
select is(
  (select count(*)::int from unnest(array[
     'public.social_author_visible(uuid)', 'public.social_visible_reply_count(uuid)',
     'public.social_visible_comment_count(uuid)', 'public.social_visible_post_mentions(uuid)',
     'public.social_visible_comment_mentions(uuid)', 'public.social_post_mentions_prune()',
     'public.social_comment_mentions_prune()']) f
   where has_function_privilege('authenticated', f, 'EXECUTE') or has_function_privilege('anon', f, 'EXECUTE')),
  0, 'none of the seven internal functions is executable by anon or authenticated');

-- a post S may not see
select pg_temp.authenticate_as('c1000000-0000-0000-0000-000000000005');
select is(pg_temp.thread_ids('c2000000-0000-0000-0000-000000000007'), '', 'S: no thread on a followers post S cannot see');
select is(pg_temp.preview_ids('c2000000-0000-0000-0000-000000000007'), '', '…no preview');
select is(pg_temp.reply_ids('c3000000-0000-0000-0000-000000000044'), '', '…no replies by the comment''s id');
select is((select count(*)::int from public.social_post('c2000000-0000-0000-0000-000000000007')), 0, '…and no post, so no count');

-- anon
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select throws_ok($$ select * from public.social_post_comments('c2000000-0000-0000-0000-000000000001', 20, null) $$,
  '42501', null, 'anon cannot read a thread');
select throws_ok($$ select * from public.social_comment_replies('c3000000-0000-0000-0000-000000000011', null, 20) $$,
  '42501', null, 'anon cannot read replies');
select throws_ok($$ select public.social_comment_preview('c2000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'anon cannot read a preview');

-- ================= undoing moderation brings everything back =================
reset role;
delete from public.social_user_blocks where blocker_id = 'c1000000-0000-0000-0000-00000000000b';
select pg_temp.authenticate_as('c1000000-0000-0000-0000-00000000000f');
select is(pg_temp.comment_count('c2000000-0000-0000-0000-000000000001'), 9, 'unblock: F counts 9, like A');
select is(pg_temp.reply_count('c2000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-000000000011'), 6,
  '…and 6 replies under S''s comment');
reset role;
update public.users set suspended_at = null where id = 'c1000000-0000-0000-0000-000000000009';
select pg_temp.authenticate_as('c1000000-0000-0000-0000-00000000000f');
select is(pg_temp.comment_count('c2000000-0000-0000-0000-000000000001'), 12,
  'unsuspend: X''s comment, X''s reply and the reply under X''s comment are back — 12');
select is(pg_temp.reply_ids('c3000000-0000-0000-0000-000000000012'), '31', '…and the reply under X''s comment pages again');
reset role;
delete from public.account_deletion_requests where user_id = 'c1000000-0000-0000-0000-00000000000d';
select pg_temp.authenticate_as('c1000000-0000-0000-0000-00000000000f');
select is(pg_temp.comment_count('c2000000-0000-0000-0000-000000000001'), 14, 'deletion withdrawn: all 14 stored comments');
select is(pg_temp.thread_total('c2000000-0000-0000-0000-000000000001'), 14, '…and the thread still agrees');
select is(pg_temp.post_mentions('c2000000-0000-0000-0000-000000000006'), 'dci',
  'D''s mention, kept rather than deleted, is a link again');

select * from finish();
rollback;
