-- pgTAP · Coach reviews and ratings (20261106100000)
--
-- Only a real interaction earns a review (coaching for a week or ended, or a
-- completed session); one review per reviewer and coach, edited in place;
-- no self-review, no rating outside 1–5, no oversized text; identities are
-- not the caller's to choose or change; the coach answers but never edits or
-- removes; the reviewer deletes softly and may write again; an admin hides
-- and restores through the existing admin_assert() + audit path, and reports
-- go through the existing social_report(); the aggregates are derived from
-- published reviews and reach the public page and the Discovery card.
--
-- Run with a local stack up:  npm run db:test
-- or without Docker:          node scripts/pgtest/run.mjs coach_reviews

begin;
create extension if not exists pgtap with schema extensions;
select plan(84);

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

-- 01 coach K · 02 A (coached 10 days) · 03 N (coached 2 days) · 04 E (coaching ended) · 05 B (a completed session)
-- 06 P (a cancelled session + an accepted request) · 07 S stranger · 08 coach M · 09 admin
insert into auth.users (id, email, raw_user_meta_data) values
  ('cc000000-0000-0000-0000-000000000001'::uuid, 'kai@rev.local', '{"full_name":"Kai","username":"kai_rev"}'),
  ('cc000000-0000-0000-0000-000000000002'::uuid, 'ana@rev.local', '{"full_name":"Ana","username":"ana_rev"}'),
  ('cc000000-0000-0000-0000-000000000003'::uuid, 'nia@rev.local', '{"full_name":"Nia","username":"nia_rev"}'),
  ('cc000000-0000-0000-0000-000000000004'::uuid, 'eli@rev.local', '{"full_name":"Eli","username":"eli_rev"}'),
  ('cc000000-0000-0000-0000-000000000005'::uuid, 'bea@rev.local', '{"full_name":"Bea","username":"bea_rev"}'),
  ('cc000000-0000-0000-0000-000000000006'::uuid, 'pia@rev.local', '{"full_name":"Pia","username":"pia_rev"}'),
  ('cc000000-0000-0000-0000-000000000007'::uuid, 'sam@rev.local', '{"full_name":"Sam","username":"sam_rev"}'),
  ('cc000000-0000-0000-0000-000000000008'::uuid, 'max@rev.local', '{"full_name":"Max","username":"max_rev"}'),
  ('cc000000-0000-0000-0000-000000000009'::uuid, 'ada@rev.local', '{"full_name":"Ada","username":"ada_rev"}');
update public.users set role = 'admin' where id = 'cc000000-0000-0000-0000-000000000009';

select pg_temp.authenticate_as('cc000000-0000-0000-0000-000000000001'); select public.become_coach(); reset role;
select pg_temp.authenticate_as('cc000000-0000-0000-0000-000000000008'); select public.become_coach(); reset role;
update public.coach_profiles set status = 'published', published_at = now(), headline = 'K', online = true, accepting_clients = true
 where slug in ('kai-rev', 'max-rev');
create temp table ids as select slug, id from public.coach_profiles;
grant select on ids to authenticated, anon;
create or replace function pg_temp.pid(p_slug text) returns uuid language sql as $fn$ select id from ids where slug = p_slug; $fn$;
create temp table rv (name text primary key, id uuid);
grant select, insert on rv to authenticated;
create or replace function pg_temp.rid(p text) returns uuid language sql as $fn$ select id from rv where name = p; $fn$;
create or replace function pg_temp.notices(p_user uuid, p_event text) returns int language sql security definer as $fn$
  select count(*)::int from public.notifications
  where user_id = p_user and category::text = 'review' and payload ->> 'event' = p_event;
$fn$;
create or replace function pg_temp.stats() returns table (n int, avg numeric, dist int[]) language sql security definer as $fn$
  select review_count, review_avg, review_distribution from public.coach_profiles where slug = 'kai-rev';
$fn$;
create or replace function pg_temp.card(p_slug text) returns jsonb language sql as $fn$
  select i from jsonb_array_elements(public.search_coaches() -> 'items') i where i ->> 'slug' = p_slug;
$fn$;

-- the interactions
insert into public.trainer_clients (coach_id, client_id, status, started_at) values
  ('cc000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000002', 'active', now() - interval '10 days'),
  ('cc000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000003', 'active', now() - interval '2 days');
insert into public.trainer_clients (coach_id, client_id, status, started_at, ended_at) values
  ('cc000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000004', 'ended', now() - interval '90 days', now() - interval '30 days');
