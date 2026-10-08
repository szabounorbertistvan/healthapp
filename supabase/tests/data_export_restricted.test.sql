-- pgTAP · export_my_restricted_data() (20261113120000): the caller's own rows
-- from the tables they cannot select, never anyone else's, never moderation
-- internals.
--
-- Run with a local stack up:  npm run db:test
-- or without Docker:          node scripts/pgtest/run.mjs data_export_restricted

begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

create or replace function pg_temp.authenticate_as(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$fn$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ee000000-0000-0000-0000-000000000001', 'kai@export.local', '{"full_name":"Kai","username":"kai_export"}'),
  ('ee000000-0000-0000-0000-000000000002', 'sam@export.local', '{"full_name":"Sam","username":"sam_export"}');
select pg_temp.authenticate_as('ee000000-0000-0000-0000-000000000001'); select public.become_coach(); reset role;

insert into public.coach_certifications (coach_profile_id, name, admin_note)
select id, 'Level 2 PT', 'looked fake, asked for a scan' from public.coach_profiles where user_id = 'ee000000-0000-0000-0000-000000000001';
insert into public.barcode_scans (user_id, day, scans) values
  ('ee000000-0000-0000-0000-000000000001', current_date, 3),
  ('ee000000-0000-0000-0000-000000000002', current_date, 9);
insert into public.social_reports (reporter_id, reported_user_id, reason, details) values
  ('ee000000-0000-0000-0000-000000000002', 'ee000000-0000-0000-0000-000000000001', 'spam', 'sells pills');

select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok($$ select public.export_my_restricted_data() $$, '42501', 'NOT_SIGNED_IN', 'nobody signed in, nothing returned');

select pg_temp.authenticate_as('ee000000-0000-0000-0000-000000000001');
create temp table k as select public.export_my_restricted_data() as d;
select is(jsonb_array_length((select d -> 'barcode_scans' from k)), 1, 'the coach gets their own scan day, not Sam''s');
select is((select d -> 'coach_certifications' -> 0 ->> 'name' from k), 'Level 2 PT', 'and their certification');
select ok(not ((select d -> 'coach_certifications' -> 0 from k) ? 'admin_note'), 'without the admin''s note');
select is(jsonb_array_length((select d -> 'social_reports' from k)), 0, 'a report about them is not theirs to receive');

select pg_temp.authenticate_as('ee000000-0000-0000-0000-000000000002');
select is((select public.export_my_restricted_data() -> 'social_reports' -> 0 ->> 'target'), 'user', 'the reporter gets their report and its kind of target');
select ok(not ((select public.export_my_restricted_data() -> 'social_reports' -> 0) ? 'reported_user_id'), 'but not who they reported');

select * from finish();
rollback;
