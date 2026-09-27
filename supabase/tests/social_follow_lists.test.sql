-- pgTAP · Social 2.0 part 3: follow / unfollow, the follow lists and their
-- search, profile counts, and keeping suspended and deleting accounts off the
-- social surfaces (20261003100000_social_follow_lists.sql).
--
-- Run with a local stack up:  npm run db:test
-- Or without Docker:          npm run db:test:offline

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

create or replace function pg_temp.rows_touched(p_sql text)
returns int language plpgsql as $fn$
declare v_n int;
begin
  execute p_sql;
  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

create or replace function pg_temp.notes(p_user uuid, p_category text)
returns int language sql stable security definer as $fn$
  select count(*)::int from public.notifications
  where user_id = p_user and category::text = p_category;
$fn$;

-- ---------- people ----------
-- STAR is followed by ALEX, BRIANA and MAIL (no display name, so full_name is
-- the address). SUS will be suspended, GONE asks for deletion; both follow
-- STAR too. VIEWER follows nobody and reads everything.
insert into auth.users (id, email, raw_user_meta_data) values
  ('7c000000-0000-0000-0000-000000000001', 'star@fl.test',   '{"full_name":"Star Lifter","username":"starfl"}'),
  ('7c000000-0000-0000-0000-000000000002', 'alex@fl.test',   '{"full_name":"Alexandru Pop","username":"alexfl"}'),
  ('7c000000-0000-0000-0000-000000000003', 'briana@fl.test', '{"full_name":"Briana Ionescu","username":"brianafl"}'),
  ('7c000000-0000-0000-0000-000000000004', 'mailonly@secret-domain.test', '{"username":"mailfl"}'),
  ('7c000000-0000-0000-0000-000000000005', 'sus@fl.test',    '{"full_name":"Sus Pended","username":"susfl"}'),
  ('7c000000-0000-0000-0000-000000000006', 'gone@fl.test',   '{"full_name":"Gone Soon","username":"gonefl"}'),
  ('7c000000-0000-0000-0000-000000000007', 'viewer@fl.test', '{"full_name":"View Er","username":"viewerfl"}');

-- ---------- 1. follow: self, duplicates, RLS ----------
select pg_temp.authenticate_as('7c000000-0000-0000-0000-000000000002');

select throws_ok(
  $$ insert into public.social_follows (follower_id, following_id)
     values ('7c000000-0000-0000-0000-000000000002', '7c000000-0000-0000-0000-000000000002') $$,
  '23514', null, 'nobody can follow themselves — the database says no, not just the button');

select lives_ok(
  $$ insert into public.social_follows (follower_id, following_id)
     values ('7c000000-0000-0000-0000-000000000002', '7c000000-0000-0000-0000-000000000001') $$,
  'ALEX follows STAR');

select throws_ok(
  $$ insert into public.social_follows (follower_id, following_id)
     values ('7c000000-0000-0000-0000-000000000002', '7c000000-0000-0000-0000-000000000001') $$,
  '23505', null, 'a second identical follow is refused by the unique pair');

select lives_ok(
  $$ insert into public.social_follows (follower_id, following_id)
     values ('7c000000-0000-0000-0000-000000000002', '7c000000-0000-0000-0000-000000000001')
     on conflict (follower_id, following_id) do nothing $$,
  '…and the upsert the follow() action sends is a quiet no-op');