insert into public.bookings (client_id, coach_id, service_name, start_at, end_at, timezone, block_start, block_end, status) values
  ('cc000000-0000-0000-0000-000000000005', 'cc000000-0000-0000-0000-000000000001', 'PT',
   now() - interval '3 days', now() - interval '3 days' + interval '1 hour', 'UTC',
   now() - interval '3 days', now() - interval '3 days' + interval '1 hour', 'completed'),
  ('cc000000-0000-0000-0000-000000000006', 'cc000000-0000-0000-0000-000000000001', 'PT',
   now() - interval '5 days', now() - interval '5 days' + interval '1 hour', 'UTC',
   now() - interval '5 days', now() - interval '5 days' + interval '1 hour', 'cancelled');
insert into public.coaching_requests (client_id, coach_id, status, resolved_at)
values ('cc000000-0000-0000-0000-000000000006', 'cc000000-0000-0000-0000-000000000001', 'accepted', now());

-- ============================================================================
-- 1. who may review
-- ============================================================================
select pg_temp.anonymous();
select throws_ok($$ select public.submit_coach_review(pg_temp.pid('kai-rev'), 5, 'Great') $$,
  '42501', null, 'an anonymous visitor cannot review');
reset role;
select pg_temp.authenticate_as('cc000000-0000-0000-0000-000000000007');
select throws_ok($$ select public.submit_coach_review(pg_temp.pid('kai-rev'), 5, 'Great') $$,
  '42501', 'NOT_ELIGIBLE', 'someone who never worked with the coach cannot review');
select is((public.my_coach_review_state(pg_temp.pid('kai-rev')) ->> 'eligible')::boolean, false, 'and is told they are not eligible');
reset role;
select pg_temp.authenticate_as('cc000000-0000-0000-0000-000000000003');
select throws_ok($$ select public.submit_coach_review(pg_temp.pid('kai-rev'), 5) $$,
  '42501', 'NOT_ELIGIBLE', 'two days of coaching is not yet a review');
reset role;
select pg_temp.authenticate_as('cc000000-0000-0000-0000-000000000006');
select throws_ok($$ select public.submit_coach_review(pg_temp.pid('kai-rev'), 1) $$,
  '42501', 'NOT_ELIGIBLE', 'a cancelled session and an accepted request are not an interaction');
reset role;
select pg_temp.authenticate_as('cc000000-0000-0000-0000-000000000001');
select throws_ok($$ select public.submit_coach_review(pg_temp.pid('kai-rev'), 5) $$,
  '22023', 'CANNOT_REVIEW_SELF', 'a coach cannot review themselves');
reset role;

select pg_temp.authenticate_as('cc000000-0000-0000-0000-000000000002');
select is((public.my_coach_review_state(pg_temp.pid('kai-rev')) ->> 'eligible')::boolean, true, 'a week of coaching is eligible');
select is(public.my_coach_review_state(pg_temp.pid('kai-rev')) ->> 'basis', 'coaching', 'on the coaching basis');
select throws_ok($$ select public.submit_coach_review(pg_temp.pid('kai-rev'), 0) $$, '22023', 'INVALID_RATING', 'no zero stars');
select throws_ok($$ select public.submit_coach_review(pg_temp.pid('kai-rev'), 6) $$, '22023', 'INVALID_RATING', 'no six stars');
select throws_ok($$ select public.submit_coach_review(pg_temp.pid('kai-rev'), 5, repeat('x', 2001)) $$,
  '22023', 'REVIEW_TOO_LONG', 'no essays over 2000 characters');
select throws_ok($$ select public.submit_coach_review('cc999999-0000-0000-0000-000000000000', 5) $$,
  'P0002', 'COACH_NOT_FOUND', 'no review of a coach page that does not exist');
insert into rv values ('ana', public.submit_coach_review(pg_temp.pid('kai-rev'), 5, '  Changed how I train.  '));
select is((select status from public.coach_reviews where id = pg_temp.rid('ana')), 'published', 'an eligible client''s review is published');
select is((select body from public.coach_reviews where id = pg_temp.rid('ana')), 'Changed how I train.', 'its text is trimmed');
select is((select reviewer_id from public.coach_reviews where id = pg_temp.rid('ana')), 'cc000000-0000-0000-0000-000000000002'::uuid,
  'the reviewer is the caller, never an argument');
-- direct writes
select throws_ok($$ insert into public.coach_reviews (reviewer_id, coach_id, basis, rating)
                    values (auth.uid(), 'cc000000-0000-0000-0000-000000000008', 'coaching', 5) $$,
  '42501', null, 'nobody writes the table directly');
