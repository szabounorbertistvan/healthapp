-- pgTAP · Coach Discovery ranking (20261110130000)
--
-- One ranking layer (coach_ranked) behind search_coaches and the admin
-- inspector: structured relevance (specialization, city, format) before
-- text; verification helps but never beats clearly better relevance;
-- ratings count with confidence (Bayesian); new qualified coaches get a
-- small, fading boost; coaches with no data are neutral, not buried;
-- popularity saturates; the order is deterministic and pages never overlap;
-- the public result carries no score; only an admin sees the parts.
--
-- Run with a local stack up:  npm run db:test
-- or without Docker:          node scripts/pgtest/run.mjs coach_ranking

begin;
create extension if not exists pgtap with schema extensions;
select plan(40);

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
create or replace function pg_temp.slugs(r jsonb) returns text language sql as $fn$
  select coalesce(string_agg(i ->> 'slug', ',' order by o), '') from jsonb_array_elements(r -> 'items') with ordinality as t(i, o);
$fn$;
-- a coach's 1-based position in a result, null when absent
create or replace function pg_temp.pos(r jsonb, p_slug text) returns int language sql as $fn$
  select o::int from jsonb_array_elements(r -> 'items') with ordinality as t(i, o) where i ->> 'slug' = p_slug;
$fn$;
-- a coach's ranking parts (as an admin would read them), no context
create or replace function pg_temp.part(p_slug text, p_part text) returns numeric language plpgsql security definer as $fn$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', 'ab000000-0000-0000-0000-0000000000ad', 'role', 'authenticated')::text, true);
  select to_jsonb(x) into v from public.admin_coach_ranking(p_limit => 200) x where x.slug = p_slug;
  return (v ->> p_part)::numeric;
end;
$fn$;

