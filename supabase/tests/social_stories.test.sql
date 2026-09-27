-- pgTAP · Social 2.0 Stories (20261004100000_social_stories.sql)
--
-- Every question is asked the way a hand-made PostgREST call would ask it:
-- straight at the table, or straight at the RPC, as the wrong person.
--
-- Note on time: now() is frozen for the whole transaction, so "created an
-- hour ago" is written by moving created_at / expires_at as the table owner.
--
-- Run with a local stack up:  npm run db:test
-- Or without Docker:          npm run db:test:offline

begin;
create extension if not exists pgtap with schema extensions;
select plan(48);

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

-- the tray, in its order, as an array of user ids
create or replace function pg_temp.tray()
returns uuid[] language sql as $fn$
  select coalesce(array_agg(t.user_id order by t.n), '{}')
  from public.social_story_tray() with ordinality t(user_id, name, avatar_url, is_me, stories, unseen, latest_at, n);
$fn$;

-- ---------- people ----------
-- AUTH posts. FAN follows AUTH, AUTH2, SUS and GONE. STRANGER follows nobody.
-- COACH coaches AUTH. SUS will be suspended, GONE asks for deletion.
insert into auth.users (id, email, raw_user_meta_data) values
  ('5a000000-0000-0000-0000-000000000001', 'auth@st.test',     '{"full_name":"Author","username":"authst"}'),
  ('5a000000-0000-0000-0000-000000000002', 'fan@st.test',      '{"full_name":"Fan","username":"fanst"}'),
  ('5a000000-0000-0000-0000-000000000003', 'stranger@st.test', '{"full_name":"Stranger","username":"strangerst"}'),
  ('5a000000-0000-0000-0000-000000000004', 'coach@st.test',    '{"full_name":"Coach","username":"coachst","role":"coach"}'),
  ('5a000000-0000-0000-0000-000000000005', 'auth2@st.test',    '{"full_name":"Author Two","username":"auth2st"}'),
  ('5a000000-0000-0000-0000-000000000006', 'sus@st.test',      '{"full_name":"Sus","username":"susst"}'),
  ('5a000000-0000-0000-0000-000000000007', 'gone@st.test',     '{"full_name":"Gone","username":"gonest"}');

insert into public.trainer_clients (coach_id, client_id, status, started_at) values
  ('5a000000-0000-0000-0000-000000000004', '5a000000-0000-0000-0000-000000000001', 'active', now());
insert into public.social_follows (follower_id, following_id) values
  ('5a000000-0000-0000-0000-000000000002', '5a000000-0000-0000-0000-000000000001'),
  ('5a000000-0000-0000-0000-000000000002', '5a000000-0000-0000-0000-000000000005'),
  ('5a000000-0000-0000-0000-000000000002', '5a000000-0000-0000-0000-000000000006'),
  ('5a000000-0000-0000-0000-000000000002', '5a000000-0000-0000-0000-000000000007');

-- ---------- 1. creating ----------
select pg_temp.authenticate_as('5a000000-0000-0000-0000-000000000001');
select lives_ok(
  $$ insert into public.social_stories (id, user_id, body, background, created_at, expires_at)
     values ('5b000000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-000000000001',
             'Deadlift day', 'gold', now() - interval '10 days', now() + interval '10 years') $$,
  'AUTH posts a story (with forged timestamps in the request)');
select is(
  (select row(created_at = now(), expires_at = now() + interval '24 hours')::text
   from public.social_stories where id = '5b000000-0000-0000-0000-000000000001'),
  '(t,t)', 'the server''s clock wins: created now, expires in exactly 24 hours');
select throws_ok(
  $$ insert into public.social_stories (user_id, body) values ('5a000000-0000-0000-0000-000000000002', 'fake') $$,
  '42501', null, 'nobody posts a story as someone else');
select throws_ok(
  $$ insert into public.social_stories (user_id, body) values ('5a000000-0000-0000-0000-000000000001', '') $$,
  '23514', null, 'a story needs words');
select throws_ok(
  $$ insert into public.social_stories (user_id, body) values ('5a000000-0000-0000-0000-000000000001', repeat('x', 201)) $$,
  '23514', null, '…at most 200 characters');
select throws_ok(
  $$ insert into public.social_stories (user_id, body, background) values ('5a000000-0000-0000-0000-000000000001', 'hi', 'red') $$,
  '23514', null, 'only the three backgrounds');
select throws_ok(
  $$ update public.social_stories set body = 'edited' where id = '5b000000-0000-0000-0000-000000000001' $$,
  '42501', null, 'a published story cannot be edited');

