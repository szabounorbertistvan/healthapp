-- pgTAP · Social edge cases & privacy cleanup
-- (20261015100000_social_privacy_cleanup.sql, 20261015110000_social_mentions_cleanup.sql)
--
-- Every count and every list names only what the reader may see; the table
-- endpoints agree with the RPCs; a suspended or deleting account cannot
-- write socially; challenges follow blocks and suspensions; reports answer
-- one way for everything hidden and count once per target; stale mention
-- rows are removed by one clear rule, idempotently.
--
-- Run with a local stack up:  npm run db:test
-- Or without Docker:          npm run db:test:offline

begin;
create extension if not exists pgtap with schema extensions;
select plan(82);

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
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$fn$;
-- owner-side counts (what RLS would hide from the session)
create or replace function pg_temp.reports_by(p_user uuid)
returns int language sql stable security definer as $fn$
  select count(*)::int from public.social_reports where reporter_id = p_user;
$fn$;
create or replace function pg_temp.notes_on(p_user uuid, p_actor uuid, p_post uuid)
returns int language sql stable security definer as $fn$
  select count(*)::int from public.notifications
  where user_id = p_user and payload ->> 'actor_id' = p_actor::text and payload ->> 'post_id' = p_post::text;
$fn$;
create or replace function pg_temp.mention_rows(p_post uuid)
returns int language sql stable security definer as $fn$
  select count(*)::int from public.social_post_mentions where post_id = p_post;
$fn$;
-- the reader's view
create or replace function pg_temp.reply_count(p_post uuid, p_comment uuid)
returns int language sql stable as $fn$
  select reply_count from public.social_post_comments(p_post, 50) where id = p_comment;
