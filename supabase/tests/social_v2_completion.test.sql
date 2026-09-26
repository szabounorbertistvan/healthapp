-- pgTAP · social v2 completion: profile privacy, badges, achievement and
-- Fitness Score posts, immutable snapshots, comment edits, caption mentions,
-- paged replies, people search and suggestions.
--
-- The question under every case: can a hand-made PostgREST call reach
-- something the page would not show? The security-definer RPCs are the
-- obvious candidates — they bypass RLS by design, so each one has to carry
-- its own gate, and these assertions call them directly, as the wrong person.
--
-- Run with a local stack up:  npm run db:test
-- Or without Docker:          npm run db:test:offline

begin;
create extension if not exists pgtap with schema extensions;
select plan(59);

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

-- Trigger questions are asked as the owner of the database, not through RLS.
create or replace function pg_temp.notes(p_user uuid, p_category text)
returns int language sql stable security definer as $fn$
  select count(*)::int from public.notifications
  where user_id = p_user and category::text = p_category;
$fn$;
create or replace function pg_temp.has_badge(p_user uuid, p_slug text)
returns boolean language sql stable security definer as $fn$
  select exists (select 1 from public.user_badges ub join public.badges b on b.id = ub.badge_id
                 where ub.user_id = p_user and b.slug = p_slug);
$fn$;

-- ---------- people ----------
-- OWNER trains and posts. FAN follows OWNER. STRANGER follows nobody. COACH
-- coaches OWNER. GHOST asked for deletion. POPULAR is followed by FAN.
insert into auth.users (id, email, raw_user_meta_data) values
  ('6b000000-0000-0000-0000-00000000000a', 'owner@v2c.test',    '{"full_name":"Owner V2C","username":"ownerv2c"}'),
  ('6b000000-0000-0000-0000-00000000000f', 'fan@v2c.test',      '{"full_name":"Fan V2C","username":"fanv2c"}'),
  ('6b000000-0000-0000-0000-000000000005', 'stranger@v2c.test', '{"full_name":"Stranger V2C","username":"strangerv2c"}'),
  ('6b000000-0000-0000-0000-00000000000c', 'coach@v2c.test',    '{"full_name":"Coach V2C","username":"coachv2c","role":"coach"}'),
  ('6b000000-0000-0000-0000-000000000009', 'ghost@v2c.test',    '{"full_name":"Ghost V2C","username":"ghostv2c"}'),
  ('6b000000-0000-0000-0000-000000000077', 'popular@v2c.test',  '{"full_name":"Popular V2C","username":"popularv2c"}');

insert into public.trainer_clients (coach_id, client_id, status, started_at) values
  ('6b000000-0000-0000-0000-00000000000c', '6b000000-0000-0000-0000-00000000000a', 'active', now());
insert into public.social_follows (follower_id, following_id) values
  ('6b000000-0000-0000-0000-00000000000f', '6b000000-0000-0000-0000-00000000000a'),
  ('6b000000-0000-0000-0000-00000000000f', '6b000000-0000-0000-0000-000000000077');
insert into public.account_deletion_requests (user_id) values ('6b000000-0000-0000-0000-000000000009');

insert into public.exercises (id, name_en, source) values
  ('6be00000-0000-0000-0000-000000000001', 'Squat V2C', 'custom');

-- One completed workout with a PR — enough for first-workout and first-pr.
insert into public.logged_sessions (id, user_id, client_generated_id, started_at, completed_at) values
  ('6b500000-0000-0000-0000-000000000001', '6b000000-0000-0000-0000-00000000000a',
   '6b500000-0000-0000-0000-000000000001', now() - interval '2 hours', null);
insert into public.logged_sets (session_id, user_id, exercise_id, client_generated_id, set_index, reps, weight_kg, is_pr) values
  ('6b500000-0000-0000-0000-000000000001', '6b000000-0000-0000-0000-00000000000a',
   '6be00000-0000-0000-0000-000000000001', gen_random_uuid(), 1, 5, 120, true);

