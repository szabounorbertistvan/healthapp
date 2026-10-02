-- pgTAP · the public coach page (20261021100000)
--
-- What an anonymous visitor can reach through coach_public_profile /
-- coach_public_posts / coach_public_programs, and what the signed-in page
-- learns from coach_viewer_state. Only a published coach is reachable, only
-- `public` posts and routines come out, privacy settings gate the stats, and
-- nothing private (e-mail, document_ref, private prices, other visibilities)
-- leaves the database.
--
-- Run with a local stack up:  npm run db:test
-- or without Docker:          node scripts/pgtest/run.mjs coach_public_profile

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
create or replace function pg_temp.anonymous()
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
end;
$fn$;

-- 01 the published coach (full_name is an e-mail) · 02 a client · 03 a stranger
-- 04 draft coach · 05 pending coach · 06 suspended coach
insert into auth.users (id, email, raw_user_meta_data) values
  ('cf000000-0000-0000-0000-000000000001', 'ana@coachpub.local',    '{"full_name":"ana@coachpub.local","username":"ana_coach"}'),
  ('cf000000-0000-0000-0000-000000000002', 'cora@coachpub.local',   '{"full_name":"Cora","username":"cora_pub"}'),
  ('cf000000-0000-0000-0000-000000000003', 'stan@coachpub.local',   '{"full_name":"Stan","username":"stan_pub"}'),
  ('cf000000-0000-0000-0000-000000000004', 'dora@coachpub.local',   '{"full_name":"Dora","username":"dora_draft"}'),
  ('cf000000-0000-0000-0000-000000000005', 'pia@coachpub.local',    '{"full_name":"Pia","username":"pia_pending"}'),
  ('cf000000-0000-0000-0000-000000000006', 'sid@coachpub.local',    '{"full_name":"Sid","username":"sid_suspended"}');

select pg_temp.authenticate_as('cf000000-0000-0000-0000-000000000001'); select public.become_coach(); reset role;
select pg_temp.authenticate_as('cf000000-0000-0000-0000-000000000004'); select public.become_coach(); reset role;
select pg_temp.authenticate_as('cf000000-0000-0000-0000-000000000005'); select public.become_coach(); reset role;
select pg_temp.authenticate_as('cf000000-0000-0000-0000-000000000006'); select public.become_coach(); reset role;

update public.coach_profiles set status = 'published', published_at = now(), headline = 'Strength coach'
 where slug = 'ana-coach';
update public.coach_profiles set status = 'pending_review' where slug = 'pia-pending';
update public.coach_profiles set status = 'suspended', suspended_at = now(), suspension_reason = 'x'
 where slug = 'sid-suspended';

insert into public.coach_services (id, coach_profile_id, name, kind, price_cents, price_unit, price_public)
select 'cf500000-0000-0000-0000-000000000001', id, 'Online coaching', 'online_coaching', 20000, 'month', true
  from public.coach_profiles where slug = 'ana-coach';
insert into public.coach_services (coach_profile_id, name, kind, price_cents, price_unit, price_public)
select id, 'VIP', 'personal_training', 777777, 'session', false from public.coach_profiles where slug = 'ana-coach';
insert into public.coach_certifications (coach_profile_id, name, issuer, year, document_ref)
select id, 'ISSA CPT', 'ISSA', 2016, 'vault://secret-cert-doc' from public.coach_profiles where slug = 'ana-coach';

-- posts of every visibility, one public one deleted; and the same for the draft coach
insert into public.social_posts (user_id, type, text, visibility, deleted_at) values
  ('cf000000-0000-0000-0000-000000000001', 'text', 'Public hello',     'public',    null),
  ('cf000000-0000-0000-0000-000000000001', 'text', 'Followers only',   'followers', null),
  ('cf000000-0000-0000-0000-000000000001', 'text', 'Private thought',  'private',   null),
  ('cf000000-0000-0000-0000-000000000001', 'text', 'Deleted public',   'public',    now()),
  ('cf000000-0000-0000-0000-000000000004', 'text', 'Draft coach post', 'public',    null);

-- routines: one public with a day; private, followers-only, empty and archived ones that must not show
insert into public.programs (id, coach_id, client_id, name, status, visibility) values
  ('cf400000-0000-0000-0000-000000000001', null, 'cf000000-0000-0000-0000-000000000001', 'Public PPL',   'published', 'public'),
  ('cf400000-0000-0000-0000-000000000002', null, 'cf000000-0000-0000-0000-000000000001', 'Secret block', 'published', 'private'),
  ('cf400000-0000-0000-0000-000000000003', null, 'cf000000-0000-0000-0000-000000000001', 'Fans only',    'published', 'followers'),
  ('cf400000-0000-0000-0000-000000000004', null, 'cf000000-0000-0000-0000-000000000001', 'Empty public', 'published', 'public'),
  ('cf400000-0000-0000-0000-000000000005', null, 'cf000000-0000-0000-0000-000000000001', 'Old public',   'archived',  'public');
