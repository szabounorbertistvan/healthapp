-- pgTAP · Saved coaches (20261102100000)
--
-- A private shortlist: save once, unsave, never yourself, never a coach you
-- cannot see; only the saver ever reads a save — not the coach, not anyone
-- else, not anonymous callers; the saved state rides on the search cards and
-- the public profile's viewer state, computed in the same query.
--
-- Run with a local stack up:  npm run db:test
-- or without Docker:          node scripts/pgtest/run.mjs coach_saves

begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

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
create or replace function pg_temp.saved_slugs() returns text language sql as $fn$
  select coalesce(string_agg(i ->> 'slug', ',' order by o), '')
  from jsonb_array_elements(public.search_coaches(p_saved => true, p_accepting => false, p_sort => 'saved') -> 'items') with ordinality as t(i, o);
$fn$;

-- 01 coach A · 02 coach B · 03 the user who saves · 04 another user · 05 a draft coach
insert into auth.users (id, email, raw_user_meta_data) values
  ('c7000000-0000-0000-0000-000000000001'::uuid, 'ana@saves.local',  '{"full_name":"Ana","username":"ana_saves"}'),
  ('c7000000-0000-0000-0000-000000000002'::uuid, 'bo@saves.local',   '{"full_name":"Bo","username":"bo_saves"}'),
  ('c7000000-0000-0000-0000-000000000003'::uuid, 'uma@saves.local',  '{"full_name":"Uma","username":"uma_saves"}'),
  ('c7000000-0000-0000-0000-000000000004'::uuid, 'oz@saves.local',   '{"full_name":"Oz","username":"oz_saves"}'),
  ('c7000000-0000-0000-0000-000000000005'::uuid, 'dee@saves.local',  '{"full_name":"Dee","username":"dee_saves"}');

select pg_temp.authenticate_as('c7000000-0000-0000-0000-000000000001'); select public.become_coach(); reset role;
select pg_temp.authenticate_as('c7000000-0000-0000-0000-000000000002'); select public.become_coach(); reset role;
select pg_temp.authenticate_as('c7000000-0000-0000-0000-000000000005'); select public.become_coach(); reset role;
update public.coach_profiles set status = 'published', published_at = now() - interval '1 day', headline = 'A', online = true
 where slug in ('ana-saves', 'bo-saves');
create temp table ids as select slug, id from public.coach_profiles;
grant select on ids to authenticated, anon;
create or replace function pg_temp.pid(p_slug text) returns uuid language sql as $fn$ select id from ids where slug = p_slug; $fn$;

-- ============================================================================
-- 1. save, unsave, once only
-- ============================================================================
select pg_temp.authenticate_as('c7000000-0000-0000-0000-000000000003');
select is(pg_temp.saved_slugs(), '', 'a new user has no saved coaches');
select lives_ok($$ insert into public.coach_saves (user_id, coach_profile_id) values (auth.uid(), pg_temp.pid('ana-saves')) $$,
  'the user saves coach A');
select throws_ok($$ insert into public.coach_saves (user_id, coach_profile_id) values (auth.uid(), pg_temp.pid('ana-saves')) $$,
  '23505', null, 'saving the same coach twice is refused by the database');
-- one transaction stamps both saves alike: age the first so the order is real
reset role;
update public.coach_saves set created_at = now() - interval '1 hour';
select pg_temp.authenticate_as('c7000000-0000-0000-0000-000000000003');
select lives_ok($$ insert into public.coach_saves (user_id, coach_profile_id) values (auth.uid(), pg_temp.pid('bo-saves')) $$,
  'and coach B');
select is(pg_temp.saved_slugs(), 'bo-saves,ana-saves', 'the saved list, most recently saved first');
select is((select count(*)::int from public.coach_saves), 2, 'the user reads their own saves');
select lives_ok($$ delete from public.coach_saves where coach_profile_id = pg_temp.pid('bo-saves') $$, 'the user unsaves coach B');
select is(pg_temp.saved_slugs(), 'ana-saves', 'B is gone from the list');

-- ============================================================================
-- 2. the saved state on the cards and the public profile
-- ============================================================================
select is((select string_agg((i ->> 'slug') || '=' || (i ->> 'is_saved'), ',' order by i ->> 'slug')
           from jsonb_array_elements(public.search_coaches(p_accepting => false) -> 'items') i),
  'ana-saves=true,bo-saves=false', 'each card says whether this user saved it');