delete from public.notifications;

-- ---------- 1. badges are awarded by the engine, on completion ----------
select is(pg_temp.has_badge('6b000000-0000-0000-0000-00000000000a', 'first-workout'), false,
  'an unfinished session earns nothing');
update public.logged_sessions set completed_at = now() - interval '1 hour'
where id = '6b500000-0000-0000-0000-000000000001';
select is(pg_temp.has_badge('6b000000-0000-0000-0000-00000000000a', 'first-workout'), true,
  'completing a workout awards first-workout');
select is(pg_temp.has_badge('6b000000-0000-0000-0000-00000000000a', 'first-pr'), true,
  'a PR set in that workout awards first-pr');
select is(pg_temp.has_badge('6b000000-0000-0000-0000-00000000000a', 'workouts-10'), false,
  'one workout does not award workouts-10');
select is(pg_temp.notes('6b000000-0000-0000-0000-00000000000a', 'badge_earned'), 2,
  'each new badge notifies its owner once');
update public.logged_sessions set completed_at = now() - interval '30 minutes'
where id = '6b500000-0000-0000-0000-000000000001';
select is(pg_temp.notes('6b000000-0000-0000-0000-00000000000a', 'badge_earned'), 2,
  'running the award again does not re-award or re-notify');

select pg_temp.authenticate_as('6b000000-0000-0000-0000-00000000000a');
select throws_ok($$
  insert into public.user_badges (user_id, badge_id)
  select '6b000000-0000-0000-0000-00000000000a', id from public.badges where slug = 'workouts-100'
$$, '42501', null, 'nobody can award themselves a badge');
select throws_ok($$ select public.award_badges_for('6b000000-0000-0000-0000-00000000000a') $$,
  '42501', null, 'the award engine is not callable by users');
select throws_ok($$ select public.longest_workout_streak('6b000000-0000-0000-0000-00000000000a') $$,
  '42501', null, 'the ungated streak helper is not callable by users');

-- ---------- 2. profile privacy: stats ----------
-- Default is public: today's behaviour.
select pg_temp.authenticate_as('6b000000-0000-0000-0000-000000000005');
select is((select workouts from public.social_profile('6b000000-0000-0000-0000-00000000000a')), 1,
  'public stats: a stranger sees the workout count');
select is((select stats_visibility from public.social_profile('6b000000-0000-0000-0000-00000000000a')), null,
  'the privacy settings themselves are never shown to someone else');

select pg_temp.authenticate_as('6b000000-0000-0000-0000-00000000000a');
select is(pg_temp.rows_touched($$update public.users set stats_visibility = 'followers'
                                  where id = '6b000000-0000-0000-0000-00000000000a'$$), 1,
  'the owner can change their stats visibility');
select is((select stats_visibility from public.social_profile('6b000000-0000-0000-0000-00000000000a')), 'followers',
  'the owner reads their own setting back');

select pg_temp.authenticate_as('6b000000-0000-0000-0000-000000000005');
select is((select workouts from public.social_profile('6b000000-0000-0000-0000-00000000000a')), null,
  'followers-only stats: a stranger gets null, not zero');
select is((select prs from public.social_profile('6b000000-0000-0000-0000-00000000000a')), null,
  'followers-only stats: the PR count is hidden too');
select is((select stats_visible from public.social_profile('6b000000-0000-0000-0000-00000000000a')), false,
  'the profile says the stats are hidden');
select is((select longest_days from public.social_streak('6b000000-0000-0000-0000-00000000000a')), 0,
  'social_streak() called directly answers 0 for hidden stats');
select is((select count(*)::int from public.social_badges('6b000000-0000-0000-0000-00000000000a')), 0,
  'social_badges() called directly lists nothing for hidden stats');
select is((select followers from public.social_profile('6b000000-0000-0000-0000-00000000000a')), 1,
  'follow counts stay visible — they are the public graph');