select throws_ok($$ update public.coach_reviews set rating = 1 where id = pg_temp.rid('ana') $$,
  '42501', null, 'not even their own row');
select throws_ok($$ delete from public.coach_reviews where id = pg_temp.rid('ana') $$,
  '42501', null, 'nor delete it directly');
reset role;
select is(pg_temp.notices('cc000000-0000-0000-0000-000000000001', 'published'), 1, 'the coach is told');

-- ============================================================================
-- 2. one review, edited in place
-- ============================================================================
select pg_temp.authenticate_as('cc000000-0000-0000-0000-000000000002');
select is(public.submit_coach_review(pg_temp.pid('kai-rev'), 4, 'Still great, a bit pricey.'), pg_temp.rid('ana'),
  'writing again edits the same review');
reset role;
select is((select count(*)::int from public.coach_reviews where reviewer_id = 'cc000000-0000-0000-0000-000000000002'), 1,
  'never a second row');
select is((select rating from public.coach_reviews where id = pg_temp.rid('ana')), 4::smallint, 'the rating changed');
select isnt((select edited_at from public.coach_reviews where id = pg_temp.rid('ana')), null, 'and it is marked edited');
select is(pg_temp.notices('cc000000-0000-0000-0000-000000000001', 'published'), 1, 'an edit does not notify again');
select throws_ok($$ insert into public.coach_reviews (reviewer_id, coach_id, basis, rating)
                    values ('cc000000-0000-0000-0000-000000000002', 'cc000000-0000-0000-0000-000000000001', 'coaching', 5) $$,
  '23505', null, 'the database itself refuses a duplicate, whoever writes it');
select throws_ok($$ update public.coach_reviews set coach_id = 'cc000000-0000-0000-0000-000000000008' where id = pg_temp.rid('ana') $$,
  '42501', 'REVIEW_IDENTITY_IMMUTABLE', 'and refuses moving a review to another coach, whoever writes it');
select throws_ok($$ update public.coach_reviews set reviewer_id = 'cc000000-0000-0000-0000-000000000007' where id = pg_temp.rid('ana') $$,
  '42501', 'REVIEW_IDENTITY_IMMUTABLE', 'or to another reviewer');

select pg_temp.authenticate_as('cc000000-0000-0000-0000-000000000005');
insert into rv values ('bea', public.submit_coach_review(pg_temp.pid('kai-rev'), 3));
select is((select basis from public.coach_reviews where id = pg_temp.rid('bea')), 'booking', 'a completed session is a basis');
select is((select body from public.coach_reviews where id = pg_temp.rid('bea')), null, 'the text is optional');
reset role;
select pg_temp.authenticate_as('cc000000-0000-0000-0000-000000000004');
insert into rv values ('eli', public.submit_coach_review(pg_temp.pid('kai-rev'), 2, 'Not for me.'));
select is((select basis from public.coach_reviews where id = pg_temp.rid('eli')), 'coaching', 'coaching that ended is a basis');
reset role;
-- one transaction, one now(): spread the three apart so "newest first" has an order
update public.coach_reviews set created_at = now() - interval '3 minutes' where id = pg_temp.rid('ana');
update public.coach_reviews set created_at = now() - interval '2 minutes' where id = pg_temp.rid('bea');
update public.coach_reviews set created_at = now() - interval '1 minute' where id = pg_temp.rid('eli');

-- ============================================================================
-- 3. the aggregates
-- ============================================================================
select is((select n from pg_temp.stats()), 3, 'three published reviews');
select is((select avg from pg_temp.stats()), 3.00::numeric, 'average (4 + 3 + 2) / 3');
select is((select dist from pg_temp.stats()), '{0,1,1,1,0}'::int[], 'one each of 2, 3 and 4 stars');
select pg_temp.authenticate_as('cc000000-0000-0000-0000-000000000001');
select throws_ok($$ update public.coach_profiles set review_count = 99, review_avg = 5 where user_id = auth.uid() $$,
  '42501', null, 'the coach cannot write their own rating');
select is((select count(*)::int from public.coach_reviews), 3, 'the coach reads the reviews about them');
select throws_ok($$ update public.coach_reviews set rating = 5 where id = pg_temp.rid('eli') $$,
  '42501', null, 'but cannot change one');
select throws_ok($$ delete from public.coach_reviews where id = pg_temp.rid('eli') $$,
  '42501', null, 'nor delete one');
select throws_ok($$ select public.delete_my_coach_review(pg_temp.rid('eli')) $$,
  'P0002', 'REVIEW_NOT_FOUND', 'nor take it down through the reviewer''s door');