insert into public.program_days (program_id, week_index, day_index, name) values
  ('cf400000-0000-0000-0000-000000000001', 1, 0, 'Push'),
  ('cf400000-0000-0000-0000-000000000002', 1, 0, 'Day'),
  ('cf400000-0000-0000-0000-000000000003', 1, 0, 'Day'),
  ('cf400000-0000-0000-0000-000000000005', 1, 0, 'Day');

-- ============================================================================
-- 1. anonymous: the published coach, public data only
-- ============================================================================
select pg_temp.anonymous();
select ok(public.coach_public_profile('ana-coach') is not null, 'a published coach is public');
select is(public.coach_public_profile('ana-coach') #>> '{certifications,0,year}', '2016', 'a certification carries its year');
select is(public.coach_public_profile('ana-coach') #>> '{certifications,0,verified}', 'false',
  'an unverified certification has no verified flag');
select ok(position('secret-cert-doc' in public.coach_public_profile('ana-coach')::text) = 0
          and position('document_ref' in public.coach_public_profile('ana-coach')::text) = 0,
  'document_ref never leaves');
select ok(position('@' in public.coach_public_profile('ana-coach')::text) = 0, 'no e-mail in the profile');
select ok(position('777777' in public.coach_public_profile('ana-coach')::text) = 0, 'a private price never leaves');
select is((public.coach_public_profile('ana-coach') -> 'services' -> 1 ->> 'price_public')::boolean, false,
  'the private-priced service is listed without its price');
select is((public.coach_public_profile('ana-coach') #>> '{stats,posts}')::int, 1, 'only live public posts are counted');
select ok(public.coach_public_profile('ana-coach') #> '{stats,workouts}' <> 'null'::jsonb,
  'workout stats show while stats_visibility is public');
select is(public.coach_public_profile('ana-coach') #> '{stats,fitness_score}', 'null'::jsonb,
  'the Fitness Score stays hidden while its visibility is private');

select is((select count(*)::int from public.coach_public_posts('ana-coach')), 1, 'one public post');
select is((select text from public.coach_public_posts('ana-coach') limit 1), 'Public hello', 'and it is the public one');
select is((select count(*)::int from public.coach_public_posts('ana-coach')
           where text in ('Followers only', 'Private thought', 'Deleted public')), 0,
  'followers-only, private and deleted posts never come out');

select is(jsonb_array_length(public.coach_public_programs('ana-coach')), 1, 'one public routine');
select is(public.coach_public_programs('ana-coach') -> 0 ->> 'name', 'Public PPL', 'the public routine');
select ok(position('Secret block' in public.coach_public_programs('ana-coach')::text) = 0
          and position('Fans only' in public.coach_public_programs('ana-coach')::text) = 0
          and position('Old public' in public.coach_public_programs('ana-coach')::text) = 0,
  'private, followers-only and archived routines never come out');
select ok(position('@' in public.coach_public_programs('ana-coach')::text) = 0,
  'the routine author is the public name, never the e-mail full_name');

-- ============================================================================
-- 2. draft / pending / suspended: nothing at all
-- ============================================================================
select is(public.coach_public_profile('dora-draft'), null, 'a draft profile is not public');
select is((select count(*)::int from public.coach_public_posts('dora-draft')), 0, 'nor are a draft coach''s posts');
select is(public.coach_public_programs('dora-draft'), '[]'::jsonb, 'nor their routines');
select is(public.coach_public_profile('pia-pending'), null, 'a pending profile is not public');
select is((select count(*)::int from public.coach_public_posts('pia-pending')), 0, 'nor are a pending coach''s posts');
select is(public.coach_public_profile('sid-suspended'), null, 'a suspended profile is not public');
select is((select count(*)::int from public.coach_public_posts('sid-suspended')), 0, 'nor are a suspended coach''s posts');
select is(public.coach_public_profile('no-such-coach'), null, 'an unknown slug is nothing');

select throws_ok($$ select public.coach_viewer_state('cf500000-0000-0000-0000-000000000001') $$,
  '42501', null, 'anon cannot ask for viewer state');
select throws_ok($$ select * from public.coach_public_visible('ana-coach') $$,
  '42501', null, 'the gate itself is not callable');
select throws_ok($$ select count(*) from public.coaching_requests $$,
  '42501', null, 'anon cannot read coaching requests');

-- ============================================================================
-- 3. privacy settings gate the stats
-- ============================================================================
reset role;
update public.users set stats_visibility = 'private', fitness_score_visibility = 'public', fitness_score_public = 72
 where id = 'cf000000-0000-0000-0000-000000000001';
select pg_temp.anonymous();
select is(public.coach_public_profile('ana-coach') #> '{stats,workouts}', 'null'::jsonb,
  'workout stats disappear when stats_visibility is private');
select is((public.coach_public_profile('ana-coach') #>> '{stats,fitness_score}')::int, 72,
  'a Fitness Score published as public shows');

-- ============================================================================
-- 4. a signed-in client: viewer state, the request, no duplicates
-- ============================================================================
reset role;
create temp table ids as select id, slug from public.coach_profiles;
grant select on ids to authenticated, anon;
select pg_temp.authenticate_as('cf000000-0000-0000-0000-000000000002');
select is(public.coach_viewer_state((select id from ids where slug = 'ana-coach')) ->> 'is_self', 'false', 'not the coach');
select is(public.coach_viewer_state((select id from ids where slug = 'ana-coach')) -> 'pending_request', 'null'::jsonb,
  'no pending request yet');
select ok(public.coach_public_profile('ana-coach') ->> 'user_id' is not null, 'a signed-in reader gets the user id');
select lives_ok($$ select public.request_coaching((select id from ids where slug = 'ana-coach'),
                                                  'cf500000-0000-0000-0000-000000000001', 'Hi') $$,
  'the client asks for the chosen service');
select is(public.coach_viewer_state((select id from ids where slug = 'ana-coach')) #>> '{pending_request,service_id}',
  'cf500000-0000-0000-0000-000000000001', 'the pending request is reported, with its service');
select throws_ok($$ select public.request_coaching((select id from ids where slug = 'ana-coach')) $$,
  '23505', 'REQUEST_PENDING', 'a second pending request is refused');
select is(public.coach_viewer_state((select id from ids where slug = 'dora-draft')), null,
  'no viewer state for an unpublished profile');

reset role;
insert into public.trainer_clients (coach_id, client_id, status, started_at)
values ('cf000000-0000-0000-0000-000000000001', 'cf000000-0000-0000-0000-000000000002', 'active', now());
select pg_temp.authenticate_as('cf000000-0000-0000-0000-000000000002');
select is(public.coach_viewer_state((select id from ids where slug = 'ana-coach')) ->> 'is_client', 'true',
  'an active client is recognised');

-- ============================================================================
-- 5. follow, accepting_clients, self, block
-- ============================================================================
reset role;
select pg_temp.authenticate_as('cf000000-0000-0000-0000-000000000003');
select lives_ok($$ insert into public.social_follows (follower_id, following_id)
                   values (auth.uid(), 'cf000000-0000-0000-0000-000000000001') $$,
  'a stranger follows the coach through the existing follows table');
select is(public.coach_viewer_state((select id from ids where slug = 'ana-coach')) ->> 'is_following', 'true',
  'and the page knows');
select is((public.coach_public_profile('ana-coach') ->> 'followers')::int, 1, 'the follower is counted');
select lives_ok($$ delete from public.social_follows where follower_id = auth.uid() $$, 'and unfollows');
select is(public.coach_viewer_state((select id from ids where slug = 'ana-coach')) ->> 'is_following', 'false',
  'unfollow is reflected');

reset role;
update public.coach_profiles set accepting_clients = false where slug = 'ana-coach';
select pg_temp.authenticate_as('cf000000-0000-0000-0000-000000000003');
select is((public.coach_public_profile('ana-coach') ->> 'accepting_clients')::boolean, false, 'not accepting is public');
select throws_ok($$ select public.request_coaching((select id from ids where slug = 'ana-coach')) $$,
  '55000', 'NOT_ACCEPTING_CLIENTS', 'and the database refuses the request, not just the button');

reset role;
select pg_temp.authenticate_as('cf000000-0000-0000-0000-000000000001');
select is(public.coach_viewer_state((select id from ids where slug = 'ana-coach')) ->> 'is_self', 'true',
  'the coach sees their own page as self');

reset role;
insert into public.social_user_blocks (blocker_id, blocked_id)
values ('cf000000-0000-0000-0000-000000000001', 'cf000000-0000-0000-0000-000000000003');
select pg_temp.authenticate_as('cf000000-0000-0000-0000-000000000003');
select is(public.coach_public_profile('ana-coach'), null, 'a reader the coach blocked does not get the page');
select is((select count(*)::int from public.coach_public_posts('ana-coach')), 0, 'nor the posts');

reset role;
select * from finish();
rollback;