select pg_temp.authenticate_as('6b000000-0000-0000-0000-00000000000f');
select is((select workouts from public.social_profile('6b000000-0000-0000-0000-00000000000a')), 1,
  'followers-only stats: a follower sees them');
select is((select count(*)::int from public.social_badges('6b000000-0000-0000-0000-00000000000a')), 2,
  'a follower sees the badges');
select is((select bool_or(shared) from public.social_badges('6b000000-0000-0000-0000-00000000000a')), false,
  '"already shared" is never answered to someone else');

select pg_temp.authenticate_as('6b000000-0000-0000-0000-00000000000a');
update public.users set stats_visibility = 'private' where id = '6b000000-0000-0000-0000-00000000000a';

select pg_temp.authenticate_as('6b000000-0000-0000-0000-00000000000f');
select is((select workouts from public.social_profile('6b000000-0000-0000-0000-00000000000a')), null,
  'private stats: following changes nothing');

select pg_temp.authenticate_as('6b000000-0000-0000-0000-00000000000c');
select is((select workouts from public.social_profile('6b000000-0000-0000-0000-00000000000a')), 1,
  'private stats: the active coach still sees them (they see the sessions anyway)');

select pg_temp.authenticate_as('6b000000-0000-0000-0000-00000000000a');
select is((select workouts from public.social_profile('6b000000-0000-0000-0000-00000000000a')), 1,
  'private stats: the owner always sees their own');

-- ---------- 3. the Fitness Score snapshot ----------
-- Publishing and sharing a score with real sessions behind it, and every
-- attempt to publish a made-up one, live in social_v2_cleanup.test.sql since
-- 20260930130000 moved the computation into the database.
select throws_ok($$ update public.users set fitness_score_public = 99 where id = '6b000000-0000-0000-0000-00000000000a' $$,
  '42501', null, 'the snapshot column cannot be written directly');

select pg_temp.authenticate_as('6b000000-0000-0000-0000-00000000000f');
select is((select fitness_score from public.social_profile('6b000000-0000-0000-0000-00000000000a')), null,
  'the score is private by default, even to a follower');

-- ---------- 4. achievement and Fitness Score posts ----------
select pg_temp.authenticate_as('6b000000-0000-0000-0000-00000000000a');
select lives_ok($$
  insert into public.social_posts (id, user_id, type, payload, visibility)
  values ('6bb00000-0000-0000-0000-000000000001', '6b000000-0000-0000-0000-00000000000a', 'achievement',
          '{"kind":"achievement","badge_slug":"first-pr","name_en":"World record","secret":"x"}', 'public')
$$, 'an earned badge can be shared');
select is((select payload ->> 'name_en' from public.social_posts where id = '6bb00000-0000-0000-0000-000000000001'),
  'First PR', 'the payload is rebuilt from the catalog, not taken from the browser');
select is((select payload ? 'secret' from public.social_posts where id = '6bb00000-0000-0000-0000-000000000001'),
  false, 'keys the catalog does not know are dropped');
select throws_ok($$
  insert into public.social_posts (user_id, type, payload, visibility)
  values ('6b000000-0000-0000-0000-00000000000a', 'achievement', '{"kind":"achievement","badge_slug":"workouts-100"}', 'public')
$$, '42501', null, 'an unearned badge cannot be posted');
select throws_ok($$
  insert into public.social_posts (user_id, type, payload, visibility)
  values ('6b000000-0000-0000-0000-00000000000a', 'achievement', '{"kind":"achievement","badge_slug":"first-pr"}', 'public')
$$, '23505', null, 'a badge is shared once');
select is((select bool_or(shared) from public.social_badges('6b000000-0000-0000-0000-00000000000a')), true,
  'the owner is told which badges they already shared');