select throws_ok(
  $$ insert into public.social_follows (follower_id, following_id)
     values ('7c000000-0000-0000-0000-000000000003', '7c000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'nobody can create a follow on someone else''s behalf');

reset role;
select set_config('request.jwt.claims', '', true);
select is(
  (select count(*)::int from public.social_follows
   where follower_id = '7c000000-0000-0000-0000-000000000002' and following_id = '7c000000-0000-0000-0000-000000000001'),
  1, 'after all of that, exactly one edge');

-- ---------- 2. the notification: once per pair, pointing at the follower ----------
select is(pg_temp.notes('7c000000-0000-0000-0000-000000000001', 'new_follower'), 1, 'STAR is told once');
select is(
  (select payload ->> 'follower_id' from public.notifications
   where user_id = '7c000000-0000-0000-0000-000000000001' and category::text = 'new_follower'),
  '7c000000-0000-0000-0000-000000000002', '…and the notification names ALEX, which is what links it to the profile');

select pg_temp.authenticate_as('7c000000-0000-0000-0000-000000000002');
select is(pg_temp.rows_touched(
  $$ delete from public.social_follows
     where follower_id = '7c000000-0000-0000-0000-000000000002' and following_id = '7c000000-0000-0000-0000-000000000001' $$),
  1, 'ALEX unfollows');
select is(pg_temp.rows_touched(
  $$ delete from public.social_follows
     where follower_id = '7c000000-0000-0000-0000-000000000002' and following_id = '7c000000-0000-0000-0000-000000000001' $$),
  0, 'a second unfollow finds nothing — the end state is the same, which is why unfollow() is idempotent');
insert into public.social_follows (follower_id, following_id)
  values ('7c000000-0000-0000-0000-000000000002', '7c000000-0000-0000-0000-000000000001');
select is(pg_temp.notes('7c000000-0000-0000-0000-000000000001', 'new_follower'), 1,
  'follow → unfollow → follow does not ping STAR a second time');

select pg_temp.authenticate_as('7c000000-0000-0000-0000-000000000003');
select is(pg_temp.rows_touched(
  $$ delete from public.social_follows
     where follower_id = '7c000000-0000-0000-0000-000000000002' and following_id = '7c000000-0000-0000-0000-000000000001' $$),
  0, 'nobody can remove someone else''s follow');

-- ---------- the rest of the graph ----------
reset role;
select set_config('request.jwt.claims', '', true);
insert into public.social_follows (follower_id, following_id, created_at) values
  ('7c000000-0000-0000-0000-000000000003', '7c000000-0000-0000-0000-000000000001', now() + interval '1 second'),
  ('7c000000-0000-0000-0000-000000000004', '7c000000-0000-0000-0000-000000000001', now() + interval '2 seconds'),
  ('7c000000-0000-0000-0000-000000000005', '7c000000-0000-0000-0000-000000000001', now() + interval '3 seconds'),
  ('7c000000-0000-0000-0000-000000000006', '7c000000-0000-0000-0000-000000000001', now() + interval '4 seconds'),
  -- STAR follows ALEX back: mutual. VIEWER follows BRIANA, who follows STAR.
  ('7c000000-0000-0000-0000-000000000001', '7c000000-0000-0000-0000-000000000002', now()),
  ('7c000000-0000-0000-0000-000000000007', '7c000000-0000-0000-0000-000000000003', now());
insert into public.social_posts (user_id, type, text, visibility) values
  ('7c000000-0000-0000-0000-000000000005', 'text', 'post by the suspended account', 'public');

-- ---------- 3. counts, relationship, lists ----------
select pg_temp.authenticate_as('7c000000-0000-0000-0000-000000000007');
select is((select followers from public.social_profile('7c000000-0000-0000-0000-000000000001')), 5,
  'STAR''s follower count is a server-side count of every listed follower');
select is((select following from public.social_profile('7c000000-0000-0000-0000-000000000001')), 1,
  '…and the following count likewise');
select is(
  (select count(*)::int from public.social_follow_list('7c000000-0000-0000-0000-000000000001', 'followers', 50)),
  5, 'the followers list holds the same five people');

select pg_temp.authenticate_as('7c000000-0000-0000-0000-000000000001');
select is(
  (select row(is_following, follows_me)::text from public.social_follow_list('7c000000-0000-0000-0000-000000000001', 'followers', 50)
   where id = '7c000000-0000-0000-0000-000000000002'),
  '(t,t)', 'STAR sees ALEX as mutual: STAR follows ALEX and ALEX follows STAR');
select is(
  (select row(is_following, follows_me)::text from public.social_follow_list('7c000000-0000-0000-0000-000000000001', 'followers', 50)
   where id = '7c000000-0000-0000-0000-000000000003'),
  '(f,t)', '…and BRIANA as "follows you"');

-- pagination: newest first, a cursor on followed_at, no overlap
select pg_temp.authenticate_as('7c000000-0000-0000-0000-000000000007');
select is(
  (select array_agg(id order by followed_at desc)::text from public.social_follow_list('7c000000-0000-0000-0000-000000000001', 'followers', 2)),
  '{7c000000-0000-0000-0000-000000000006,7c000000-0000-0000-0000-000000000005}', 'page one is the two newest');
select is(
  (select array_agg(id order by followed_at desc)::text from public.social_follow_list(
     '7c000000-0000-0000-0000-000000000001', 'followers', 2,
     (select min(followed_at) from public.social_follow_list('7c000000-0000-0000-0000-000000000001', 'followers', 2)))),
  '{7c000000-0000-0000-0000-000000000004,7c000000-0000-0000-0000-000000000003}', 'page two continues from the cursor');

-- search, server-side
select is(
  (select array_agg(username)::text from public.social_follow_list('7c000000-0000-0000-0000-000000000001', 'followers', 50, null, 'brian')),
  '{brianafl}', 'search matches the username');
select is(
  (select array_agg(username)::text from public.social_follow_list('7c000000-0000-0000-0000-000000000001', 'followers', 50, null, 'ionescu')),
  '{brianafl}', '…and the display name');
select is(
  (select count(*)::int from public.social_follow_list('7c000000-0000-0000-0000-000000000001', 'followers', 50, null, 'secret-domain')),
  0, '…but never an e-mail address standing in for a display name');
select is(
  (select count(*)::int from public.social_follow_list('7c000000-0000-0000-0000-000000000001', 'followers', 50, null, '%')),
  0, 'a % is a character to look for, not a wildcard');
select is(
  (select count(*)::int from public.social_follow_list('7c000000-0000-0000-0000-000000000001', 'followers', 50, null, '   ')),
  5, 'a blank search is no search');
select throws_ok(
  $$ select * from public.social_follow_list('7c000000-0000-0000-0000-000000000001', 'everyone') $$,
  '22023', null, 'only followers and following are lists');

-- ---------- 4. suspended and deleting accounts ----------
reset role;
select set_config('request.jwt.claims', '', true);
update public.users set suspended_at = now() where id = '7c000000-0000-0000-0000-000000000005';
insert into public.account_deletion_requests (user_id) values ('7c000000-0000-0000-0000-000000000006');

select pg_temp.authenticate_as('7c000000-0000-0000-0000-000000000007');
select is(
  (select count(*)::int from public.social_follow_list('7c000000-0000-0000-0000-000000000001', 'followers', 50)
   where id in ('7c000000-0000-0000-0000-000000000005', '7c000000-0000-0000-0000-000000000006')),
  0, 'suspended and deleting accounts leave the followers list');
select is((select followers from public.social_profile('7c000000-0000-0000-0000-000000000001')), 3,
  '…and the count, so it never promises rows the list will not show');
select is((select count(*)::int from public.social_profile('7c000000-0000-0000-0000-000000000005')), 0,
  'a suspended profile reads as absent');
select is((select count(*)::int from public.social_profile('7c000000-0000-0000-0000-000000000006')), 0,
  'a deleting profile reads as absent');
select is(
  (select count(*)::int from public.social_follow_list('7c000000-0000-0000-0000-000000000005', 'following', 50)),
  0, 'a suspended person''s own lists are closed too');
select is(
  (select count(*)::int from public.social_feed(50, null, null, 'all') where user_id = '7c000000-0000-0000-0000-000000000005'),
  0, 'a suspended author leaves the feed');
select is(
  (select count(*)::int from public.social_post(
     (select id from public.social_posts where user_id = '7c000000-0000-0000-0000-000000000005' limit 1))),
  0, '…and their post''s own page');
select is(
  (select count(*)::int from public.social_search_users('fl', null, 50) where id in (
     '7c000000-0000-0000-0000-000000000005', '7c000000-0000-0000-0000-000000000006')),
  0, 'search already left them out, and still does');
select is(
  (select count(*)::int from public.social_suggested_people(20) where id in (
     '7c000000-0000-0000-0000-000000000005', '7c000000-0000-0000-0000-000000000006')),
  0, 'so do suggestions');

-- the person themselves still sees their own profile
select pg_temp.authenticate_as('7c000000-0000-0000-0000-000000000005');
select is((select count(*)::int from public.social_profile('7c000000-0000-0000-0000-000000000005')), 1,
  'your own profile is never hidden from you');

-- mutual followers: VIEWER follows BRIANA, who follows STAR
select pg_temp.authenticate_as('7c000000-0000-0000-0000-000000000007');
select is(
  (select array_agg(username)::text from public.social_mutual_followers('7c000000-0000-0000-0000-000000000001', 10)),
  '{brianafl}', '"Followed by briana" comes from real edges');

-- ---------- 5. no session, and the helper ----------
select pg_temp.authenticate_as(null);
select is(
  (select count(*)::int from public.social_follow_list('7c000000-0000-0000-0000-000000000001', 'followers', 50)),
  0, 'no signed-in user, no list');
select is((select count(*)::int from public.social_profile('7c000000-0000-0000-0000-000000000001')), 0,
  'no signed-in user, no profile');
reset role;
set local role anon;
select throws_ok(
  $$ select public.is_listed_user('7c000000-0000-0000-0000-000000000005') $$,
  '42501', null, 'whether someone is suspended is not something an anonymous caller may ask');
reset role;

select * from finish();
rollback;
