-- pgTAP · Notifications & Activity Center (20261008100000_social_notifications.sql)
--
-- Every event is performed the way the app performs it — as the acting user,
-- through the real policies — and the question is always what landed in the
-- recipient's notifications, and what the Activity Center's read gives back.
--
-- Run with a local stack up:  npm run db:test
-- Or without Docker:          npm run db:test:offline

begin;
create extension if not exists pgtap with schema extensions;
select plan(42);

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

-- notifications of one category for one user (as the owner, past RLS)
create or replace function pg_temp.notes(p_user uuid, p_category text)
returns int language sql stable security definer as $fn$
  select count(*)::int from public.notifications where user_id = p_user and category::text = p_category;
$fn$;
create or replace function pg_temp.notes_on(p_user uuid, p_category text, p_key text, p_value text)
returns int language sql stable security definer as $fn$
  select count(*)::int from public.notifications
  where user_id = p_user and category::text = p_category and payload ->> p_key = p_value;
$fn$;

-- who got a mention notice for one post / comment, as the owner (past RLS)
create or replace function pg_temp.mentioned(p_key text, p_value text)
returns text language sql stable security definer as $fn$
  select coalesce(array_agg(user_id order by user_id)::text, '{}') from public.notifications
  where category::text = 'new_mention' and payload ->> p_key = p_value
    and (p_key = 'comment_id' or not (payload ? 'comment_id'));
$fn$;

-- ---------- people ----------
-- A posts. F and K follow A. S follows A later; T never follows anyone. X will be suspended, D will ask
-- for deletion, B will be blocked by A.
insert into auth.users (id, email, raw_user_meta_data) values
  ('0e000000-0000-0000-0000-000000000001', 'a@nt.test', '{"full_name":"Ana","username":"anant"}'),
  ('0e000000-0000-0000-0000-000000000002', 'f@nt.test', '{"full_name":"Fan","username":"fannt"}'),
  ('0e000000-0000-0000-0000-000000000003', 's@nt.test', '{"full_name":"Stranger","username":"strangernt"}'),
  ('0e000000-0000-0000-0000-000000000004', 'k@nt.test', '{"full_name":"Kira","username":"kirant"}'),
  ('0e000000-0000-0000-0000-000000000005', 'x@nt.test', '{"full_name":"Xena","username":"xenant"}'),
  ('0e000000-0000-0000-0000-000000000006', 'd@nt.test', '{"full_name":"Dan","username":"dannt"}'),
  ('0e000000-0000-0000-0000-000000000007', 'b@nt.test', '{"full_name":"Bogdan","username":"bogdannt"}'),
  ('0e000000-0000-0000-0000-000000000008', 't@nt.test', '{"full_name":"Tudor","username":"tudornt"}');
insert into public.social_follows (follower_id, following_id) values
  ('0e000000-0000-0000-0000-000000000002', '0e000000-0000-0000-0000-000000000001'),
  ('0e000000-0000-0000-0000-000000000004', '0e000000-0000-0000-0000-000000000001'),
  ('0e000000-0000-0000-0000-000000000007', '0e000000-0000-0000-0000-000000000001');
insert into public.social_posts (id, user_id, type, text, visibility, deleted_at) values
  ('0f000000-0000-0000-0000-000000000001', '0e000000-0000-0000-0000-000000000001', 'text', 'ana public', 'public', null),
  ('0f000000-0000-0000-0000-000000000002', '0e000000-0000-0000-0000-000000000001', 'text', 'ana followers @tudornt', 'followers', null),
  ('0f000000-0000-0000-0000-000000000003', '0e000000-0000-0000-0000-000000000001', 'text', 'ana gone', 'public', now()),
  ('0f000000-0000-0000-0000-000000000004', '0e000000-0000-0000-0000-000000000001', 'text', 'hey @fannt @strangernt @xenant @dannt @bogdannt', 'public', null),
  ('0f000000-0000-0000-0000-000000000005', '0e000000-0000-0000-0000-000000000004', 'text', 'kira public', 'public', null),
  ('0f000000-0000-0000-0000-000000000006', '0e000000-0000-0000-0000-000000000005', 'text', 'xena public', 'public', null);

