-- pgTAP · Social 2.0 audit (20261011100000_social_audit_fixes.sql) and the
-- cross-feature combinations an audit worries about.
--
-- Each confirmed problem is asked the way it could have been exploited — a
-- direct RPC call, as the wrong person or as nobody — and a few combinations
-- across features that no single feature's suite covers.
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

-- ---------- people ----------
-- A blocks B. C is uninvolved. E signed up without a name, so full_name is the address.
insert into auth.users (id, email, raw_user_meta_data) values
  ('a1000000-0000-0000-0000-00000000000a', 'a@au.test', '{"full_name":"Ana","username":"anaau"}'),
  ('a1000000-0000-0000-0000-00000000000b', 'b@au.test', '{"full_name":"Bogdan","username":"bogdanau"}'),
  ('a1000000-0000-0000-0000-00000000000c', 'c@au.test', '{"full_name":"Cara","username":"caraau"}'),
  ('a1000000-0000-0000-0000-00000000000e', 'secret.person@private-mail.test', '{"username":"eeau"}');
update public.users set stats_visibility = 'public', fitness_score_visibility = 'public',
                        fitness_score_public = 71, fitness_score_public_at = now()
  where id = 'a1000000-0000-0000-0000-00000000000b';

-- B has a badge, two days of training (a streak), a public program and a public post with a comment.
insert into public.user_badges (user_id, badge_id)
  select 'a1000000-0000-0000-0000-00000000000b', id from public.badges where active order by sort limit 1;
insert into public.logged_sessions (user_id, client_generated_id, started_at, completed_at) values
  ('a1000000-0000-0000-0000-00000000000b', gen_random_uuid(), now() - interval '1 day 2 hours', now() - interval '1 day 1 hour'),
  ('a1000000-0000-0000-0000-00000000000b', gen_random_uuid(), now() - interval '2 hours', now() - interval '1 hour');
insert into public.programs (id, coach_id, client_id, name, status, visibility)
  values ('a4000000-0000-0000-0000-00000000000b', null, 'a1000000-0000-0000-0000-00000000000b', 'Bogdan PPL', 'published', 'public');
insert into public.program_days (program_id, week_index, day_index, name)
  values ('a4000000-0000-0000-0000-00000000000b', 1, 0, 'Push');
insert into public.social_posts (id, user_id, type, text, visibility) values
  ('a2000000-0000-0000-0000-00000000000b', 'a1000000-0000-0000-0000-00000000000b', 'text', 'bogdan public', 'public'),
  ('a2000000-0000-0000-0000-00000000000c', 'a1000000-0000-0000-0000-00000000000c', 'text', 'cara public', 'public');
insert into public.social_comments (post_id, user_id, body) values
  ('a2000000-0000-0000-0000-00000000000b', 'a1000000-0000-0000-0000-00000000000c', 'nice');
insert into public.social_reactions (post_id, user_id) values
  ('a2000000-0000-0000-0000-00000000000b', 'a1000000-0000-0000-0000-00000000000c');

-- ---------- before the block, A can see B's stats ----------
select pg_temp.authenticate_as('a1000000-0000-0000-0000-00000000000a');
select is((select count(*)::int from public.social_badges('a1000000-0000-0000-0000-00000000000b')), 1, 'before: B''s badges are visible (public stats)');
select is((select current_days from public.social_streak('a1000000-0000-0000-0000-00000000000b')) > 0, true, 'before: B''s streak too');
select is((select fitness_score from public.social_profile('a1000000-0000-0000-0000-00000000000b')), 71, 'before: B''s published Fitness Score too');
select is((select count(*)::int from public.social_profile_programs('a1000000-0000-0000-0000-00000000000b')), 1, 'before: B''s public program too');

-- ================= 1. block + stats / badges / streak / Fitness Score =================
select public.social_block_user('a1000000-0000-0000-0000-00000000000b');
select is((select count(*)::int from public.social_badges('a1000000-0000-0000-0000-00000000000b')), 0,
  'block: B''s badges, asked for directly, are gone');
