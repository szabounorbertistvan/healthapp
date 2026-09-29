-- pgTAP · Workout posts on the media pipeline (20261017100000_workout_media.sql)
--
-- A workout post is created by social_create_post with its session and its
-- pictures in one call; the payload is rebuilt from the session, never taken
-- from the caller; one post per session; nobody shares someone else's
-- session; the pictures follow every media rule. A = owner, B = someone else.
--
-- Run with a local stack up:  npm run db:test
-- Or without Docker:          npm run db:test:offline

begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

create or replace function pg_temp.authenticate_as(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$fn$;
create or replace function pg_temp.items(p_user uuid, p_n int)
returns jsonb language sql stable security definer as $fn$
  select coalesce(jsonb_agg(jsonb_build_object(
           'public_id', x.public_id, 'width', 1080, 'height', 1350,
           'overlay', jsonb_build_object('stats', jsonb_build_object('x', 0.3, 'y', 0.8, 'keys', jsonb_build_array('sets'), 'scale', 1, 'style', 'hero')))
         order by x.public_id), '[]')
  from (select public_id from public.social_media_uploads
        where user_id = p_user and attached_at is null and discarded_at is null
        order by created_at, public_id limit p_n) x;
$fn$;
create or replace function pg_temp.post_row(p_post uuid)
returns public.social_posts language sql stable security definer as $fn$
  select * from public.social_posts where id = p_post;
$fn$;
create or replace function pg_temp.first_upload(p_user uuid)
returns text language sql stable security definer as $fn$
  select public_id from public.social_media_uploads
  where user_id = p_user and attached_at is null and discarded_at is null
  order by created_at, public_id limit 1;
$fn$;
create or replace function pg_temp.media_rows(p_post uuid)
returns int language sql stable security definer as $fn$
  select count(*)::int from public.social_post_media where post_id = p_post;
$fn$;

-- ---------- people and sessions ----------
insert into auth.users (id, email, raw_user_meta_data) values
  ('e7000000-0000-0000-0000-00000000000a', 'a@wm.test', '{"full_name":"Ana","username":"awm"}'),
  ('e7000000-0000-0000-0000-00000000000b', 'b@wm.test', '{"full_name":"Bia","username":"bwm"}');
insert into public.exercises (id, source, external_id, name_en, name_ro, primary_muscles) values
  ('e7500000-0000-0000-0000-0000000000d1', 'custom', 'wm-bench', 'Bench', 'Împins', '{chest}');
insert into public.logged_sessions (id, user_id, client_generated_id, started_at, completed_at) values
  ('e7200000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-00000000000a', gen_random_uuid(), now() - interval '2 hours', now() - interval '1 hour'),
  ('e7200000-0000-0000-0000-000000000002', 'e7000000-0000-0000-0000-00000000000a', gen_random_uuid(), now() - interval '4 hours', now() - interval '3 hours'),
  ('e7200000-0000-0000-0000-0000000000bb', 'e7000000-0000-0000-0000-00000000000b', gen_random_uuid(), now() - interval '2 hours', now() - interval '1 hour');
insert into public.logged_sets (session_id, user_id, exercise_id, set_index, weight_kg, reps, rpe, is_pr, client_generated_id) values
  ('e7200000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-00000000000a', 'e7500000-0000-0000-0000-0000000000d1', 1, 80, 8, 8, false, gen_random_uuid()),
  ('e7200000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-00000000000a', 'e7500000-0000-0000-0000-0000000000d1', 2, 80, 8, 8, false, gen_random_uuid());

create temporary table ids (k text primary key, id uuid) on commit drop;
grant all on ids to authenticated;

-- ================= a workout post with its pictures =================
select pg_temp.authenticate_as('e7000000-0000-0000-0000-00000000000a');
select is((select count(*)::int from public.social_media_upload_register(3)), 3, 'A is issued three uploads');

select lives_ok($$
  insert into ids select 'w1', public.social_create_post('workout', 'leg day', 'public',
    '{"kind":"workout","name":"Made up","sets":999,"volume_kg":1e9}'::jsonb,
    pg_temp.items('e7000000-0000-0000-0000-00000000000a', 2),
    'e7200000-0000-0000-0000-000000000001')
$$, 'a workout post is created with its session and two pictures');
select is(pg_temp.media_rows((select id from ids where k = 'w1')), 2, '…and both pictures are attached');
select is((pg_temp.post_row((select id from ids where k = 'w1'))).activity_id, 'e7200000-0000-0000-0000-000000000001'::uuid,
  '…to a post that names the session');
select is(((pg_temp.post_row((select id from ids where k = 'w1'))).payload ->> 'sets')::int, 2,
  'the payload is rebuilt from the session, not taken from the caller');
select is(((pg_temp.post_row((select id from ids where k = 'w1'))).payload ->> 'volume_kg')::numeric, 1280::numeric,
  '…volume included');
select is((pg_temp.post_row((select id from ids where k = 'w1'))).payload ->> 'photo_url', null,
  'no payload photo on the new path: the pictures are rows');
select is((select overlay -> 'stats' ->> 'style' from public.social_post_media where post_id = (select id from ids where k = 'w1') and position = 0),
  'hero', 'the overlay (with the workout''s figures) is stored with the first picture');

-- ================= the rules =================
select throws_ok($$
  select public.social_create_post('workout', null, 'public', null, '[]'::jsonb, 'e7200000-0000-0000-0000-000000000001')
$$, '23505', null, 'one workout post per session');
select throws_ok($$
  select public.social_create_post('workout', null, 'public', null, '[]'::jsonb, 'e7200000-0000-0000-0000-0000000000bb')
$$, 'P0002', null, 'nobody shares someone else''s session');
select throws_ok($$
  select public.social_create_post('workout', null, 'public', null, '[]'::jsonb, null)
$$, '22023', null, 'a workout post must name its session');
select throws_ok($$
  select public.social_create_post('text', 'hi', 'public', null, '[]'::jsonb, 'e7200000-0000-0000-0000-000000000002')
$$, '22023', null, '…and only a workout post may');
select lives_ok($$
  select public.social_create_post('workout', null, 'followers', null, '[]'::jsonb, 'e7200000-0000-0000-0000-000000000002')
$$, 'a workout post without pictures still works');

select pg_temp.authenticate_as('e7000000-0000-0000-0000-00000000000b');
select throws_ok(format($$
  select public.social_create_post('workout', null, 'public', null,
    jsonb_build_array(jsonb_build_object('public_id', %L, 'width', 1, 'height', 1)), 'e7200000-0000-0000-0000-0000000000bb')
$$, pg_temp.first_upload('e7000000-0000-0000-0000-00000000000a')),
  'P0002', null, 'B cannot attach an upload issued to A to B''s own workout');

select * from finish();
rollback;
