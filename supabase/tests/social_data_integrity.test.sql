-- pgTAP · Social data integrity (20261012100000_social_data_integrity.sql)
--
-- The client names things; the database says what they are. Every data post
-- below is sent with invented numbers, and the question is what is stored.
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
create or replace function pg_temp.payload(p_post uuid)
returns jsonb language sql stable security definer as $fn$
  select payload from public.social_posts where id = p_post;
$fn$;
create or replace function pg_temp.mentioned(p_post uuid)
returns text language sql stable security definer as $fn$
  select coalesce(array_agg(u.username order by u.username)::text, '{}')
  from public.social_post_mentions m join public.users u on u.id = m.user_id where m.post_id = p_post;
$fn$;
create or replace function pg_temp.comment_mentioned(p_comment uuid)
returns text language sql stable security definer as $fn$
  select coalesce(array_agg(u.username order by u.username)::text, '{}')
  from public.social_comment_mentions m join public.users u on u.id = m.user_id where m.comment_id = p_comment;
$fn$;
create or replace function pg_temp.mention_notes(p_user uuid)
returns int language sql stable security definer as $fn$
  select count(*)::int from public.notifications where user_id = p_user and category::text = 'new_mention';
$fn$;

-- ---------- people ----------
-- A shares. F follows A. S is a stranger. B has their own session. X will be
-- suspended. K coaches A.
insert into auth.users (id, email, raw_user_meta_data) values
  ('b1000000-0000-0000-0000-00000000000a', 'a@di.test', '{"full_name":"Ana","username":"anadi"}'),
  ('b1000000-0000-0000-0000-00000000000f', 'f@di.test', '{"full_name":"Fan","username":"fandi"}'),
  ('b1000000-0000-0000-0000-000000000005', 's@di.test', '{"full_name":"Stranger","username":"strangerdi"}'),
  ('b1000000-0000-0000-0000-00000000000b', 'b@di.test', '{"full_name":"Bogdan","username":"bogdandi"}'),
  ('b1000000-0000-0000-0000-000000000009', 'x@di.test', '{"full_name":"Xena","username":"xenadi"}'),
  ('b1000000-0000-0000-0000-0000000000cc', 'k@di.test', '{"full_name":"Coach","username":"coachdi","role":"coach"}');
insert into public.social_follows (follower_id, following_id) values
  ('b1000000-0000-0000-0000-00000000000f', 'b1000000-0000-0000-0000-00000000000a');
insert into public.trainer_clients (coach_id, client_id, status, started_at) values
  ('b1000000-0000-0000-0000-0000000000cc', 'b1000000-0000-0000-0000-00000000000a', 'active', now());
insert into public.exercises (id, source, external_id, name_en, name_ro, primary_muscles) values
  ('b5000000-0000-0000-0000-0000000000d1', 'custom', 'di-squat', 'Squat', 'Genuflexiuni', '{quadriceps}');

-- A's sessions: S1 (three sets of 100 kg × 5, the first a PR), S2 and S3 plain, S4 unfinished. B's session SB.
insert into public.logged_sessions (id, user_id, client_generated_id, started_at, completed_at) values
  ('b2000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-00000000000a', gen_random_uuid(), now() - interval '3 hours', now() - interval '2 hours'),
  ('b2000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-00000000000a', gen_random_uuid(), now() - interval '5 hours', now() - interval '4 hours'),
  ('b2000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-00000000000a', gen_random_uuid(), now() - interval '7 hours', now() - interval '6 hours'),
  ('b2000000-0000-0000-0000-000000000004', 'b1000000-0000-0000-0000-00000000000a', gen_random_uuid(), now() - interval '1 hour', null),
  ('b2000000-0000-0000-0000-0000000000bb', 'b1000000-0000-0000-0000-00000000000b', gen_random_uuid(), now() - interval '3 hours', now() - interval '2 hours');