select is((select count(*)::int from public.social_streak('a1000000-0000-0000-0000-00000000000b') where current_days > 0 or longest_days > 0), 0,
  '…so is B''s streak');
select is(public.can_see_fitness_score('a1000000-0000-0000-0000-00000000000b'), false, '…and B''s Fitness Score');
select is(public.can_see_stats('a1000000-0000-0000-0000-00000000000b'), false, 'the stats rule itself says no across a block');
select is((select count(*)::int from public.social_profile_programs('a1000000-0000-0000-0000-00000000000b')), 0,
  'block: B''s programs are gone from a direct call too');

select pg_temp.authenticate_as('a1000000-0000-0000-0000-00000000000b');
select is(public.can_see_stats('a1000000-0000-0000-0000-00000000000a'), false, '…and the block works both ways');
select is(public.can_see_stats('a1000000-0000-0000-0000-00000000000b'), true, 'your own stats are always yours');
select is((select count(*)::int from public.social_badges('a1000000-0000-0000-0000-00000000000b')), 1, 'your own badges too');

select pg_temp.authenticate_as('a1000000-0000-0000-0000-00000000000c');
select is((select count(*)::int from public.social_badges('a1000000-0000-0000-0000-00000000000b')), 1,
  'someone uninvolved still sees B''s public badges');
select is((select count(*)::int from public.social_profile_programs('a1000000-0000-0000-0000-00000000000b')), 1, '…and programs');

-- ================= 2. anonymous callers =================
reset role;
set local role anon;
select throws_ok($$ select * from public.social_post_comments('a2000000-0000-0000-0000-00000000000b') $$, '42501', null,
  'anon cannot read a public post''s comments');
select throws_ok($$ select * from public.social_post_kudos('a2000000-0000-0000-0000-00000000000b') $$, '42501', null,
  '…nor its Kudos givers');
select throws_ok($$ select * from public.social_comment_replies('a2000000-0000-0000-0000-00000000000b') $$, '42501', null,
  '…nor replies');
select throws_ok($$ select * from public.social_streak('a1000000-0000-0000-0000-00000000000b') $$, '42501', null,
  '…nor a streak');
select throws_ok($$ select * from public.social_profile_programs('a1000000-0000-0000-0000-00000000000b') $$, '42501', null,
  '…nor a profile''s programs');
select throws_ok($$ select * from public.social_resolve_handles(array['bogdanau']) $$, '42501', null,
  '…nor turn a username into an id');
select throws_ok($$ select * from public.notification_actors(array['a1000000-0000-0000-0000-00000000000b'::uuid]) $$, '42501', null,
  '…nor look anyone up by id');
select throws_ok($$ select public.can_see_stats('a1000000-0000-0000-0000-00000000000b') $$, '42501', null,
  '…nor ask the stats rule');
reset role;
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'social\_%' and has_function_privilege('anon', p.oid, 'EXECUTE')),
  0, 'no social function at all is executable by anon');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('social_blocked_between', 'social_notify_ok', 'social_is_muted')
     and has_function_privilege('authenticated', p.oid, 'EXECUTE')),
  0, 'the internal helpers stayed closed to signed-in users');