reset role;

-- ============================================================================
-- 4. the public page and the Discovery card
-- ============================================================================
select pg_temp.anonymous();
select is((public.coach_public_reviews('kai-rev') ->> 'count')::int, 3, 'the public count');
select is((public.coach_public_reviews('kai-rev') ->> 'average')::numeric, 3.00::numeric, 'the public average');
select is(public.coach_public_reviews('kai-rev') -> 'distribution', '[0, 1, 1, 1, 0]'::jsonb, 'the distribution, 1 to 5 stars');
select is(jsonb_array_length(public.coach_public_reviews('kai-rev') -> 'items'), 3, 'three cards');
select is((public.coach_public_reviews('kai-rev') -> 'items' -> 0) ->> 'reviewer_name', 'eli_rev', 'newest first, by public name');
select ok(not ((public.coach_public_reviews('kai-rev') -> 'items' -> 0) ? 'reviewer_id'), 'no reviewer id in the public card');
select is((pg_temp.card('kai-rev') -> 'rating' ->> 'count')::int, 3, 'the Discovery card carries the count');
select is((pg_temp.card('kai-rev') -> 'rating' ->> 'average')::numeric, 3.00::numeric, 'and the average');
select is(pg_temp.card('max-rev') -> 'rating', 'null'::jsonb, 'a coach with no reviews shows no rating');
select throws_ok($$ select * from public.coach_reviews $$, '42501', null, 'the public never reads the table');
select throws_ok($$ select public.submit_coach_review(pg_temp.pid('kai-rev'), 5) $$, '42501', null, 'nor writes');
reset role;
select pg_temp.authenticate_as('cc000000-0000-0000-0000-000000000007');
select is((select count(*)::int from public.coach_reviews), 0, 'a stranger reads no review rows directly');
reset role;

-- ============================================================================
-- 5. the coach's answer
-- ============================================================================
select pg_temp.authenticate_as('cc000000-0000-0000-0000-000000000001');
select lives_ok($$ select public.respond_to_coach_review(pg_temp.rid('ana'), 'Thank you, Ana!') $$, 'the coach answers');
select lives_ok($$ select public.respond_to_coach_review(pg_temp.rid('ana'), 'Thank you, Ana — see you Monday!') $$, 'and edits the answer');
select throws_ok($$ select public.respond_to_coach_review(pg_temp.rid('ana'), repeat('x', 1001)) $$,
  '22023', 'RESPONSE_TOO_LONG', 'an answer is short');
reset role;
select is((select rating from public.coach_reviews where id = pg_temp.rid('ana')), 4::smallint, 'the review itself is untouched');
select is(pg_temp.notices('cc000000-0000-0000-0000-000000000002', 'response'), 1, 'the reviewer is told once');
select pg_temp.authenticate_as('cc000000-0000-0000-0000-000000000008');
select throws_ok($$ select public.respond_to_coach_review(pg_temp.rid('ana'), 'Me too') $$,
  'P0002', 'REVIEW_NOT_FOUND', 'another coach cannot answer');
reset role;
select pg_temp.anonymous();
select is((select i ->> 'coach_response' from jsonb_array_elements(public.coach_public_reviews('kai-rev') -> 'items') i
           where i ->> 'reviewer_name' = 'ana_rev'), 'Thank you, Ana — see you Monday!', 'the answer is public under the review');
reset role;

-- ============================================================================
-- 6. reports and moderation
-- ============================================================================
select pg_temp.authenticate_as('cc000000-0000-0000-0000-000000000001');
select lives_ok($$ select public.social_report('review', pg_temp.rid('eli'), 'false_information', 'Never trained like that') $$,
  'the coach reports a review through the existing report path');
reset role;
select pg_temp.authenticate_as('cc000000-0000-0000-0000-000000000004');
select throws_ok($$ select public.social_report('review', pg_temp.rid('eli'), 'spam') $$,
  '22023', null, 'nobody reports their own review');
reset role;
select pg_temp.authenticate_as('cc000000-0000-0000-0000-000000000001');
select throws_ok($$ select * from public.admin_coach_reviews() $$, '42501', 'ADMIN_ONLY', 'the moderation list is admin-only');
select throws_ok($$ select public.admin_set_review_status(pg_temp.rid('eli'), 'hidden', 'x') $$, '42501', 'ADMIN_ONLY', 'and so is hiding');
reset role;
select pg_temp.authenticate_as('cc000000-0000-0000-0000-000000000009');
select is((select open_reports from public.admin_coach_reviews() where id = pg_temp.rid('eli')), 1, 'an admin sees the reported review');
select throws_ok($$ select public.admin_set_review_status(pg_temp.rid('eli'), 'hidden') $$,
  '22023', 'REASON_REQUIRED', 'hiding needs a reason');