insert into public.logged_sets (id, session_id, user_id, exercise_id, set_index, weight_kg, reps, rpe, is_pr, client_generated_id) values
  ('b3000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-00000000000a', 'b5000000-0000-0000-0000-0000000000d1', 1, 100, 5, 8, true,  gen_random_uuid()),
  ('b3000000-0000-0000-0000-000000000002', 'b2000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-00000000000a', 'b5000000-0000-0000-0000-0000000000d1', 2, 100, 5, 8, false, gen_random_uuid()),
  ('b3000000-0000-0000-0000-000000000003', 'b2000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-00000000000a', 'b5000000-0000-0000-0000-0000000000d1', 3, 100, 5, 9, false, gen_random_uuid()),
  ('b3000000-0000-0000-0000-0000000000bb', 'b2000000-0000-0000-0000-0000000000bb', 'b1000000-0000-0000-0000-00000000000b', 'b5000000-0000-0000-0000-0000000000d1', 1, 200, 3, 9, true,  gen_random_uuid());
-- A seven-day run of A's workout days, 20 to 14 days ago (local, Bucharest).
insert into public.logged_sessions (user_id, client_generated_id, started_at, completed_at)
select 'b1000000-0000-0000-0000-00000000000a', gen_random_uuid(),
       (((now() at time zone 'Europe/Bucharest')::date - d) || ' 12:00')::timestamp at time zone 'Europe/Bucharest',
       (((now() at time zone 'Europe/Bucharest')::date - d) || ' 13:00')::timestamp at time zone 'Europe/Bucharest'
from generate_series(14, 20) d;
-- Two challenges: one A completed, one A only joined.
insert into public.challenges (id, title_en, title_ro, type, target_value, start_date, end_date, visibility, exercise_id, creator_id) values
  ('b4000000-0000-0000-0000-000000000001', 'One workout', 'Un antrenament', 'workouts', 1, current_date - 30, current_date + 10, 'public', null, null),
  ('b4000000-0000-0000-0000-000000000002', 'Many workouts', 'Multe antrenamente', 'workouts', 500, current_date - 30, current_date + 10, 'public', null, null);
insert into public.challenge_participants (challenge_id, user_id, completed_at) values
  ('b4000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-00000000000a', now()),
  ('b4000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-00000000000a', null);

-- ================= PAYLOADS =================
select pg_temp.authenticate_as('b1000000-0000-0000-0000-00000000000a');

-- workout
select lives_ok($$
  insert into public.social_posts (id, user_id, type, payload, visibility, activity_id)
  values ('b6000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-00000000000a', 'workout',
          '{"kind":"workout","name":"Fake","date":"2020-01-01","duration_min":999,"exercises":99,"sets":999,"volume_kg":99999,"load":100,"prs":42}',
          'public', 'b2000000-0000-0000-0000-000000000001') $$, 'a workout post with invented numbers is accepted…');
select is(
  (select row(p ->> 'name', p ->> 'sets', p ->> 'exercises', p ->> 'volume_kg', p ->> 'prs', p ->> 'duration_min')::text
   from pg_temp.payload('b6000000-0000-0000-0000-000000000001') p),
  '(Workout,3,1,1500,1,60)', '…but stores the session''s real numbers: 3 sets, 1 exercise, 1500 kg, 1 PR, 60 min');
select is((pg_temp.payload('b6000000-0000-0000-0000-000000000001') ->> 'load')::int between 0 and 100, true,
  'the load is the server''s score, 0..100');
select is(
  (select count(*)::int from jsonb_object_keys(pg_temp.payload('b6000000-0000-0000-0000-000000000001'))),
  13, 'the shape is the existing workout snapshot (with the photo''s size and overlay, 20261014100000), nothing added');
select throws_ok($$
  insert into public.social_posts (user_id, type, payload, visibility)
  values ('b1000000-0000-0000-0000-00000000000a', 'workout', '{"kind":"workout","sets":1}', 'public') $$,
  'P0002', null, 'a workout post without a session is refused');