select is(
  (select bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE')) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('social_feed', 'social_post_comments', 'social_streak', 'social_badges', 'social_profile')),
  true, '…while the social RPCs stay open to them');

-- ================= 2b. notification actors =================
select pg_temp.authenticate_as('a1000000-0000-0000-0000-00000000000c');
insert into public.social_follows (follower_id, following_id) values ('a1000000-0000-0000-0000-00000000000c', 'a1000000-0000-0000-0000-00000000000a');
select pg_temp.authenticate_as('a1000000-0000-0000-0000-00000000000a');
select is(
  (select array_agg(username order by username)::text from public.notification_actors(array[
     'a1000000-0000-0000-0000-00000000000c'::uuid, 'a1000000-0000-0000-0000-00000000000e'::uuid])),
  '{caraau}', 'notification_actors names only people in your own notifications');
select is((select count(*)::int from public.notification_actors(array['a1000000-0000-0000-0000-00000000000b'::uuid])), 0,
  '…and never someone behind a block');

-- ================= 3. server-managed columns =================
select throws_ok(
  $$ insert into public.social_posts (user_id, type, text, visibility, created_at)
     values ('a1000000-0000-0000-0000-00000000000a', 'text', 'pinned forever', 'public', now() + interval '10 years') $$,
  '42501', null, 'a post cannot be dated into the future to sit on top of every feed');
select throws_ok(
  $$ insert into public.social_posts (user_id, type, text, visibility, edited_at)
     values ('a1000000-0000-0000-0000-00000000000a', 'text', 'x', 'public', now()) $$,
  '42501', null, '…nor arrive already "edited"');
select lives_ok(
  $$ insert into public.social_posts (user_id, type, text, visibility)
     values ('a1000000-0000-0000-0000-00000000000a', 'text', 'normal post', 'public') $$,
  'a normal post, as the app sends it, still goes through');
select throws_ok(
  $$ insert into public.social_comments (post_id, user_id, body, created_at)
     values ('a2000000-0000-0000-0000-00000000000c', 'a1000000-0000-0000-0000-00000000000a', 'x', now() - interval '1 year') $$,
  '42501', null, 'a comment cannot be back-dated');
select lives_ok(
  $$ insert into public.social_comments (post_id, user_id, body) values ('a2000000-0000-0000-0000-00000000000c', 'a1000000-0000-0000-0000-00000000000a', 'hi') $$,
  '…a normal comment goes through');
select throws_ok(
  $$ insert into public.social_reactions (post_id, user_id, created_at)
     values ('a2000000-0000-0000-0000-00000000000c', 'a1000000-0000-0000-0000-00000000000a', now() - interval '1 year') $$,
  '42501', null, 'Kudos cannot be back-dated to become the "first" giver');
select throws_ok(
  $$ insert into public.social_follows (follower_id, following_id, created_at)
     values ('a1000000-0000-0000-0000-00000000000a', 'a1000000-0000-0000-0000-00000000000c', now() + interval '1 year') $$,
  '42501', null, 'a follow cannot be dated');
select throws_ok(
  $$ update public.social_follows set following_id = 'a1000000-0000-0000-0000-00000000000e' where follower_id = 'a1000000-0000-0000-0000-00000000000a' $$,
  '42501', null, 'a follow cannot be re-pointed');

-- ================= 4. people search and e-mail addresses =================
select is((select count(*)::int from public.social_search_users('private-mail')), 0,
  'searching part of an e-mail address finds nobody');
select is((select count(*)::int from public.social_search_users('secret.person')), 0, '…nor the local part');
select is((select array_agg(username)::text from public.social_search_users('eeau')), '{eeau}', 'the username is still found');
select is((select array_agg(username)::text from public.social_search_users('Cara')), '{caraau}', '…and a real display name');

-- ================= cross-feature =================
-- followers-only + block: a follower who gets blocked loses the post at once
select pg_temp.authenticate_as('a1000000-0000-0000-0000-00000000000c');
insert into public.social_posts (id, user_id, type, text, visibility)
  values ('a2000000-0000-0000-0000-0000000000c2', 'a1000000-0000-0000-0000-00000000000c', 'text', 'cara followers', 'followers');
select pg_temp.authenticate_as('a1000000-0000-0000-0000-00000000000a');
insert into public.social_follows (follower_id, following_id) values ('a1000000-0000-0000-0000-00000000000a', 'a1000000-0000-0000-0000-00000000000c');
select is((select count(*)::int from public.social_post('a2000000-0000-0000-0000-0000000000c2')), 1, 'a follower sees a followers-only post');
select pg_temp.authenticate_as('a1000000-0000-0000-0000-00000000000c');
select public.social_block_user('a1000000-0000-0000-0000-00000000000a');
select pg_temp.authenticate_as('a1000000-0000-0000-0000-00000000000a');
select is((select count(*)::int from public.social_post('a2000000-0000-0000-0000-0000000000c2')), 0,
  '…and loses it the moment the author blocks them');
select is((select count(*)::int from public.social_badges('a1000000-0000-0000-0000-00000000000c')), 0,
  '…together with the author''s badges');

select * from finish();
rollback;