-- ---------- 2. who can see it ----------
select is((select count(*)::int from public.social_stories), 1, 'the author sees their own story');
select is((select view_count from public.social_user_stories('5a000000-0000-0000-0000-000000000001')), 0,
  '…with a view count, which only the author gets');

select pg_temp.authenticate_as('5a000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.social_stories where user_id = '5a000000-0000-0000-0000-000000000001'), 1,
  'a follower sees it in the table');
select is(pg_temp.tray(), array['5a000000-0000-0000-0000-000000000001']::uuid[], '…and in the tray');
select is(
  (select row(seen, view_count)::text from public.social_user_stories('5a000000-0000-0000-0000-000000000001')),
  '(f,)', '…unseen, and with no view count: that belongs to the author');

select pg_temp.authenticate_as('5a000000-0000-0000-0000-000000000004');
select is((select count(*)::int from public.social_user_stories('5a000000-0000-0000-0000-000000000001')), 1,
  'the active coach sees it — the same audience as a followers-only post');

select pg_temp.authenticate_as('5a000000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.social_stories), 0, 'a non-follower sees nothing in the table');
select is(pg_temp.tray(), '{}'::uuid[], '…nothing in the tray');
select is((select count(*)::int from public.social_user_stories('5a000000-0000-0000-0000-000000000001')), 0,
  '…and nothing when asking for the author by id');
select throws_ok(
  $$ select public.social_mark_story_seen('5b000000-0000-0000-0000-000000000001') $$,
  'P0002', null, '…and cannot even mark it seen');

-- ---------- 3. views ----------
select pg_temp.authenticate_as('5a000000-0000-0000-0000-000000000002');
select is(public.social_mark_story_seen('5b000000-0000-0000-0000-000000000001'), true, 'FAN opens the story');
select is(public.social_mark_story_seen('5b000000-0000-0000-0000-000000000001'), false, 'opening it again records nothing new');
select is((select count(*)::int from public.social_story_views), 1, 'one view, not two');
select is((select seen from public.social_user_stories('5a000000-0000-0000-0000-000000000001')), true,
  'the story now reads as seen for FAN');
select throws_ok(
  $$ insert into public.social_story_views (story_id, viewer_id)
     values ('5b000000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-000000000003') $$,
  '42501', null, 'nobody can write a view by hand — least of all for someone else');
select is((select count(*)::int from public.social_story_viewers('5b000000-0000-0000-0000-000000000001')), 0,
  'a viewer cannot read the list of viewers');

select pg_temp.authenticate_as('5a000000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.social_story_views), 0, 'a stranger reads no views');

select pg_temp.authenticate_as('5a000000-0000-0000-0000-000000000001');
select is(public.social_mark_story_seen('5b000000-0000-0000-0000-000000000001'), false,
  'opening your own story is not a view');
select is((select view_count from public.social_user_stories('5a000000-0000-0000-0000-000000000001')), 1,
  'the author''s count is one');
select is(
  (select array_agg(user_id)::text from public.social_story_viewers('5b000000-0000-0000-0000-000000000001')),
  '{5a000000-0000-0000-0000-000000000002}', '…and the list says who');

-- ---------- 4. the tray: order and unseen ----------
reset role;
select set_config('request.jwt.claims', '', true);
insert into public.social_stories (id, user_id, body) values
  ('5b000000-0000-0000-0000-000000000002', '5a000000-0000-0000-0000-000000000005', 'Second author'),
  ('5b000000-0000-0000-0000-000000000003', '5a000000-0000-0000-0000-000000000002', 'Fan''s own');
-- AUTH's story is the newest of all, but FAN has seen it.
update public.social_stories set created_at = now() - interval '1 hour', expires_at = now() + interval '23 hours'
  where id = '5b000000-0000-0000-0000-000000000002';
update public.social_stories set created_at = now() - interval '2 hours', expires_at = now() + interval '22 hours'
  where id = '5b000000-0000-0000-0000-000000000003';

select pg_temp.authenticate_as('5a000000-0000-0000-0000-000000000002');
select is(
  pg_temp.tray(),
  array['5a000000-0000-0000-0000-000000000002', '5a000000-0000-0000-0000-000000000005', '5a000000-0000-0000-0000-000000000001']::uuid[],
  'the tray: you first, then unseen, then seen — newer first within each');
select is(
  (select array_agg(unseen order by user_id)::text from public.social_story_tray()),
  '{0,0,1}', 'unseen counts by user id: AUTH none (seen), FAN none (own), AUTH2 one');

-- ---------- 5. suspended and deleting authors ----------
reset role;
select set_config('request.jwt.claims', '', true);
insert into public.social_stories (id, user_id, body) values
  ('5b000000-0000-0000-0000-000000000006', '5a000000-0000-0000-0000-000000000006', 'Suspended soon'),
  ('5b000000-0000-0000-0000-000000000007', '5a000000-0000-0000-0000-000000000007', 'Deleting soon');
update public.users set suspended_at = now() where id = '5a000000-0000-0000-0000-000000000006';
insert into public.account_deletion_requests (user_id) values ('5a000000-0000-0000-0000-000000000007');

select pg_temp.authenticate_as('5a000000-0000-0000-0000-000000000002');
select is(
  (select count(*)::int from public.social_story_tray()
   where user_id in ('5a000000-0000-0000-0000-000000000006', '5a000000-0000-0000-0000-000000000007')),
  0, 'suspended and deleting authors leave the tray');
select is(
  (select count(*)::int from public.social_stories
   where user_id in ('5a000000-0000-0000-0000-000000000006', '5a000000-0000-0000-0000-000000000007')),
  0, '…and the table');
select is((select count(*)::int from public.social_user_stories('5a000000-0000-0000-0000-000000000006')), 0,
  '…and a request by id');

-- ---------- 6. the 24-hour boundary and direct access ----------
reset role;
select set_config('request.jwt.claims', '', true);
update public.social_stories
  set created_at = now() - interval '23 hours 59 minutes', expires_at = now() + interval '1 minute'
  where id = '5b000000-0000-0000-0000-000000000002';
select pg_temp.authenticate_as('5a000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.social_user_stories('5a000000-0000-0000-0000-000000000005')), 1,
  'at 23h59m a story is still up');

reset role;
select set_config('request.jwt.claims', '', true);
update public.social_stories
  set created_at = now() - interval '24 hours', expires_at = now()
  where id = '5b000000-0000-0000-0000-000000000002';
select pg_temp.authenticate_as('5a000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.social_user_stories('5a000000-0000-0000-0000-000000000005')), 0,
  'at exactly 24h it is gone');
select is((select count(*)::int from public.social_stories where id = '5b000000-0000-0000-0000-000000000002'), 0,
  '…from the table, even asked for by id');
select is(
  (select count(*)::int from public.social_story_tray() where user_id = '5a000000-0000-0000-0000-000000000005'),
  0, '…and from the tray');
select throws_ok(
  $$ select public.social_mark_story_seen('5b000000-0000-0000-0000-000000000002') $$,
  'P0002', null, 'an expired story cannot be opened by id');

select pg_temp.authenticate_as('5a000000-0000-0000-0000-000000000005');
select is((select count(*)::int from public.social_user_stories('5a000000-0000-0000-0000-000000000005')), 0,
  'expired is expired for the author too');

-- ---------- 7. deleting ----------
select pg_temp.authenticate_as('5a000000-0000-0000-0000-000000000003');
select is(pg_temp.rows_touched($$ delete from public.social_stories where id = '5b000000-0000-0000-0000-000000000001' $$), 0,
  'a stranger cannot delete AUTH''s story');
select pg_temp.authenticate_as('5a000000-0000-0000-0000-000000000002');
select is(pg_temp.rows_touched($$ delete from public.social_stories where id = '5b000000-0000-0000-0000-000000000001' $$), 0,
  'nor can a follower');
select pg_temp.authenticate_as('5a000000-0000-0000-0000-000000000001');
select is(pg_temp.rows_touched($$ delete from public.social_stories where id = '5b000000-0000-0000-0000-000000000001' $$), 1,
  'the author can');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from public.social_story_views where story_id = '5b000000-0000-0000-0000-000000000001'), 0,
  'its views go with it');

-- ---------- 8. the live-story cap ----------
select pg_temp.authenticate_as('5a000000-0000-0000-0000-000000000001');
select lives_ok(
  $$ insert into public.social_stories (user_id, body)
     select '5a000000-0000-0000-0000-000000000001', 'story ' || g from generate_series(1, 30) g $$,
  'thirty live stories are allowed');
select throws_ok(
  $$ insert into public.social_stories (user_id, body) values ('5a000000-0000-0000-0000-000000000001', 'one too many') $$,
  '54000', null, 'the thirty-first is not');

-- ---------- 9. no session ----------
select pg_temp.authenticate_as(null);
select is(pg_temp.tray(), '{}'::uuid[], 'no signed-in user, empty tray');
select is((select count(*)::int from public.social_stories), 0, 'no signed-in user, no stories');
reset role;
set local role anon;
select throws_ok($$ select * from public.social_story_tray() $$, '42501', null, 'anonymous callers cannot call the tray');
select throws_ok(
  $$ select public.social_mark_story_seen('5b000000-0000-0000-0000-000000000003') $$,
  '42501', null, '…nor mark anything seen');
reset role;

select * from finish();
rollback;