select throws_ok($$
  insert into public.social_posts (user_id, type, payload, visibility, activity_id)
  values ('b1000000-0000-0000-0000-00000000000a', 'workout', '{"kind":"workout"}', 'public', 'b2000000-0000-0000-0000-0000000000bb') $$,
  'P0002', null, '…and with someone else''s session');
select throws_ok($$
  insert into public.social_posts (user_id, type, payload, visibility, activity_id)
  values ('b1000000-0000-0000-0000-00000000000a', 'workout', '{"kind":"workout"}', 'public', 'b2000000-0000-0000-0000-000000000004') $$,
  'P0002', null, '…and with an unfinished session');
insert into public.social_posts (id, user_id, type, payload, visibility, activity_id) values
  ('b6000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-00000000000a', 'workout',
   '{"kind":"workout","photo_url":"https://evil.example/tracker.gif"}', 'public', 'b2000000-0000-0000-0000-000000000002'),
  ('b6000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-00000000000a', 'workout',
   '{"kind":"workout","photo_url":"https://res.cloudinary.com/voinic/image/upload/c_limit,w_1080/v1/voinic/posts/b1000000-0000-0000-0000-00000000000a/p1"}',
   'public', 'b2000000-0000-0000-0000-000000000003');
select is(pg_temp.payload('b6000000-0000-0000-0000-000000000002') ->> 'photo_url', null, 'a photo URL from anywhere else is dropped');
select is(pg_temp.payload('b6000000-0000-0000-0000-000000000003') ->> 'photo_url',
  'https://res.cloudinary.com/voinic/image/upload/c_limit,w_1080/v1/voinic/posts/b1000000-0000-0000-0000-00000000000a/p1',
  'a Cloudinary upload in the author''s own folder is kept');

-- PR
select lives_ok($$
  insert into public.social_posts (id, user_id, type, payload, visibility, activity_id)
  values ('b6000000-0000-0000-0000-000000000011', 'b1000000-0000-0000-0000-00000000000a', 'pr',
          '{"kind":"pr","exercise":"Deadlift","weight_kg":500,"reps":20,"estimated_1rm":999,"date":"2020-01-01","set_id":"b3000000-0000-0000-0000-000000000001"}',
          'public', 'b2000000-0000-0000-0000-000000000001') $$, 'a PR post naming a flagged set is accepted…');
select is(
  (select row(p ->> 'exercise', p ->> 'weight_kg', p ->> 'reps', p ->> 'estimated_1rm', p ? 'set_id')::text
   from pg_temp.payload('b6000000-0000-0000-0000-000000000011') p),
  '(Genuflexiuni,100,5,116.7,f)', '…but stores the set''s real lift, its 1RM, and not the set id');
select throws_ok($$
  insert into public.social_posts (user_id, type, payload, visibility, activity_id)
  values ('b1000000-0000-0000-0000-00000000000a', 'pr', '{"kind":"pr","set_id":"b3000000-0000-0000-0000-000000000002"}', 'public',
          'b2000000-0000-0000-0000-000000000001') $$,
  'P0002', null, 'a set the PR engine did not flag is no PR');
select throws_ok($$
  insert into public.social_posts (user_id, type, payload, visibility, activity_id)
  values ('b1000000-0000-0000-0000-00000000000a', 'pr', '{"kind":"pr","set_id":"b3000000-0000-0000-0000-0000000000bb"}', 'public',
          'b2000000-0000-0000-0000-0000000000bb') $$,
  'P0002', null, 'someone else''s PR cannot be shared as yours');
select throws_ok($$
  insert into public.social_posts (user_id, type, payload, visibility, activity_id)
  values ('b1000000-0000-0000-0000-00000000000a', 'pr', '{"kind":"pr","weight_kg":300}', 'public', 'b2000000-0000-0000-0000-000000000001') $$,
  'P0002', null, 'a PR without a set is refused');
select throws_ok($$
  insert into public.social_posts (user_id, type, payload, visibility, activity_id)
  values ('b1000000-0000-0000-0000-00000000000a', 'pr', '{"kind":"pr","set_id":"b3000000-0000-0000-0000-000000000001"}', 'public',
          'b2000000-0000-0000-0000-000000000002') $$,
  'P0002', null, 'a set from another session than the one named is refused');