-- One completed workout is not a score yet: nothing to share, whatever is sent.
select throws_ok($$
  insert into public.social_posts (user_id, type, payload, visibility)
  values ('6b000000-0000-0000-0000-00000000000a', 'fitness_score', '{"kind":"fitness_score","score":72,"milestone":70,"band":"strong_activity"}', 'public')
$$, '22023', null, 'a Fitness Score that is still building cannot be shared, whatever number is sent');
select throws_ok($$
  insert into public.social_posts (user_id, type, payload, visibility)
  values ('6b000000-0000-0000-0000-00000000000a', 'pr', '{"kind":"workout","name":"x"}', 'public')
$$, '22023', null, 'a payload must match its post type');

-- ---------- 5. snapshots are immutable ----------
select throws_ok($$
  update public.social_posts set payload = '{"kind":"achievement","badge_slug":"streak-100"}'
  where id = '6bb00000-0000-0000-0000-000000000001'
$$, '42501', null, 'the owner cannot rewrite a published payload');
select throws_ok($$
  update public.social_posts set type = 'text' where id = '6bb00000-0000-0000-0000-000000000001'
$$, '42501', null, 'the owner cannot change a post''s type');
select is(pg_temp.rows_touched($$update public.social_posts set text = 'Finally!'
                                  where id = '6bb00000-0000-0000-0000-000000000001'$$), 1,
  'the owner can still re-caption their post');

-- ---------- 6. caption mentions ----------
insert into public.social_posts (id, user_id, type, text, visibility) values
  ('6bb00000-0000-0000-0000-000000000002', '6b000000-0000-0000-0000-00000000000a', 'text', 'with @fanv2c and @strangerv2c', 'followers'),
  ('6bb00000-0000-0000-0000-000000000003', '6b000000-0000-0000-0000-00000000000a', 'text', 'secret @fanv2c', 'private');
reset role;
delete from public.notifications;
select pg_temp.authenticate_as('6b000000-0000-0000-0000-00000000000a');
insert into public.social_post_mentions (post_id, user_id) values
  ('6bb00000-0000-0000-0000-000000000002', '6b000000-0000-0000-0000-00000000000f'),
  ('6bb00000-0000-0000-0000-000000000002', '6b000000-0000-0000-0000-000000000005'),
  ('6bb00000-0000-0000-0000-000000000003', '6b000000-0000-0000-0000-00000000000f');
select is(pg_temp.notes('6b000000-0000-0000-0000-00000000000f', 'new_mention'), 1,
  'a follower mentioned in a followers post is notified — once, not for the private one');
select is(pg_temp.notes('6b000000-0000-0000-0000-000000000005', 'new_mention'), 0,
  'a mention does not notify someone who cannot see the post');

select pg_temp.authenticate_as('6b000000-0000-0000-0000-000000000005');
select throws_ok($$
  insert into public.social_post_mentions (post_id, user_id)
  values ('6bb00000-0000-0000-0000-000000000002', '6b000000-0000-0000-0000-000000000005')
$$, '42501', null, 'nobody can add a mention to someone else''s post');
select is((select count(*)::int from public.social_post_mentions
           where post_id = '6bb00000-0000-0000-0000-000000000003'), 0,
  'mention rows of a post you cannot see are invisible');
select throws_ok($$ select public.user_can_see_post('6b000000-0000-0000-0000-00000000000f', '6bb00000-0000-0000-0000-000000000003') $$,
  '42501', null, 'the on-behalf visibility check is not callable by users');

select pg_temp.authenticate_as('6b000000-0000-0000-0000-00000000000f');
select is((select jsonb_array_length(mentions) from public.social_post('6bb00000-0000-0000-0000-000000000002')), 2,
  'the post carries its resolved mentions');

-- ---------- 7. comment edits ----------
insert into public.social_comments (id, post_id, user_id, body) values
  ('6bc00000-0000-0000-0000-000000000001', '6bb00000-0000-0000-0000-000000000002', '6b000000-0000-0000-0000-00000000000f', 'Nice');
select is(pg_temp.rows_touched($$update public.social_comments set body = 'Nice one'
                                  where id = '6bc00000-0000-0000-0000-000000000001'$$), 1,
  'the author edits their own comment');