-- ================= KUDOS =================
select pg_temp.authenticate_as('0e000000-0000-0000-0000-000000000002');
insert into public.social_reactions (post_id, user_id) values ('0f000000-0000-0000-0000-000000000001', '0e000000-0000-0000-0000-000000000002');
select is(pg_temp.notes_on('0e000000-0000-0000-0000-000000000001', 'new_kudos', 'actor_id', '0e000000-0000-0000-0000-000000000002'), 1,
  'Kudos: the author is told, and the actor is the giver');
delete from public.social_reactions where post_id = '0f000000-0000-0000-0000-000000000001' and user_id = '0e000000-0000-0000-0000-000000000002';
insert into public.social_reactions (post_id, user_id) values ('0f000000-0000-0000-0000-000000000001', '0e000000-0000-0000-0000-000000000002');
select is(pg_temp.notes('0e000000-0000-0000-0000-000000000001', 'new_kudos'), 1,
  'withdrawn and given again: still one notice (and the first one stays)');
select throws_ok(
  $$ insert into public.social_reactions (post_id, user_id) values ('0f000000-0000-0000-0000-000000000001', '0e000000-0000-0000-0000-000000000002') $$,
  '23505', null, 'a retried Kudos is refused by the unique pair, so it cannot notify twice');
select pg_temp.authenticate_as('0e000000-0000-0000-0000-000000000001');
select throws_ok(
  $$ insert into public.social_reactions (post_id, user_id) values ('0f000000-0000-0000-0000-000000000001', '0e000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'no Kudos to yourself, so no notice to yourself');

-- ================= FOLLOW =================
select pg_temp.authenticate_as('0e000000-0000-0000-0000-000000000003');
insert into public.social_follows (follower_id, following_id) values ('0e000000-0000-0000-0000-000000000003', '0e000000-0000-0000-0000-000000000001');
select is(pg_temp.notes_on('0e000000-0000-0000-0000-000000000001', 'new_follower', 'follower_id', '0e000000-0000-0000-0000-000000000003'), 1,
  'follow: one notice');
delete from public.social_follows where follower_id = '0e000000-0000-0000-0000-000000000003' and following_id = '0e000000-0000-0000-0000-000000000001';
insert into public.social_follows (follower_id, following_id) values ('0e000000-0000-0000-0000-000000000003', '0e000000-0000-0000-0000-000000000001');
select is(pg_temp.notes_on('0e000000-0000-0000-0000-000000000001', 'new_follower', 'follower_id', '0e000000-0000-0000-0000-000000000003'), 1,
  'unfollow → follow: still one');

-- B follows A before the block: that notice is history and stays
select pg_temp.as_owner();
reset role;
insert into public.notifications (user_id, category, title, payload)
  select '0e000000-0000-0000-0000-000000000001', 'new_follower', 'New follower',
         jsonb_build_object('follower_id', '0e000000-0000-0000-0000-000000000007')
  where not exists (select 1 from public.notifications where payload ->> 'follower_id' = '0e000000-0000-0000-0000-000000000007');

-- ================= COMMENTS =================
select pg_temp.authenticate_as('0e000000-0000-0000-0000-000000000002');
insert into public.social_comments (id, post_id, user_id, body)
  values ('0c000000-0000-0000-0000-000000000001', '0f000000-0000-0000-0000-000000000001', '0e000000-0000-0000-0000-000000000002', 'nice session');
select is(pg_temp.notes_on('0e000000-0000-0000-0000-000000000001', 'new_comment', 'comment_id', '0c000000-0000-0000-0000-000000000001'), 1,
  'comment: the post''s author is told');
select pg_temp.authenticate_as('0e000000-0000-0000-0000-000000000001');
insert into public.social_comments (id, post_id, user_id, body, parent_id)
  values ('0c000000-0000-0000-0000-000000000002', '0f000000-0000-0000-0000-000000000001', '0e000000-0000-0000-0000-000000000001', 'thanks!',
          '0c000000-0000-0000-0000-000000000001');
select is(pg_temp.notes('0e000000-0000-0000-0000-000000000002', 'comment_reply'), 1, 'reply: the parent comment''s author is told');
select is(pg_temp.notes('0e000000-0000-0000-0000-000000000001', 'new_comment'), 1, '…and the author replying on their own post is not told about themselves');
select pg_temp.authenticate_as('0e000000-0000-0000-0000-000000000002');
insert into public.social_comments (id, post_id, user_id, body, parent_id)
  values ('0c000000-0000-0000-0000-000000000003', '0f000000-0000-0000-0000-000000000001', '0e000000-0000-0000-0000-000000000002', 'also',
          '0c000000-0000-0000-0000-000000000001');
select is(pg_temp.notes('0e000000-0000-0000-0000-000000000002', 'comment_reply'), 1, 'replying to your own comment tells you nothing');
select is(pg_temp.notes('0e000000-0000-0000-0000-000000000001', 'new_comment'), 2, '…but the post''s author hears about the new comment');
select throws_ok(
  $$ insert into public.social_comments (post_id, user_id, body)
     values ('0f000000-0000-0000-0000-000000000003', '0e000000-0000-0000-0000-000000000002', 'hello?') $$,
  '42501', null, 'a deleted post takes no comments, so it produces no notices');

-- ================= suspend X, D asks for deletion, A blocks B =================
select pg_temp.as_owner();
reset role;
update public.users set suspended_at = now() where id = '0e000000-0000-0000-0000-000000000005';
insert into public.account_deletion_requests (user_id) values ('0e000000-0000-0000-0000-000000000006');
select pg_temp.authenticate_as('0e000000-0000-0000-0000-000000000001');
select public.social_block_user('0e000000-0000-0000-0000-000000000007');

-- ================= MENTIONS =================
-- in a post: F (follows), S (public post), X (suspended), D (deleting), B (blocked)
insert into public.social_post_mentions (post_id, user_id) values
  ('0f000000-0000-0000-0000-000000000004', '0e000000-0000-0000-0000-000000000002'),
  ('0f000000-0000-0000-0000-000000000004', '0e000000-0000-0000-0000-000000000003'),
  ('0f000000-0000-0000-0000-000000000004', '0e000000-0000-0000-0000-000000000005'),
  ('0f000000-0000-0000-0000-000000000004', '0e000000-0000-0000-0000-000000000006'),
  ('0f000000-0000-0000-0000-000000000004', '0e000000-0000-0000-0000-000000000007');
select is(
  pg_temp.mentioned('post_id', '0f000000-0000-0000-0000-000000000004'),
  '{0e000000-0000-0000-0000-000000000002,0e000000-0000-0000-0000-000000000003}',
  'a mention in a post: only the people who may see it — not the suspended, the deleting, or the blocked');
-- a followers-only post, mentioning someone who does not follow A
insert into public.social_post_mentions (post_id, user_id) values
  ('0f000000-0000-0000-0000-000000000002', '0e000000-0000-0000-0000-000000000008');
select is(pg_temp.notes_on('0e000000-0000-0000-0000-000000000008', 'new_mention', 'post_id', '0f000000-0000-0000-0000-000000000002'), 0,
  'a mention does not create access: a stranger named in a followers-only post is not told');
-- Since 20261012100000 the mention check drops it before the foreign key is
-- asked: the row never exists, and nothing is told to anyone.
insert into public.social_post_mentions (post_id, user_id)
  values ('0f000000-0000-0000-0000-000000000004', '0e000000-0000-0000-0000-0000000000ff');
select is((select count(*)::int from public.social_post_mentions where user_id = '0e000000-0000-0000-0000-0000000000ff'), 0,
  'a mention of someone who does not exist is never stored');

-- in a comment, several at once: K (follows A), T (cannot see a followers-only post), F (the writer)
select pg_temp.authenticate_as('0e000000-0000-0000-0000-000000000002');
insert into public.social_comments (id, post_id, user_id, body)
  values ('0c000000-0000-0000-0000-000000000004', '0f000000-0000-0000-0000-000000000002', '0e000000-0000-0000-0000-000000000002',
          '@kirant @tudornt @fannt look');
insert into public.social_comment_mentions (comment_id, user_id) values
  ('0c000000-0000-0000-0000-000000000004', '0e000000-0000-0000-0000-000000000004'),
  ('0c000000-0000-0000-0000-000000000004', '0e000000-0000-0000-0000-000000000008'),
  ('0c000000-0000-0000-0000-000000000004', '0e000000-0000-0000-0000-000000000002');
select is(
  pg_temp.mentioned('comment_id', '0c000000-0000-0000-0000-000000000004'),
  '{0e000000-0000-0000-0000-000000000004}',
  'a mention in a comment: the follower who can see it; not the stranger, not the writer');

-- ================= BLOCK =================
select pg_temp.authenticate_as('0e000000-0000-0000-0000-000000000007');
select throws_ok(
  $$ insert into public.social_reactions (post_id, user_id) values ('0f000000-0000-0000-0000-000000000001', '0e000000-0000-0000-0000-000000000007') $$,
  '42501', null, 'after the block, B cannot give A Kudos — so A is not told');
insert into public.social_comments (id, post_id, user_id, body)
  values ('0c000000-0000-0000-0000-000000000005', '0f000000-0000-0000-0000-000000000005', '0e000000-0000-0000-0000-000000000007', 'bogdan on kira');
select pg_temp.authenticate_as('0e000000-0000-0000-0000-000000000001');
-- A cannot see B's comment, but a hand-made reply to it gets through the insert policy
insert into public.social_comments (post_id, user_id, body, parent_id)
  values ('0f000000-0000-0000-0000-000000000005', '0e000000-0000-0000-0000-000000000001', 'reply across a block',
          '0c000000-0000-0000-0000-000000000005');
select is(pg_temp.notes('0e000000-0000-0000-0000-000000000007', 'comment_reply'), 0,
  'a reply is not a way to reach someone across a block');
select is(pg_temp.notes_on('0e000000-0000-0000-0000-000000000004', 'new_comment', 'actor_id', '0e000000-0000-0000-0000-000000000001'), 1,
  '…while the post''s author is still told about the comment');

-- ================= suspended recipient =================
-- Since 20261012100000 a suspended author's post is invisible to others, so
-- the Kudos itself is refused before any notice could exist.
select pg_temp.authenticate_as('0e000000-0000-0000-0000-000000000002');
select throws_ok(
  $$ insert into public.social_reactions (post_id, user_id) values ('0f000000-0000-0000-0000-000000000006', '0e000000-0000-0000-0000-000000000002') $$,
  '42501', null, 'a suspended account''s post takes no Kudos');
select is(pg_temp.notes('0e000000-0000-0000-0000-000000000005', 'new_kudos'), 0, 'a suspended account is not notified');

-- ================= ACHIEVEMENTS =================
select pg_temp.as_owner();
reset role;
create temp table b as select slug, rarity, metric, target from public.badges where active order by sort limit 1;
select public.award_badges_from_facts('0e000000-0000-0000-0000-000000000001', (select jsonb_build_object(metric, target) from b), true);
select is(
  (select row(payload ->> 'badge_slug' = (select slug from b), payload ->> 'rarity' = (select rarity from b), payload ? 'name_ro')::text
   from public.notifications where user_id = '0e000000-0000-0000-0000-000000000001' and category::text = 'badge_earned'),
  '(t,t,t)', 'badge earned: one notice, with the catalog slug (for /achievements/<slug>), rarity and both names');
select public.award_badges_from_facts('0e000000-0000-0000-0000-000000000004', (select jsonb_build_object(metric, target) from b), false);
select is(
  (select row((select count(*) from public.user_badges ub where ub.user_id = '0e000000-0000-0000-0000-000000000004'),
              pg_temp.notes('0e000000-0000-0000-0000-000000000004', 'badge_earned'))::text),
  '(1,0)', 'a backfill awards the badge silently');

-- ================= READ / WRITE =================
select pg_temp.authenticate_as('0e000000-0000-0000-0000-000000000001');
select throws_ok(
  $$ insert into public.notifications (user_id, category, title, payload)
     values ('0e000000-0000-0000-0000-000000000002', 'new_follower', 'fake', '{"follower_id":"0e000000-0000-0000-0000-000000000001"}') $$,
  '42501', null, 'nobody writes a notification by hand — not for someone else, not with a forged actor');
select throws_ok(
  $$ update public.notifications set payload = '{"badge_slug":"forged"}' where user_id = '0e000000-0000-0000-0000-000000000001' $$,
  '42501', null, 'a notification''s payload cannot be rewritten, even your own');
select throws_ok(
  $$ update public.notifications set category = 'badge_earned', title = 'forged' where user_id = '0e000000-0000-0000-0000-000000000001' $$,
  '42501', null, '…nor its category or title');
select is(pg_temp.rows_touched(
  $$ update public.notifications set read_at = now()
     where user_id = '0e000000-0000-0000-0000-000000000002' $$), 0,
  'nobody marks another person''s notifications read');
select is(pg_temp.rows_touched(
  $$ update public.notifications set read_at = now()
     where id = (select id from public.notifications where category::text = 'new_kudos' limit 1) and read_at is null $$), 1,
  'mark one read');
select is(pg_temp.rows_touched(
  $$ update public.notifications set read_at = now() where user_id = '0e000000-0000-0000-0000-000000000001' and read_at is null $$),
  (select count(*)::int - 1 from public.notifications where user_id = '0e000000-0000-0000-0000-000000000001'),
  'mark all read touches the rest of your unread, and only yours');
select is((select count(*)::int from public.notifications where read_at is null), 0, 'nothing of yours is unread now');

-- ================= the Activity Center's read =================
select is((select count(*)::int from public.social_notification_feed(50)),
  (select count(*)::int from public.notifications), 'the feed is exactly your own notifications');
select is(
  (select snippet from public.social_notification_feed(50)
   where payload ->> 'comment_id' = '0c000000-0000-0000-0000-000000000001'),
  'nice session', 'a comment notice shows the comment as it is now');
select is(
  (select row(actor_id, actor_name)::text from public.social_notification_feed(50)
   where category = 'new_follower' and payload ->> 'follower_id' = '0e000000-0000-0000-0000-000000000007'),
  '(,)', 'a notice from before the block stays — without the blocked person''s name or face');
select is(
  (select actor_name from public.social_notification_feed(50)
   where category = 'new_follower' and payload ->> 'follower_id' = '0e000000-0000-0000-0000-000000000003'),
  'strangernt', 'other actors are named');
select is(
  (select snippet from public.social_notification_feed(50) where category = 'new_kudos' limit 1),
  null, 'Kudos and follows carry no text');
update public.social_posts set deleted_at = now() where id = '0f000000-0000-0000-0000-000000000001';
select is(
  (select snippet from public.social_notification_feed(50)
   where payload ->> 'comment_id' = '0c000000-0000-0000-0000-000000000001'),
  null, 'the post is deleted: the notice stays, the comment text does not');
select is((select count(*)::int from public.social_notification_feed(50, null, null, true)), 0, 'unread only: none left');
select is(
  (select count(*)::int from public.social_notification_feed(2,
     (select min(created_at) from public.social_notification_feed(2)),
     (select id from public.social_notification_feed(2) order by created_at, id limit 1))
   where id in (select id from public.social_notification_feed(2))),
  0, 'the next page never repeats a row of the first');

select pg_temp.authenticate_as('0e000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.social_notification_feed(50) where payload ->> 'follower_id' = '0e000000-0000-0000-0000-000000000003'), 0,
  'F reads only F''s notifications');

-- ================= no session =================
select pg_temp.authenticate_as(null);
select is((select count(*)::int from public.social_notification_feed(50)), 0, 'no session, nothing');
reset role;
set local role anon;
select throws_ok($$ select * from public.social_notification_feed(50) $$, '42501', null, 'anonymous callers cannot call the feed');
select throws_ok($$ select * from public.notifications $$, '42501', null, '…nor read the table');
reset role;

select * from finish();
rollback;