-- challenge
select lives_ok($$
  insert into public.social_posts (id, user_id, type, payload, visibility, challenge_id)
  values ('b6000000-0000-0000-0000-000000000021', 'b1000000-0000-0000-0000-00000000000a', 'challenge_completed',
          '{"kind":"challenge_completed","title_en":"I won everything","title_ro":"x","type":"volume","target":1,"value":999999}',
          'public', 'b4000000-0000-0000-0000-000000000001') $$, 'a completed challenge is shared…');
select is(
  (select row(p ->> 'title_en', p ->> 'title_ro', p ->> 'type', p ->> 'target')::text from pg_temp.payload('b6000000-0000-0000-0000-000000000021') p),
  '("One workout","Un antrenament",workouts,1)', '…with the challenge''s own titles, type and target');
reset role;
select set_config('request.jwt.claims', '', true);
select is((pg_temp.payload('b6000000-0000-0000-0000-000000000021') ->> 'value')::numeric,
  public.challenge_value('b4000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-00000000000a'),
  '…and the real progress, not the claimed 999999');
select pg_temp.authenticate_as('b1000000-0000-0000-0000-00000000000a');
select throws_ok($$
  insert into public.social_posts (user_id, type, payload, visibility, challenge_id)
  values ('b1000000-0000-0000-0000-00000000000a', 'challenge_completed', '{"kind":"challenge_completed"}', 'public',
          'b4000000-0000-0000-0000-000000000002') $$,
  'P0002', null, 'a challenge you only joined cannot be shared as completed');
select throws_ok($$
  insert into public.social_posts (user_id, type, payload, visibility, challenge_id)
  values ('b1000000-0000-0000-0000-00000000000a', 'challenge_completed', '{"kind":"challenge_completed"}', 'public',
          'b4000000-0000-0000-0000-0000000000ff') $$,
  'P0002', null, '…nor one that does not exist');

-- streak
select lives_ok(format($f$
  insert into public.social_posts (id, user_id, type, payload, visibility)
  values ('b6000000-0000-0000-0000-000000000031', 'b1000000-0000-0000-0000-00000000000a', 'streak',
          '{"kind":"streak","milestone":7,"streak_days":365,"streak_start":"%s","title":"365 Day Streak"}', 'public') $f$,
  to_char((now() at time zone 'Europe/Bucharest')::date - 20, 'YYYY-MM-DD')), 'a streak that happened is shared…');
select is(
  (select row(p ->> 'streak_days', p ->> 'milestone', p ->> 'title', p ->> 'achieved_at' = to_char((now() at time zone 'Europe/Bucharest')::date - 14, 'YYYY-MM-DD'))::text
   from pg_temp.payload('b6000000-0000-0000-0000-000000000031') p),
  '(7,7,"7 Day Streak",t)', '…with the milestone reached, not the claimed 365 days');
select throws_ok(format($f$
  insert into public.social_posts (user_id, type, payload, visibility)
  values ('b1000000-0000-0000-0000-00000000000a', 'streak', '{"kind":"streak","milestone":14,"streak_start":"%s"}', 'public') $f$,
  to_char((now() at time zone 'Europe/Bucharest')::date - 20, 'YYYY-MM-DD')), 'P0002', null, 'a milestone the run never reached is refused');
select throws_ok(format($f$
  insert into public.social_posts (user_id, type, payload, visibility)
  values ('b1000000-0000-0000-0000-00000000000a', 'streak', '{"kind":"streak","milestone":7,"streak_start":"%s"}', 'public') $f$,
  to_char((now() at time zone 'Europe/Bucharest')::date - 19, 'YYYY-MM-DD')), 'P0002', null, 'a start date in the middle of a run is not a streak start');