select lives_ok($$ select public.admin_set_review_status(pg_temp.rid('eli'), 'hidden', 'Reported, unverifiable claims') $$, 'the admin hides it');
reset role;
select is((select count(*)::int from public.social_reports where reported_review_id = pg_temp.rid('eli') and status = 'open'), 0,
  'its reports are closed as reviewed');
select is((select count(*)::int from public.admin_audit_events where entity_type = 'coach_review'), 1, 'the action is audited');
select is((select n from pg_temp.stats()), 2, 'a hidden review leaves the count');
select is((select avg from pg_temp.stats()), 3.50::numeric, 'and the average');
select pg_temp.anonymous();
select is(jsonb_array_length(public.coach_public_reviews('kai-rev') -> 'items'), 2, 'and the public page');
reset role;
select pg_temp.authenticate_as('cc000000-0000-0000-0000-000000000004');
select throws_ok($$ select public.submit_coach_review(pg_temp.pid('kai-rev'), 5, 'Actually great') $$,
  '55000', 'REVIEW_HIDDEN', 'the reviewer cannot edit a hidden review back into view');
select throws_ok($$ select public.delete_my_coach_review(pg_temp.rid('eli')) $$,
  '55000', 'REVIEW_HIDDEN', 'nor delete it out of moderation');
select is(public.my_coach_review_state(pg_temp.pid('kai-rev')) #>> '{review,status}', 'hidden', 'they see it is hidden');
reset role;
select pg_temp.authenticate_as('cc000000-0000-0000-0000-000000000009');
select lives_ok($$ select public.admin_set_review_status(pg_temp.rid('eli'), 'published') $$, 'the admin restores it');
reset role;
select is((select n from pg_temp.stats()), 3, 'and it counts again');

-- ============================================================================
-- 7. the reviewer deletes, and may write again
-- ============================================================================
select pg_temp.authenticate_as('cc000000-0000-0000-0000-000000000007');
select throws_ok($$ select public.delete_my_coach_review(pg_temp.rid('bea')) $$,
  'P0002', 'REVIEW_NOT_FOUND', 'nobody deletes someone else''s review');
reset role;
select pg_temp.authenticate_as('cc000000-0000-0000-0000-000000000005');
select lives_ok($$ select public.delete_my_coach_review(pg_temp.rid('bea')) $$, 'the reviewer deletes their own');
reset role;
select is((select status from public.coach_reviews where id = pg_temp.rid('bea')), 'deleted', 'softly: the slot stays');
select is((select n from pg_temp.stats()), 2, 'and it leaves the count');
select pg_temp.authenticate_as('cc000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.coach_reviews where id = pg_temp.rid('bea')), 0, 'the coach no longer sees it');
reset role;
select pg_temp.authenticate_as('cc000000-0000-0000-0000-000000000005');
select is(public.submit_coach_review(pg_temp.pid('kai-rev'), 5, 'Second session was better'), pg_temp.rid('bea'),
  'writing again revives the same review');
reset role;
select is((select n from pg_temp.stats()), 3, 'back in the count');
select is(pg_temp.notices('cc000000-0000-0000-0000-000000000001', 'published'), 4, 'the coach is told of the revived review too');

-- ============================================================================
-- 8. blocks
-- ============================================================================
insert into public.social_user_blocks (blocker_id, blocked_id)
values ('cc000000-0000-0000-0000-000000000007', 'cc000000-0000-0000-0000-000000000002');
select pg_temp.authenticate_as('cc000000-0000-0000-0000-000000000007');
select is((select count(*)::int from jsonb_array_elements(public.coach_public_reviews('kai-rev') -> 'items') i
           where i ->> 'reviewer_name' = 'ana_rev'), 0, 'a reviewer behind a block is left out of the list');
reset role;
insert into public.social_user_blocks (blocker_id, blocked_id)
values ('cc000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000004');
select pg_temp.authenticate_as('cc000000-0000-0000-0000-000000000004');
select throws_ok($$ select public.submit_coach_review(pg_temp.pid('kai-rev'), 1, 'Blocked me') $$,
  'P0002', 'COACH_NOT_FOUND', 'nobody reviews across a block');
reset role;

select * from finish();
rollback;