-- the coaches; everything not named is equal between the pairs compared
insert into auth.users (id, email, raw_user_meta_data)
select ('ab000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, u || '@rank.local',
       json_build_object('full_name', u, 'username', u)::jsonb
from (values (1, 'rk_bbprim'), (2, 'rk_bbtext'), (3, 'rk_nobb'), (4, 'rk_clujip'), (5, 'rk_bucip'), (6, 'rk_onlinefar'),
             (7, 'rk_ver'), (8, 'rk_rone'), (9, 'rk_rmany'), (10, 'rk_newbie'), (11, 'rk_oldver'), (12, 'rk_empty'),
             (13, 'rk_clujver'), (14, 'rk_newraw'), (15, 'rk_rlow')) v(n, u);
insert into auth.users (id, email, raw_user_meta_data) values
  ('ab000000-0000-0000-0000-0000000000ad', 'admin@rank.local', '{"full_name":"Admin","username":"rk_admin"}'),
  ('ab000000-0000-0000-0000-0000000000c1', 'client@rank.local', '{"full_name":"Client","username":"rk_client"}');
update public.users set role = 'admin' where id = 'ab000000-0000-0000-0000-0000000000ad';

do $$
declare r record;
begin
  for r in select id from auth.users where email like 'rk\_%@rank.local' escape '\' loop
    perform set_config('request.jwt.claims', json_build_object('sub', r.id::text, 'role', 'authenticated')::text, true);
    perform public.become_coach();
  end loop;
end;
$$;

update public.coach_profiles set headline = 'Coach', online = false, in_person = true, accepting_clients = true,
       status = 'published', published_at = now() - interval '100 days'
 where slug like 'rk-%';
-- specializations
insert into public.coach_specializations (coach_profile_id, specialization_id, is_primary)
select cp.id, s.id, x.prim from (values
  ('rk-bbprim', 'bodybuilding', true),
  ('rk-bbtext', 'strength', true),
  ('rk-nobb', 'weight-loss', true),
  ('rk-clujip', 'hypertrophy', true),
  ('rk-clujver', 'hypertrophy', true),
  ('rk-bucip', 'strength', true), ('rk-bucip', 'hypertrophy', false),
  ('rk-onlinefar', 'hypertrophy', true),
  ('rk-ver', 'weight-loss', true)) x(slug, spec, prim)
join public.coach_profiles cp on cp.slug = x.slug join public.specializations s on s.slug = x.spec;
-- text that mentions bodybuilding without the specialization
update public.coach_profiles set about = 'I also enjoy bodybuilding shows' where slug in ('rk-bbtext', 'rk-ver');
-- formats and places
update public.coach_profiles set online = true, in_person = false where slug in ('rk-nobb', 'rk-onlinefar');
insert into public.coach_locations (coach_profile_id, city_id)
select cp.id, c.id from (values ('rk-bbprim', 'cluj-napoca'), ('rk-clujip', 'cluj-napoca'), ('rk-clujver', 'cluj-napoca'),
                                ('rk-bucip', 'bucharest'), ('rk-bbtext', 'bucharest'), ('rk-onlinefar', 'iasi')) x(slug, city)
join public.coach_profiles cp on cp.slug = x.slug join public.cities c on c.slug = x.city;
-- trust
update public.coach_profiles set verification_status = 'verified' where slug in ('rk-ver', 'rk-clujver', 'rk-newbie', 'rk-oldver');
-- ratings: 5.0 from one review against 4.9 from 150, and a poor 2.0 from 20 (aggregates as columns)
update public.coach_profiles set review_count = 1, review_avg = 5.00 where slug = 'rk-rone';
update public.coach_profiles set review_count = 150, review_avg = 4.90 where slug = 'rk-rmany';
update public.coach_profiles set review_count = 20, review_avg = 2.00 where slug = 'rk-rlow';
-- new: two days old (one verified, one unqualified)
update public.coach_profiles set published_at = now() - interval '2 days' where slug in ('rk-newbie', 'rk-newraw');

select public.coach_rank_signals_refresh();

-- ============================================================================
-- 1. relevance: structure before text
-- ============================================================================
select pg_temp.anonymous();
select cmp_ok(pg_temp.pos(public.search_coaches(p_query => 'bodybuilding'), 'rk-bbprim'), '<',
              pg_temp.pos(public.search_coaches(p_query => 'bodybuilding'), 'rk-bbtext'),
  'bodybuilding: the bodybuilding specialist above a coach who only mentions it');
select is(pg_temp.pos(public.search_coaches(p_query => 'bodybuilding'), 'rk-nobb'), null,
  'bodybuilding: a coach with no bodybuilding relevance is not listed');
select is(pg_temp.pos(public.search_coaches(p_query => 'bodybuild'), 'rk-bbprim'), 1, 'a specialization prefix reads as the specialization');
select cmp_ok(pg_temp.pos(public.search_coaches(p_query => 'Cluj'), 'rk-clujip'), '<',
              pg_temp.pos(public.search_coaches(p_query => 'Cluj'), 'rk-onlinefar'),
  'Cluj: a Cluj coach above an online coach elsewhere');
select is(pg_temp.pos(public.search_coaches(p_query => 'Cluj'), 'rk-bucip'), null, 'Cluj: an in-person Bucharest coach is not listed');
select ok(pg_temp.pos(public.search_coaches(p_query => 'Cluj'), 'rk-onlinefar') is not null, 'Cluj: online coaches serve everywhere, so they are listed after');
select ok(pg_temp.pos(public.search_coaches(p_query => 'online coaching'), 'rk-onlinefar') is not null
          and pg_temp.pos(public.search_coaches(p_query => 'online coaching'), 'rk-nobb') is not null,
  '"online coaching": coaches offering online, though neither wrote "online"');
select is(pg_temp.pos(public.search_coaches(p_query => 'online coaching'), 'rk-bucip'), null, '"online coaching": in-person-only coaches are not');
select ok(pg_temp.pos(public.search_coaches(p_query => 'hypertrophy cluj'), 'rk-clujip') < pg_temp.pos(public.search_coaches(p_query => 'hypertrophy cluj'), 'rk-onlinefar')
          and pg_temp.pos(public.search_coaches(p_query => 'hypertrophy cluj'), 'rk-bucip') is null,
  'specialization + city combine: both answered beats one');
select cmp_ok(pg_temp.pos(public.search_coaches(p_specializations => array['hypertrophy']), 'rk-clujip'), '<',
              pg_temp.pos(public.search_coaches(p_specializations => array['hypertrophy']), 'rk-bucip'),
  'a specialization filter: the coach whose primary it is first');
select is((public.search_coaches(p_query => 'zzqqx') ->> 'total')::int, 0, 'an irrelevant query matches nobody');

-- ============================================================================
-- 2. trust: an advantage, not a guarantee
-- ============================================================================
select cmp_ok(pg_temp.pos(public.search_coaches(p_query => 'hypertrophy'), 'rk-clujver'), '<',
              pg_temp.pos(public.search_coaches(p_query => 'hypertrophy'), 'rk-clujip'),
  'equally relevant: the verified coach first');
select cmp_ok(pg_temp.pos(public.search_coaches(p_query => 'bodybuilding'), 'rk-bbprim'), '<',
              pg_temp.pos(public.search_coaches(p_query => 'bodybuilding'), 'rk-ver'),
  'a verified coach who only mentions bodybuilding stays below the unverified specialist');
reset role;

-- ============================================================================
-- 3. reviews with confidence
-- ============================================================================
select cmp_ok(pg_temp.part('rk-rmany', 'quality'), '>', pg_temp.part('rk-rone', 'quality'),
  '4.9 from 150 reviews is worth more than 5.0 from one');
select cmp_ok(pg_temp.part('rk-rone', 'quality'), '>', pg_temp.part('rk-empty', 'quality'),
  'one good review is a little better than none');
select cmp_ok(pg_temp.part('rk-rlow', 'quality'), '<', pg_temp.part('rk-empty', 'quality'),
  'many poor reviews rank below none: no reviews is neutral, not zero');
select pg_temp.anonymous();
select cmp_ok(pg_temp.pos(public.search_coaches(p_limit => 50), 'rk-rmany'), '<', pg_temp.pos(public.search_coaches(p_limit => 50), 'rk-rone'),
  'and the listing follows');
reset role;

-- ============================================================================
-- 4. cold start, no data
-- ============================================================================
select cmp_ok(pg_temp.part('rk-newbie', 'cold_start'), '>', 0::numeric, 'a new, qualified coach gets a boost');
select cmp_ok(pg_temp.part('rk-newbie', 'cold_start'), '<=', 0.06::numeric, '…a small one (at most 0.06)');
select is(pg_temp.part('rk-oldver', 'cold_start'), 0::numeric, 'it fades: none after 45 days');
select is(pg_temp.part('rk-newraw', 'cold_start'), 0::numeric, 'and an unqualified new profile gets none');
select pg_temp.anonymous();
select cmp_ok(pg_temp.pos(public.search_coaches(p_limit => 50), 'rk-newbie'), '<', pg_temp.pos(public.search_coaches(p_limit => 50), 'rk-oldver'),
  'the new coach is seen above an identical older one');
select ok(pg_temp.pos(public.search_coaches(p_limit => 50), 'rk-empty') is not null, 'a coach with no data is listed');
reset role;
select is(pg_temp.part('rk-empty', 'quality'), 0.438::numeric, 'with a neutral quality (no reviews, no outcomes)');
select is(pg_temp.part('rk-empty', 'responsiveness'), 0.7::numeric, 'and a neutral responsiveness (no requests yet)');
select is(pg_temp.part('rk-empty', 'relevance'), null, 'no context, no relevance part');

-- ============================================================================
-- 5. signals: outcomes and responsiveness come from the business tables
-- ============================================================================
insert into public.bookings (client_id, coach_id, service_name, start_at, end_at, timezone, block_start, block_end, status)
select 'ab000000-0000-0000-0000-0000000000c1', cp.user_id, 'PT', now() - interval '3 days', now() - interval '3 days' + interval '1 hour', 'UTC',
       now() - interval '3 days', now() - interval '3 days' + interval '1 hour', 'completed'
from public.coach_profiles cp where cp.slug = 'rk-oldver';
insert into public.coaching_requests (client_id, coach_id, status, created_at)
select 'ab000000-0000-0000-0000-0000000000c1', cp.user_id, 'pending', now() - interval '5 days'
from public.coach_profiles cp, generate_series(1, 1) where cp.slug = 'rk-empty';
select public.coach_rank_signals_refresh();
select is((select completed_bookings from public.coach_rank_signals s join public.coach_profiles cp on cp.id = s.coach_profile_id
            where cp.slug = 'rk-oldver'), 1, 'a completed booking is counted');
select cmp_ok(pg_temp.part('rk-oldver', 'quality'), '>', pg_temp.part('rk-newbie', 'quality'), 'and lifts quality');
select cmp_ok(pg_temp.part('rk-empty', 'responsiveness'), '<', 0.7::numeric, 'a request left unanswered past 48 h lowers responsiveness');

-- popularity saturates: an enormous engagement cannot buy relevance
update public.coach_rank_signals set saves_90d = 100000, views_30d = 100000
 where coach_profile_id = (select id from public.coach_profiles where slug = 'rk-bbtext');
select cmp_ok(pg_temp.part('rk-bbtext', 'engagement'), '<=', 1::numeric, 'engagement is bounded');
select pg_temp.anonymous();
select cmp_ok(pg_temp.pos(public.search_coaches(p_query => 'bodybuilding'), 'rk-bbprim'), '<',
              pg_temp.pos(public.search_coaches(p_query => 'bodybuilding'), 'rk-bbtext'),
  'a hugely popular coach still ranks below the relevant specialist');
reset role;

-- ============================================================================
-- 6. stability and pagination
-- ============================================================================
select pg_temp.anonymous();
select is(pg_temp.slugs(public.search_coaches(p_limit => 50)), pg_temp.slugs(public.search_coaches(p_limit => 50)), 'the same search, the same order');
select is(pg_temp.slugs(public.search_coaches(p_limit => 4, p_offset => 0)) || ',' || pg_temp.slugs(public.search_coaches(p_limit => 4, p_offset => 4))
          || ',' || pg_temp.slugs(public.search_coaches(p_limit => 4, p_offset => 8)) || ',' || pg_temp.slugs(public.search_coaches(p_limit => 4, p_offset => 12)),
          pg_temp.slugs(public.search_coaches(p_limit => 16)),
  'pages are slices of one order: no coach twice, none skipped');
select is((public.search_coaches(p_limit => 4) ->> 'total')::int, 15, 'the total does not depend on the page');

-- ============================================================================
-- 7. transparency stays internal
-- ============================================================================
select ok(not exists (select 1 from jsonb_array_elements(public.search_coaches(p_limit => 50) -> 'items') i
                      where i ?| array['score', 'relevance', 'trust', 'quality', 'signals', 'placement', 'ord']),
  'no score or part on a public card');
reset role;
select ok(not has_function_privilege('anon', 'public.coach_ranked(text, text, text, boolean, boolean, text[], int, int, int, text, boolean, text, boolean, boolean, uuid, boolean, text[], text[], numeric, boolean)', 'execute')
          and not has_function_privilege('authenticated', 'public.coach_ranked(text, text, text, boolean, boolean, text[], int, int, int, text, boolean, text, boolean, boolean, uuid, boolean, text[], text[], numeric, boolean)', 'execute'),
  'the ranking layer is not callable from the app');
select ok(not has_table_privilege('authenticated', 'public.coach_rank_signals', 'select'), 'nor are its signals readable');
select pg_temp.authenticate_as('ab000000-0000-0000-0000-0000000000c1');
select throws_ok($$ select * from public.admin_coach_ranking() $$, '42501', 'ADMIN_ONLY', 'the inspector is admin-only');
reset role;
select pg_temp.authenticate_as('ab000000-0000-0000-0000-0000000000ad');
select is((select count(*)::int from public.admin_coach_ranking(p_query => 'bodybuilding') where placement <> 0), 0,
  'no paid placement: organic only');
select ok((select signals ? 'completed_bookings' from public.admin_coach_ranking(p_query => 'bodybuilding') limit 1),
  'the admin sees the raw signals behind a position');
reset role;

select * from finish();
rollback;