select throws_ok(format($f$
  insert into public.social_posts (user_id, type, payload, visibility)
  values ('b1000000-0000-0000-0000-00000000000a', 'streak', '{"kind":"streak","milestone":5,"streak_start":"%s"}', 'public') $f$,
  to_char((now() at time zone 'Europe/Bucharest')::date - 20, 'YYYY-MM-DD')), 'P0002', null, 'only the shareable milestones');

-- kind, afterwards, and who
select throws_ok($$
  insert into public.social_posts (user_id, type, payload, visibility, activity_id)
  values ('b1000000-0000-0000-0000-00000000000a', 'workout', '{"kind":"pr","set_id":"b3000000-0000-0000-0000-000000000001"}', 'public',
          'b2000000-0000-0000-0000-000000000001') $$,
  '22023', null, 'a PR payload cannot be posted as a workout');
select throws_ok($$ update public.social_posts set payload = '{"kind":"workout","volume_kg":99999}' where id = 'b6000000-0000-0000-0000-000000000001' $$,
  '42501', null, 'the stored numbers cannot be changed afterwards');
select throws_ok($$
  insert into public.social_posts (user_id, type, payload, visibility, activity_id)
  values ('b1000000-0000-0000-0000-00000000000b', 'workout', '{"kind":"workout"}', 'public', 'b2000000-0000-0000-0000-0000000000bb') $$,
  '42501', null, 'nobody posts as someone else');

-- the right people see the rebuilt post
select pg_temp.authenticate_as('b1000000-0000-0000-0000-00000000000f');
select is((select (payload ->> 'volume_kg')::int from public.social_post('b6000000-0000-0000-0000-000000000001')), 1500,
  'a reader sees the real numbers');

-- ================= MENTIONS =================
select pg_temp.authenticate_as('b1000000-0000-0000-0000-00000000000a');
insert into public.social_posts (id, user_id, type, text, visibility) values
  ('b6000000-0000-0000-0000-000000000041', 'b1000000-0000-0000-0000-00000000000a', 'text', 'well done @fandi and @Strangerdi, cc @nobodydi', 'public'),
  ('b6000000-0000-0000-0000-000000000042', 'b1000000-0000-0000-0000-00000000000a', 'text', 'followers only, @strangerdi', 'followers');
insert into public.social_post_mentions (post_id, user_id) values
  ('b6000000-0000-0000-0000-000000000041', 'b1000000-0000-0000-0000-00000000000f'),
  ('b6000000-0000-0000-0000-000000000041', 'b1000000-0000-0000-0000-000000000005'),
  ('b6000000-0000-0000-0000-000000000041', 'b1000000-0000-0000-0000-00000000000b'),
  ('b6000000-0000-0000-0000-000000000042', 'b1000000-0000-0000-0000-000000000005');
select is(pg_temp.mentioned('b6000000-0000-0000-0000-000000000041'), '{fandi,strangerdi}',
  'two handles in the text, two mentions (case-insensitive); the id not in the text is dropped');
select is(pg_temp.mention_notes('b1000000-0000-0000-0000-00000000000b'), 0, 'the fabricated mention notified nobody');
select is(pg_temp.mention_notes('b1000000-0000-0000-0000-00000000000f'), 1, 'a real mention notifies');
select is(pg_temp.mentioned('b6000000-0000-0000-0000-000000000042'), '{}',
  'a mention of someone who cannot see the post is not kept — a mention does not create access');
select throws_ok($$ insert into public.social_post_mentions (post_id, user_id)
  values ('b6000000-0000-0000-0000-000000000041', 'b1000000-0000-0000-0000-00000000000f') $$,
  '23505', null, 'the same person mentioned twice is still one mention');

-- blocked and suspended people named in a text
reset role;
select set_config('request.jwt.claims', '', true);
update public.users set suspended_at = now() where id = 'b1000000-0000-0000-0000-000000000009';
select pg_temp.authenticate_as('b1000000-0000-0000-0000-00000000000a');
select public.social_block_user('b1000000-0000-0000-0000-00000000000b');
insert into public.social_posts (id, user_id, type, text, visibility) values
  ('b6000000-0000-0000-0000-000000000043', 'b1000000-0000-0000-0000-00000000000a', 'text', '@bogdandi @xenadi @fandi', 'public');