$fn$;
create or replace function pg_temp.ids(p_sql text)
returns text language plpgsql as $fn$
declare v text;
begin
  execute 'select coalesce(string_agg(x, '','' order by x), '''') from (' || p_sql || ') q(x)' into v;
  return v;
end;
$fn$;

-- ---------- people ----------
-- A posts. R reads (follows A). S is a stranger to A. X is suspended, D is
-- being deleted. B blocked R; R blocked Q. K coaches A and X. C creates.
insert into auth.users (id, email, raw_user_meta_data) values
  ('d1000000-0000-0000-0000-00000000000a', 'a@pc.test', '{"full_name":"Ana","username":"afx"}'),
  ('d1000000-0000-0000-0000-00000000000f', 'r@pc.test', '{"full_name":"Radu","username":"rfx"}'),
  ('d1000000-0000-0000-0000-000000000005', 's@pc.test', '{"full_name":"Sara","username":"sfx"}'),
  ('d1000000-0000-0000-0000-000000000009', 'x@pc.test', '{"full_name":"Xena","username":"xfx"}'),
  ('d1000000-0000-0000-0000-00000000000d', 'd@pc.test', '{"full_name":"Dan","username":"dfx"}'),
  ('d1000000-0000-0000-0000-00000000000b', 'b@pc.test', '{"full_name":"Bogdan","username":"bfx"}'),
  ('d1000000-0000-0000-0000-00000000000e', 'q@pc.test', '{"full_name":"Quinn","username":"qfx"}'),
  ('d1000000-0000-0000-0000-00000000000c', 'c@pc.test', '{"full_name":"Cara","username":"cfx"}'),
  ('d1000000-0000-0000-0000-0000000000cc', 'k@pc.test', '{"full_name":"Coach","username":"kfx","role":"coach"}');
update public.users set leaderboard_visibility = 'public', stats_visibility = 'public'
 where id::text like 'd1000000-%';
insert into public.social_follows (follower_id, following_id) values
  ('d1000000-0000-0000-0000-00000000000f', 'd1000000-0000-0000-0000-00000000000a'),
  ('d1000000-0000-0000-0000-00000000000f', 'd1000000-0000-0000-0000-000000000005'),
  ('d1000000-0000-0000-0000-000000000005', 'd1000000-0000-0000-0000-000000000009'),
  ('d1000000-0000-0000-0000-000000000005', 'd1000000-0000-0000-0000-00000000000a');
insert into public.social_user_blocks (blocker_id, blocked_id) values
  ('d1000000-0000-0000-0000-00000000000b', 'd1000000-0000-0000-0000-00000000000f'),
  ('d1000000-0000-0000-0000-00000000000f', 'd1000000-0000-0000-0000-00000000000e');
insert into public.trainer_clients (coach_id, client_id, status, started_at) values
  ('d1000000-0000-0000-0000-0000000000cc', 'd1000000-0000-0000-0000-00000000000a', 'active', now()),
  ('d1000000-0000-0000-0000-0000000000cc', 'd1000000-0000-0000-0000-000000000009', 'active', now());

-- ---------- posts ----------
insert into public.social_posts (id, user_id, type, text, visibility) values
  ('d2000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-00000000000a', 'text', 'the thread', 'public'),
  ('d2000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-00000000000a', 'text', 'followers only', 'followers'),
  ('d2000000-0000-0000-0000-000000000003', 'd1000000-0000-0000-0000-00000000000a', 'text', 'deleted', 'public'),
  ('d2000000-0000-0000-0000-000000000004', 'd1000000-0000-0000-0000-00000000000a', 'text', 'admin removed', 'public'),
  ('d2000000-0000-0000-0000-000000000005', 'd1000000-0000-0000-0000-00000000000a', 'text', 'author removes', 'public'),
  ('d2000000-0000-0000-0000-000000000006', 'd1000000-0000-0000-0000-00000000000a', 'text', 'hi @sfx @xfx', 'public'),
  ('d2000000-0000-0000-0000-000000000009', 'd1000000-0000-0000-0000-000000000009', 'text', 'by xena', 'public');
update public.social_posts set deleted_at = now()
 where id in ('d2000000-0000-0000-0000-000000000003', 'd2000000-0000-0000-0000-000000000004');

-- ---------- comments (written over time, before anyone was suspended) ----------
insert into public.social_comments (id, post_id, user_id, parent_id, body, created_at) values
  ('d3000000-0000-0000-0000-000000000011', 'd2000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000005', null, 'root S', now() - interval '60 min'),
  ('d3000000-0000-0000-0000-000000000012', 'd2000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000009', null, 'root X @rfx', now() - interval '59 min'),
  ('d3000000-0000-0000-0000-000000000021', 'd2000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-00000000000f', 'd3000000-0000-0000-0000-000000000011', 'reply R', now() - interval '50 min'),
  ('d3000000-0000-0000-0000-000000000022', 'd2000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000009', 'd3000000-0000-0000-0000-000000000011', 'reply X', now() - interval '49 min'),
  ('d3000000-0000-0000-0000-000000000023', 'd2000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-00000000000d', 'd3000000-0000-0000-0000-000000000011', 'reply D', now() - interval '48 min'),
  ('d3000000-0000-0000-0000-000000000024', 'd2000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-00000000000e', 'd3000000-0000-0000-0000-000000000011', 'reply Q', now() - interval '47 min'),
  ('d3000000-0000-0000-0000-000000000025', 'd2000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-00000000000b', 'd3000000-0000-0000-0000-000000000011', 'reply B', now() - interval '46 min'),
  ('d3000000-0000-0000-0000-000000000026', 'd2000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000005', 'd3000000-0000-0000-0000-000000000011', 'reply S', now() - interval '45 min'),
  ('d3000000-0000-0000-0000-000000000031', 'd2000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000005', 'd3000000-0000-0000-0000-000000000012', 'under X', now() - interval '40 min'),
  ('d3000000-0000-0000-0000-000000000041', 'd2000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-00000000000f', null, 'on followers post', now() - interval '30 min'),
  ('d3000000-0000-0000-0000-000000000051', 'd2000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000005', null, 'hey @rfx', now() - interval '20 min');

-- ---------- reactions, mentions, a story, badges, sessions ----------
insert into public.social_reactions (post_id, user_id, type) values
  ('d2000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000005', 'kudos'),
  ('d2000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000009', 'love');
-- mention rows as they were before the insert check: S named (valid), X named
-- (suspended — hidden, kept), Q not named at all (stale)
insert into public.social_post_mentions (post_id, user_id) values
  ('d2000000-0000-0000-0000-000000000006', 'd1000000-0000-0000-0000-000000000005'),
  ('d2000000-0000-0000-0000-000000000006', 'd1000000-0000-0000-0000-000000000009'),
  ('d2000000-0000-0000-0000-000000000006', 'd1000000-0000-0000-0000-00000000000e');
insert into public.social_comment_mentions (comment_id, user_id) values
  ('d3000000-0000-0000-0000-000000000051', 'd1000000-0000-0000-0000-00000000000f'),  -- named
  ('d3000000-0000-0000-0000-000000000051', 'd1000000-0000-0000-0000-00000000000a'),  -- not named: stale
  ('d3000000-0000-0000-0000-000000000012', 'd1000000-0000-0000-0000-00000000000f');  -- on X's comment
insert into public.social_stories (id, user_id, body) values
  ('d4000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-00000000000f', 'my story');
insert into public.social_story_views (story_id, viewer_id) values
  ('d4000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000005'),
  ('d4000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000009');
insert into public.user_badges (user_id, badge_id)
  select 'd1000000-0000-0000-0000-000000000009', b.id from public.badges b order by b.sort limit 1;
-- workouts this week: X 3, A 2, D 1, B 1, R 0
insert into public.logged_sessions (user_id, client_generated_id, started_at, completed_at)
  select u, gen_random_uuid(), now() - (n || ' hours')::interval, now() - (n || ' hours')::interval + interval '45 minutes'
  from (values ('d1000000-0000-0000-0000-000000000009'::uuid, 3), ('d1000000-0000-0000-0000-00000000000a'::uuid, 2),
               ('d1000000-0000-0000-0000-00000000000d'::uuid, 1), ('d1000000-0000-0000-0000-00000000000b'::uuid, 1)) v(u, k),
       generate_series(1, k) n;

-- ---------- challenges ----------
insert into public.challenges (id, title_en, title_ro, type, target_value, start_date, end_date, visibility, creator_id) values
  ('d5000000-0000-0000-0000-000000000001', 'By Cara',  'C', 'workouts', 5, current_date - 7, current_date + 7, 'public', 'd1000000-0000-0000-0000-00000000000c'),
  ('d5000000-0000-0000-0000-000000000002', 'By Bogdan','B', 'workouts', 5, current_date - 7, current_date + 7, 'public', 'd1000000-0000-0000-0000-00000000000b'),
  ('d5000000-0000-0000-0000-000000000003', 'By Quinn', 'Q', 'workouts', 5, current_date - 7, current_date + 7, 'public', 'd1000000-0000-0000-0000-00000000000e'),
  ('d5000000-0000-0000-0000-000000000004', 'By Xena',  'X', 'workouts', 5, current_date - 7, current_date + 7, 'public', 'd1000000-0000-0000-0000-000000000009'),
  ('d5000000-0000-0000-0000-000000000005', 'Platform', 'P', 'workouts', 5, current_date - 7, current_date + 7, 'public', null);
insert into public.challenge_participants (challenge_id, user_id) values
  ('d5000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-00000000000a'),
  ('d5000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000009'),
  ('d5000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-00000000000d'),
  ('d5000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-00000000000b'),
  ('d5000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-00000000000f'),
  ('d5000000-0000-0000-0000-000000000004', 'd1000000-0000-0000-0000-000000000005');

-- ---------- now X is suspended and D asked to be deleted ----------
update public.users set suspended_at = now() where id = 'd1000000-0000-0000-0000-000000000009';
insert into public.account_deletion_requests (user_id) values ('d1000000-0000-0000-0000-00000000000d');

-- ================= 1. comment_count / reply_count =================
select pg_temp.authenticate_as('d1000000-0000-0000-0000-00000000000f');
select is(pg_temp.reply_count('d2000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-000000000011'), 2,
  'reply_count counts the normal replies (R, S) — not the suspended, the deleting, the blocked or the blocker');
select is((select count(*)::int from public.social_comment_replies('d3000000-0000-0000-0000-000000000011', null, 50)), 2,
  '"Show more replies" pages exactly what reply_count said');
select is((select comment_count from public.social_post('d2000000-0000-0000-0000-000000000001')), 4,
  'comment_count: S''s root and its two visible replies, S''s second root — not X''s root nor the reply under it');
select is((select coalesce(sum(1 + reply_count), 0)::int from public.social_post_comments('d2000000-0000-0000-0000-000000000001', 50)
           where parent_id is null), 4,
  'the thread adds up to comment_count');
select is((select comment_count from public.social_feed(50) where id = 'd2000000-0000-0000-0000-000000000001'), 4,
  'the feed card carries the same number');
select is((select count(*)::int from public.social_comments where parent_id = 'd3000000-0000-0000-0000-000000000011'), 2,
  'a direct read of social_comments sees the same two replies (the table no longer leaks hidden ones)');
select is((select count(*)::int from public.social_comments where post_id = 'd2000000-0000-0000-0000-000000000001'), 4,
  '…and the same four comments on the post');
select is((select count(*)::int from public.social_comments where id = 'd3000000-0000-0000-0000-000000000031'), 0,
  'a reply under a hidden comment is hidden from a direct read too');
select is((select count(*)::int from public.social_comments where user_id = 'd1000000-0000-0000-0000-00000000000f'), 2,
  'your own comments are always yours to read');

select pg_temp.authenticate_as('d1000000-0000-0000-0000-00000000000a');
select is(pg_temp.reply_count('d2000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-000000000011'), 4,
  'the count is per reader: the post''s author (no block with B or Q) sees four replies');

-- C does not follow A: the followers-only post is not C's to see
select pg_temp.authenticate_as('d1000000-0000-0000-0000-00000000000c');
select is((select count(*)::int from public.social_post_comments('d2000000-0000-0000-0000-000000000002', 50)), 0,
  'a reader without access to the post gets no thread…');
select is((select count(*)::int from public.social_post('d2000000-0000-0000-0000-000000000002')), 0, '…no post, so no count…');
select is((select count(*)::int from public.social_comments where post_id = 'd2000000-0000-0000-0000-000000000002'), 0,
  '…and nothing from the table');

-- a suspension lifted brings the reply back: it was hidden, never removed
select pg_temp.as_owner();
update public.users set suspended_at = null where id = 'd1000000-0000-0000-0000-000000000009';
select pg_temp.authenticate_as('d1000000-0000-0000-0000-00000000000f');
select is(pg_temp.reply_count('d2000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-000000000011'), 3,
  'unsuspended: X''s reply counts again');
select pg_temp.as_owner();
update public.users set suspended_at = now() where id = 'd1000000-0000-0000-0000-000000000009';

-- ================= 2. leaderboards =================
select pg_temp.authenticate_as('d1000000-0000-0000-0000-00000000000f');
select is(pg_temp.ids($$ select username from public.challenge_leaderboard('d5000000-0000-0000-0000-000000000001', 10) $$),
  'afx,rfx', 'challenge board: X (suspended), D (deleting) and B (blocker) are not named');
select is((select rank from public.challenge_leaderboard('d5000000-0000-0000-0000-000000000001', 10) where username = 'afx'), 2,
  '…but the history stands: A is still second behind X''s three workouts');
select is((select distinct participant_count from public.challenge_leaderboard('d5000000-0000-0000-0000-000000000001', 10)), 5,
  '…and the participant count is everyone who joined');
select is(pg_temp.ids($$ select username from public.social_leaderboard('workouts', 'all', 'global', 50) where username like '%fx' $$),
  'afx', 'global board: suspended and deleting accounts are not on it, the blocker is not handed over');
select is((select rank from public.social_leaderboard('workouts', 'all', 'global', 50) where username = 'afx'), 1,
  '…and A ranks first: someone who is not eligible takes no place');
select is(pg_temp.ids($$ select username from public.social_leaderboard('workouts', 'all', 'following', 50) where username like '%fx' $$),
  'afx', 'following board: the same');
select pg_temp.authenticate_as('d1000000-0000-0000-0000-0000000000cc');
select is(pg_temp.ids($$ select username from public.coach_challenge_progress() $$), 'afx',
  'coach challenge progress: the suspended client is not listed');

-- ================= 3. challenges and their creators =================
select pg_temp.authenticate_as('d1000000-0000-0000-0000-00000000000f');
select is(pg_temp.ids($$ select right(id::text, 1) from public.challenge_cards() where id::text like 'd5%' $$), '1,5',
  'R sees Cara''s and the platform challenge — not the blocker''s, not the blocked creator''s, not the suspended creator''s');
select is(pg_temp.ids($$ select right(id::text, 1) from public.challenges where id::text like 'd5%' $$), '1,5',
  'a direct read of challenges agrees');
select is((select count(*)::int from public.challenge_leaderboard('d5000000-0000-0000-0000-000000000003', 10)), 0,
  'the blocked creator''s board answers nothing');
select throws_ok(
  $$ insert into public.challenge_participants (challenge_id, user_id)
     values ('d5000000-0000-0000-0000-000000000003', 'd1000000-0000-0000-0000-00000000000f') $$,
  '42501', null, 'nor can R join the challenge of someone R blocked');
select throws_ok(
  $$ insert into public.challenge_participants (challenge_id, user_id)
     values ('d5000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-00000000000f') $$,
  '42501', null, '…or of someone who blocked R');
select pg_temp.authenticate_as('d1000000-0000-0000-0000-00000000000e');
select is(pg_temp.ids($$ select right(id::text, 1) from public.challenge_cards() where id::text like 'd5%' $$), '1,2,3,5',
  'the creator always sees their own; a block between B and R hides nothing from Q');
select pg_temp.authenticate_as('d1000000-0000-0000-0000-00000000000b');
select ok('d5000000-0000-0000-0000-000000000002' in (select id from public.challenge_cards()), 'the blocker sees their own');
select pg_temp.authenticate_as('d1000000-0000-0000-0000-000000000005');
select ok('d5000000-0000-0000-0000-000000000004' in (select id from public.challenge_cards()),
  'a participant keeps the suspended creator''s challenge (their progress is theirs)');
select pg_temp.authenticate_as('d1000000-0000-0000-0000-00000000000c');
select ok('d5000000-0000-0000-0000-000000000004' not in (select id from public.challenge_cards()),
  '…but nobody new finds it');
select ok(not has_function_privilege('anon', 'public.challenge_cards(uuid)', 'execute')
          and not has_function_privilege('anon', 'public.can_see_challenge(uuid)', 'execute'),
  'anonymous: no challenge function at all');

-- ================= 4. reports =================
select pg_temp.authenticate_as('d1000000-0000-0000-0000-00000000000f');
select throws_ok($$ select public.social_report('comment', 'd3000000-0000-0000-0000-000000000021', 'spam') $$, '22023', null,
  'nobody reports their own comment');
select throws_ok($$ select public.social_report('comment', 'd3000000-0000-0000-0000-000000000022', 'spam') $$, 'P0002', null,
  'a suspended author''s comment answers like a missing one');
select throws_ok($$ select public.social_report('comment', 'd3000000-0000-0000-0000-000000000024', 'spam') $$, 'P0002', null,
  'so does a comment by someone R blocked…');
select throws_ok($$ select public.social_report('comment', 'd3000000-0000-0000-0000-000000000025', 'spam') $$, 'P0002', null,
  '…or by someone who blocked R');
select throws_ok($$ select public.social_report('comment', 'd3000000-0000-0000-0000-000000000031', 'spam') $$, 'P0002', null,
  '…or a reply under a comment R cannot see');
select throws_ok($$ select public.social_report('post', 'd2000000-0000-0000-0000-000000000009', 'spam') $$, 'P0002', null,
  'a suspended author''s post answers like a missing one');
select throws_ok($$ select public.social_report('post', 'd2000000-0000-0000-0000-000000000003', 'spam') $$, 'P0002', null,
  'so does a deleted post');
select throws_ok($$ select public.social_report('user', 'd1000000-0000-0000-0000-000000000009', 'spam') $$, 'P0002', null,
  'a suspended user answers like…');
select throws_ok($$ select public.social_report('user', 'd1000000-0000-0000-0000-00000000000d', 'spam') $$, 'P0002', null,
  '…a user being deleted, and like…');
select throws_ok($$ select public.social_report('user', 'd1000000-0000-0000-0000-0000000000ff', 'spam') $$, 'P0002', null,
  '…a user who does not exist');
select lives_ok($$ select public.social_report('user', 'd1000000-0000-0000-0000-00000000000e', 'harassment') $$,
  'someone R blocked can still be reported');
select lives_ok($$ select public.social_report('user', 'd1000000-0000-0000-0000-00000000000b', 'harassment') $$,
  '…and so can someone who blocked R');
select lives_ok($$ select public.social_report('post', 'd2000000-0000-0000-0000-000000000001', 'spam') $$, 'R reports a post');
select lives_ok($$ select public.social_report('post', 'd2000000-0000-0000-0000-000000000001', 'hate') $$, '…again, another reason');
select lives_ok($$ select public.social_report('comment', 'd3000000-0000-0000-0000-000000000011', 'spam') $$, 'R reports a comment');
select lives_ok($$ select public.social_report('comment', 'd3000000-0000-0000-0000-000000000011', 'scam', 'again') $$, '…twice');
select is(pg_temp.reports_by('d1000000-0000-0000-0000-00000000000f'), 4,
  'one report per target, whatever the reason: two users, one post, one comment');
select pg_temp.authenticate_as('d1000000-0000-0000-0000-00000000000c');
select throws_ok($$ select public.social_report('post', 'd2000000-0000-0000-0000-000000000002', 'spam') $$, 'P0002', null,
  'a post the reporter may not see answers like a missing one');
select pg_temp.authenticate_as('d1000000-0000-0000-0000-00000000000a');
select throws_ok($$ select public.social_report('post', 'd2000000-0000-0000-0000-000000000001', 'spam') $$, '22023', null,
  'nobody reports their own post');

-- ================= 5. a suspended or deleting account cannot write =================
select pg_temp.authenticate_as('d1000000-0000-0000-0000-000000000009');
select throws_ok($$ insert into public.social_posts (user_id, type, text, visibility)
                    values ('d1000000-0000-0000-0000-000000000009', 'text', 'still here', 'public') $$,
  '42501', null, 'suspended: no post');
select throws_ok($$ insert into public.social_comments (post_id, user_id, body)
                    values ('d2000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000009', 'hi') $$,
  '42501', null, 'suspended: no comment');
select throws_ok($$ select public.social_react('d2000000-0000-0000-0000-000000000006', 'kudos') $$,
  '42501', null, 'suspended: no reaction');
select throws_ok($$ insert into public.social_follows (follower_id, following_id)
                    values ('d1000000-0000-0000-0000-000000000009', 'd1000000-0000-0000-0000-00000000000c') $$,
  '42501', null, 'suspended: no follow');
select throws_ok($$ insert into public.social_post_saves (user_id, post_id)
                    values ('d1000000-0000-0000-0000-000000000009', 'd2000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'suspended: no save');
select throws_ok($$ insert into public.social_stories (user_id, body) values ('d1000000-0000-0000-0000-000000000009', 'story') $$,
  '42501', null, 'suspended: no story');
select throws_ok($$ insert into public.challenges (title_en, title_ro, type, target_value, start_date, end_date, visibility, creator_id)
                    values ('Mine', 'Al meu', 'workouts', 1, current_date, current_date + 7, 'public', 'd1000000-0000-0000-0000-000000000009') $$,
  '42501', null, 'suspended: no challenge');
select throws_ok($$ insert into public.challenge_participants (challenge_id, user_id)
                    values ('d5000000-0000-0000-0000-000000000005', 'd1000000-0000-0000-0000-000000000009') $$,
  '42501', null, 'suspended: no joining');
select throws_ok($$ select public.social_report('user', 'd1000000-0000-0000-0000-00000000000a', 'spam') $$,
  '42501', null, 'suspended: no reports');
select is((select count(*)::int from public.social_comments where id = 'd3000000-0000-0000-0000-000000000022'), 1,
  'suspended: still reads their own comment…');
delete from public.social_comments where id = 'd3000000-0000-0000-0000-000000000022';
select is((select count(*)::int from public.social_comments where id = 'd3000000-0000-0000-0000-000000000022'), 0,
  '…and may delete it: taking things away stays open');
select pg_temp.authenticate_as('d1000000-0000-0000-0000-00000000000d');
select throws_ok($$ insert into public.social_posts (user_id, type, text, visibility)
                    values ('d1000000-0000-0000-0000-00000000000d', 'text', 'bye', 'public') $$,
  '42501', null, 'being deleted: no post either');
-- a reaction that reaches the table anyway (the owner, a restore) tells nobody
select pg_temp.as_owner();
insert into public.social_reactions (post_id, user_id, type)
  values ('d2000000-0000-0000-0000-000000000006', 'd1000000-0000-0000-0000-000000000009', 'kudos')
  on conflict (post_id, user_id) do nothing;
select is(pg_temp.notes_on('d1000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000009',
                           'd2000000-0000-0000-0000-000000000006'), 0,
  'an inactive account''s reaction notifies nobody');

-- ================= 6. a deleted post stays deleted =================
select pg_temp.authenticate_as('d1000000-0000-0000-0000-00000000000a');
select throws_ok($$ update public.social_posts set deleted_at = null where id = 'd2000000-0000-0000-0000-000000000004' $$,
  'P0002', null, 'the author cannot bring back a post that was removed');
update public.social_posts set deleted_at = '2000-01-01' where id = 'd2000000-0000-0000-0000-000000000005';
select pg_temp.as_owner();
select is((select deleted_at from public.social_posts where id = 'd2000000-0000-0000-0000-000000000005'), now(),
  'a delete from the app is stamped with the server''s time, not the one sent');

-- ================= 7. table reads follow the RPCs =================
select pg_temp.authenticate_as('d1000000-0000-0000-0000-00000000000f');
select is(pg_temp.ids($$ select right(user_id::text, 1) from public.social_reactions
                        where post_id = 'd2000000-0000-0000-0000-000000000001' $$), '5',
  'reactions: a suspended reactor''s row is not readable');
select is(pg_temp.ids($$ select username from public.social_post_kudos('d2000000-0000-0000-0000-000000000001') $$), 'sfx',
  '…nor named in the list of who reacted');
select is(pg_temp.ids($$ select right(user_id::text, 1) from public.social_post_mentions
                        where post_id = 'd2000000-0000-0000-0000-000000000006' $$), '5',
  'post mentions: only the valid row (not the suspended person, not the stale one)');
select is(pg_temp.ids($$ select right(comment_id::text, 2) from public.social_comment_mentions
                        where user_id = 'd1000000-0000-0000-0000-00000000000f' $$), '51',
  'comment mentions: not on a comment by a suspended author');
select is(pg_temp.ids($$ select right(viewer_id::text, 1) from public.social_story_views $$), '5',
  'story views: the owner does not read a suspended viewer''s row');
select is(pg_temp.ids($$ select username from public.social_mention_candidates('xf') $$), '',
  '@ autocomplete: a suspended account is not offered');
select is((select count(*)::int from public.social_mention_candidates('_')), 0,
  '@ autocomplete: "_" is a character, not a wildcard');
select is((select count(*)::int from public.social_mutual_followers('d1000000-0000-0000-0000-000000000009')), 0,
  'mutual followers of a suspended account: none');
select is(pg_temp.ids($$ select username from public.social_mutual_followers('d1000000-0000-0000-0000-00000000000a') $$), 'sfx',
  '…of a listed one, as before');
select is((select count(*)::int from public.social_badges('d1000000-0000-0000-0000-000000000009')), 0,
  'badges of a suspended account: none, even with public stats');
select pg_temp.authenticate_as('d1000000-0000-0000-0000-0000000000cc');
select is((select count(*)::int from public.social_badges('d1000000-0000-0000-0000-000000000009')), 1,
  '…while their coach still sees them');
select pg_temp.authenticate_as('d1000000-0000-0000-0000-00000000000a');
select is(pg_temp.ids($$ select right(user_id::text, 1) from public.social_post_mentions
                        where post_id = 'd2000000-0000-0000-0000-000000000006' $$), '5,9,e',
  'the post''s author still reads every mention row on it (the edit path diffs against them)');

-- ================= 8. retro-validation of mention rows =================
select pg_temp.as_owner();
select is((select row(post_rows, comment_rows)::text from public.social_mentions_cleanup()), '(1,1)',
  'cleanup removes the rows whose handle is not in the text: one on the post, one on the comment');
select is(pg_temp.mention_rows('d2000000-0000-0000-0000-000000000006'), 2,
  '…and keeps the suspended person''s row (a suspension can be lifted)');
select is((select row(post_rows, comment_rows)::text from public.social_mentions_cleanup()), '(0,0)',
  'a second run finds nothing: idempotent');
select ok(not has_function_privilege('authenticated', 'public.social_mentions_cleanup()', 'execute'),
  'nobody signed in can run it');

-- ================= 9. anon =================
select ok(not has_function_privilege('anon', 'public.can_see_post(uuid)', 'execute')
          and not has_function_privilege('anon', 'public.can_kudos_post(uuid)', 'execute')
          and not has_function_privilege('anon', 'public.can_see_program(uuid)', 'execute')
          and not has_function_privilege('anon', 'public.is_following(uuid)', 'execute'),
  'anon executes none of the visibility helpers');

select * from finish();
rollback;