select ok((select bool_and(i ? 'id') from jsonb_array_elements(public.search_coaches(p_accepting => false) -> 'items') i),
  'each card carries its profile id for the Save button');
select is(public.coach_viewer_state(pg_temp.pid('ana-saves')) ->> 'is_saved', 'true', 'the profile''s viewer state knows it is saved');
select is(public.coach_viewer_state(pg_temp.pid('bo-saves')) ->> 'is_saved', 'false', 'and that this one is not');

-- ============================================================================
-- 3. never yourself, never someone else's, never an invisible coach
-- ============================================================================
select throws_ok($$ insert into public.coach_saves (user_id, coach_profile_id) values ('c7000000-0000-0000-0000-000000000004', pg_temp.pid('bo-saves')) $$,
  '42501', null, 'a user cannot create a save for someone else');
select throws_ok($$ insert into public.coach_saves (user_id, coach_profile_id) values (auth.uid(), pg_temp.pid('dee-saves')) $$,
  '42501', null, 'a draft coach cannot be saved');
select throws_ok($$ update public.coach_saves set created_at = now() - interval '1 year' $$,
  '42501', null, 'a save cannot be edited');
reset role;
select pg_temp.authenticate_as('c7000000-0000-0000-0000-000000000001');
select throws_ok($$ insert into public.coach_saves (user_id, coach_profile_id) values (auth.uid(), pg_temp.pid('ana-saves')) $$,
  '23514', 'CANNOT_SAVE_SELF', 'a coach cannot save themselves');
select is((select count(*)::int from public.coach_saves), 0, 'coach A cannot see who saved them');
select is(pg_temp.saved_slugs(), '', 'and their own saved list is theirs only');
select ok(not exists (select 1 from jsonb_array_elements(public.search_coaches(p_accepting => false) -> 'items') i
                      where i ? 'saves' or i ? 'save_count'), 'no key exposes saves');
reset role;
select throws_ok($$ insert into public.coach_saves (user_id, coach_profile_id)
  values ('c7000000-0000-0000-0000-000000000001', (select id from ids where slug = 'ana-saves')) $$,
  '23514', 'CANNOT_SAVE_SELF', 'saving yourself is refused even past the policy (trigger)');
select pg_temp.authenticate_as('c7000000-0000-0000-0000-000000000004');
select is((select count(*)::int from public.coach_saves), 0, 'another user reads none of the saves');
delete from public.coach_saves;
reset role;
select is((select count(*)::int from public.coach_saves), 1, 'and deletes none of them');

-- ============================================================================
-- 4. anonymous callers
-- ============================================================================
select pg_temp.anonymous();
select throws_ok($$ select count(*) from public.coach_saves $$, '42501', null, 'anonymous callers cannot read saves');
select throws_ok($$ insert into public.coach_saves (user_id, coach_profile_id) values ('c7000000-0000-0000-0000-000000000003', (select id from ids where slug = 'ana-saves')) $$,
  '42501', null, 'nor create one');
select is(pg_temp.saved_slugs(), '', 'an anonymous saved list is empty, not someone else''s');
select ok(not exists (select 1 from jsonb_array_elements(public.search_coaches(p_accepting => false) -> 'items') i where i ? 'is_saved'),
  'anonymous cards carry no saved state');
select is(public.coach_public_profile('ana-saves') ? 'is_saved', false, 'nor does the public profile');
reset role;

-- ============================================================================
-- 5. a coach who goes away stays private and invisible
-- ============================================================================
update public.coach_profiles set status = 'hidden' where slug = 'ana-saves';
select pg_temp.authenticate_as('c7000000-0000-0000-0000-000000000003');
select is(pg_temp.saved_slugs(), '', 'a hidden coach drops out of the saved list (the save is kept)');
select is((select count(*)::int from public.coach_saves), 1, 'the row itself is still the user''s');
reset role;
update public.coach_profiles set status = 'published' where slug = 'ana-saves';
select pg_temp.authenticate_as('c7000000-0000-0000-0000-000000000003');
select is(pg_temp.saved_slugs(), 'ana-saves', 'and comes back with them');
reset role;
delete from public.coach_profiles where slug = 'ana-saves';
select is((select count(*)::int from public.coach_saves), 0, 'a deleted profile takes its saves with it');

select * from finish();
rollback;