insert into public.social_post_mentions (post_id, user_id) values
  ('b6000000-0000-0000-0000-000000000043', 'b1000000-0000-0000-0000-00000000000b'),
  ('b6000000-0000-0000-0000-000000000043', 'b1000000-0000-0000-0000-000000000009'),
  ('b6000000-0000-0000-0000-000000000043', 'b1000000-0000-0000-0000-00000000000f');
select is(pg_temp.mentioned('b6000000-0000-0000-0000-000000000043'), '{fandi}',
  'a blocked or suspended person named in the text is not mentioned');

-- a comment
select pg_temp.authenticate_as('b1000000-0000-0000-0000-00000000000f');
insert into public.social_comments (id, post_id, user_id, body) values
  ('b7000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000041', 'b1000000-0000-0000-0000-00000000000f', 'thanks @anadi!');
insert into public.social_comment_mentions (comment_id, user_id) values
  ('b7000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-00000000000a'),
  ('b7000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000005');
select is(pg_temp.comment_mentioned('b7000000-0000-0000-0000-000000000001'), '{anadi}',
  'in a comment too: only the handle in the text');
select is(pg_temp.mention_notes('b1000000-0000-0000-0000-000000000005'), 1,
  'the stranger heard only about the real mention in the post, not the invented one in the comment');
select pg_temp.authenticate_as('b1000000-0000-0000-0000-000000000005');
select throws_ok($$ insert into public.social_comment_mentions (comment_id, user_id)
  values ('b7000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000005') $$,
  '42501', null, 'nobody adds a mention to someone else''s comment');
select throws_ok($$ select public.social_mention_handles('@anadi') $$, '42501', null, 'the parser is not a user API');

-- ================= SUSPENDED AUTHORS =================
reset role;
select set_config('request.jwt.claims', '', true);
insert into public.social_posts (id, user_id, type, text, visibility) values
  ('b6000000-0000-0000-0000-000000000051', 'b1000000-0000-0000-0000-000000000009', 'text', 'xena post', 'public');
insert into public.social_comments (id, post_id, user_id, body) values
  ('b7000000-0000-0000-0000-000000000009', 'b6000000-0000-0000-0000-000000000041', 'b1000000-0000-0000-0000-000000000009', 'xena comment');
insert into public.social_comments (id, post_id, user_id, body, parent_id) values
  ('b7000000-0000-0000-0000-00000000000a', 'b6000000-0000-0000-0000-000000000041', 'b1000000-0000-0000-0000-000000000009', 'xena reply',
   'b7000000-0000-0000-0000-000000000001');

select pg_temp.authenticate_as('b1000000-0000-0000-0000-00000000000f');
select is((select count(*)::int from public.social_post_comments('b6000000-0000-0000-0000-000000000041')
           where user_id = 'b1000000-0000-0000-0000-000000000009'), 0, 'a suspended author''s comment leaves the thread');
select is((select count(*)::int from public.social_comment_replies('b7000000-0000-0000-0000-000000000001')
           where user_id = 'b1000000-0000-0000-0000-000000000009'), 0, '…and their reply');
select is((select comment_count from public.social_feed(50, null, null, 'all') where id = 'b6000000-0000-0000-0000-000000000041'), 1,
  'the comment count follows the thread: 1, not the 3 stored (20261013100000)');
select is((select count(*)::int from public.social_post('b6000000-0000-0000-0000-000000000051')), 0, 'a suspended author''s post is unreadable by id');
select is((select count(*)::int from public.social_posts where id = 'b6000000-0000-0000-0000-000000000051'), 0, '…and from the table');
select pg_temp.authenticate_as('b1000000-0000-0000-0000-000000000009');
select is((select count(*)::int from public.social_posts where id = 'b6000000-0000-0000-0000-000000000051'), 1, 'the author still sees their own post');