select isnt((select edited_at from public.social_comments where id = '6bc00000-0000-0000-0000-000000000001'), null,
  'an edit is stamped');
select throws_ok($$
  update public.social_comments set post_id = '6bb00000-0000-0000-0000-000000000003'
  where id = '6bc00000-0000-0000-0000-000000000001'
$$, '42501', null, 'a comment cannot be moved to another post');

select pg_temp.authenticate_as('6b000000-0000-0000-0000-000000000005');
select is(pg_temp.rows_touched($$update public.social_comments set body = 'hijacked'
                                  where id = '6bc00000-0000-0000-0000-000000000001'$$), 0,
  'nobody else can edit it');

-- The author unfollows: the post is no longer theirs to read, nor their comment to edit.
select pg_temp.authenticate_as('6b000000-0000-0000-0000-00000000000f');
delete from public.social_follows where follower_id = '6b000000-0000-0000-0000-00000000000f'
  and following_id = '6b000000-0000-0000-0000-00000000000a';
select is(pg_temp.rows_touched($$update public.social_comments set body = 'late edit'
                                  where id = '6bc00000-0000-0000-0000-000000000001'$$), 0,
  'losing sight of the post ends the right to edit on it');
insert into public.social_follows (follower_id, following_id) values
  ('6b000000-0000-0000-0000-00000000000f', '6b000000-0000-0000-0000-00000000000a');

-- ---------- 8. replies are paged ----------
select pg_temp.authenticate_as('6b000000-0000-0000-0000-00000000000a');
insert into public.social_comments (post_id, user_id, body, parent_id, created_at)
select '6bb00000-0000-0000-0000-000000000002', '6b000000-0000-0000-0000-00000000000a', 'reply ' || g,
       '6bc00000-0000-0000-0000-000000000001', now() + (g || ' seconds')::interval
from generate_series(1, 5) g;

select pg_temp.authenticate_as('6b000000-0000-0000-0000-00000000000f');
select is((select count(*)::int from public.social_post_comments('6bb00000-0000-0000-0000-000000000002')
           where parent_id is not null), 3,
  'a thread carries its first three replies');
select is((select reply_count from public.social_post_comments('6bb00000-0000-0000-0000-000000000002')
           where id = '6bc00000-0000-0000-0000-000000000001'), 5,
  'and says how many there are');
select is((select count(*)::int from public.social_comment_replies('6bc00000-0000-0000-0000-000000000001',
             (select max(created_at) from public.social_post_comments('6bb00000-0000-0000-0000-000000000002')
              where parent_id is not null))), 2,
  'the rest come from social_comment_replies() after the cursor');

select pg_temp.authenticate_as('6b000000-0000-0000-0000-000000000005');
select is((select count(*)::int from public.social_comment_replies('6bc00000-0000-0000-0000-000000000001')), 0,
  'replies on a post you cannot see come back empty');

-- ---------- 9. people ----------
select is((select count(*)::int from public.social_search_users('v2c')), 4,
  'search finds everyone but yourself and the person pending deletion');
select is((select count(*)::int from public.social_search_users('v2c', null, 2, 0)), 2,
  'search pages: the limit holds');
select is((select count(*)::int from public.social_search_users('v2c', null, 2, 3)), 1,
  'search pages: the offset reaches the last row');
select is((select count(*)::int from public.social_search_users('ghostv2c')), 0,
  'someone who asked to be deleted is not findable');

-- STRANGER follows nobody: suggestions fall back to the most-followed.
select ok((select bool_and(id <> '6b000000-0000-0000-0000-000000000005')
           from public.social_suggested_people(10)), 'you are never suggested to yourself');
select is((select count(*)::int from public.social_suggested_people(10)
           where id in ('6b000000-0000-0000-0000-00000000000a', '6b000000-0000-0000-0000-000000000077')), 2,
  'with no follows, the most-followed people are suggested');

select * from finish();
rollback;