-- ================= PROGRAMS AND BLOCKS =================
reset role;
select set_config('request.jwt.claims', '', true);
insert into public.programs (id, coach_id, client_id, name, status, visibility) values
  ('b8000000-0000-0000-0000-00000000000b', null, 'b1000000-0000-0000-0000-00000000000b', 'Bogdan PPL', 'published', 'public'),
  ('b8000000-0000-0000-0000-0000000000cc', 'b1000000-0000-0000-0000-0000000000cc', 'b1000000-0000-0000-0000-00000000000a', 'Coach plan for Ana', 'published', 'private');
insert into public.program_days (program_id, week_index, day_index, name) values
  ('b8000000-0000-0000-0000-00000000000b', 1, 0, 'Push'),
  ('b8000000-0000-0000-0000-0000000000cc', 1, 0, 'Day 1');

-- A blocked B earlier.
select pg_temp.authenticate_as('b1000000-0000-0000-0000-00000000000a');
select is((select count(*)::int from public.discover_programs(p_limit => 50) where id = 'b8000000-0000-0000-0000-00000000000b'), 0,
  'a blocked person''s program leaves Discover');
select is((select count(*)::int from public.program_card_rows(array['b8000000-0000-0000-0000-00000000000b'::uuid])), 0,
  '…and its card, asked for by id');
select public.social_block_user('b1000000-0000-0000-0000-0000000000cc');
select is((select count(*)::int from public.program_card_rows(array['b8000000-0000-0000-0000-0000000000cc'::uuid])), 1,
  'a program your coach assigned you stays, even across a block — a block never takes coaching away');
select pg_temp.authenticate_as('b1000000-0000-0000-0000-00000000000b');
select is((select count(*)::int from public.program_card_rows(array['b8000000-0000-0000-0000-00000000000b'::uuid])), 1,
  'your own program is always yours');
select pg_temp.authenticate_as('b1000000-0000-0000-0000-00000000000f');
select is((select count(*)::int from public.discover_programs(p_limit => 50) where id = 'b8000000-0000-0000-0000-00000000000b'), 1,
  'someone uninvolved still finds it');
select pg_temp.authenticate_as('b1000000-0000-0000-0000-00000000000a');
select public.social_unblock_user('b1000000-0000-0000-0000-00000000000b');
select is((select count(*)::int from public.discover_programs(p_limit => 50) where id = 'b8000000-0000-0000-0000-00000000000b'), 1,
  'unblocked: it is back');

-- ================= parser parity with extractMentionHandles() =================
-- The same strings as apps/web/lib/mention-parity.test.ts; the two must agree.
reset role;
select is(public.social_mention_handles('well done @fandi and @Strangerdi, cc @nobodydi'),
  array['fandi', 'strangerdi', 'nobodydi'], 'parity: handles in order, lower-cased');
select is(public.social_mention_handles('write me@host.com or @ab'), '{}'::text[],
  'parity: an address is not a mention, and two characters are not a handle');
select is(public.social_mention_handles('@a1b2 @A1B2 @c3d4'), array['a1b2', 'c3d4'], 'parity: one person once');
select is(cardinality(public.social_mention_handles(
  '@u001 @u002 @u003 @u004 @u005 @u006 @u007 @u008 @u009 @u010 @u011')), 10, 'parity: ten at most');

-- ================= challenge creators, anon =================
select is(
  (select pg_get_function_result(p.oid) ~* 'creator' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'challenge_cards'),
  false, 'no social surface names a challenge''s creator');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('social_mention_handles', 'social_post_mention_check', 'social_comment_mention_check')
     and (has_function_privilege('authenticated', p.oid, 'EXECUTE') or has_function_privilege('anon', p.oid, 'EXECUTE'))),
  0, 'the new helpers are internal');
set local role anon;
select throws_ok($$ select * from public.discover_programs() $$, '42501', null, 'anon cannot browse Discover through the API');
select throws_ok($$ insert into public.social_posts (user_id, type, text) values ('b1000000-0000-0000-0000-00000000000a', 'text', 'x') $$,
  '42501', null, 'anon cannot post');
reset role;

select * from finish();
rollback;
