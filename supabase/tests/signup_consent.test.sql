-- pgTAP · consent at sign-up (20261113110000): an email sign-up that carries a
-- consent version is stamped by the trigger; anyone else records it through
-- accept_consent(); nobody writes the columns directly.
--
-- Run with a local stack up:  npm run db:test
-- or without Docker:          node scripts/pgtest/run.mjs signup_consent

begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

create or replace function pg_temp.authenticate_as(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$fn$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('c0000000-0000-0000-0000-000000000001', 'form@consent.local', '{"full_name":"Form","consent_version":"2026-10-08"}'),
  ('c0000000-0000-0000-0000-000000000002', 'google@consent.local', '{"full_name":"Google"}'),
  ('c0000000-0000-0000-0000-000000000003', 'forged@consent.local', '{"full_name":"Forged","consent_version":"yes please"}');

select ok(
  (select health_data_consent_at is not null and terms_accepted_at is not null and consent_version = '2026-10-08'
     from public.users where id = 'c0000000-0000-0000-0000-000000000001'),
  'an email sign-up that ticked both boxes is stamped at creation, with the version');
select ok(
  (select health_data_consent_at is null and terms_accepted_at is null
     from public.users where id = 'c0000000-0000-0000-0000-000000000002'),
  'a sign-up without the metadata (Google) has no consent yet');
select ok(
  (select health_data_consent_at is null from public.users where id = 'c0000000-0000-0000-0000-000000000003'),
  'a malformed version in the metadata records nothing');

select pg_temp.authenticate_as('c0000000-0000-0000-0000-000000000002');
select throws_ok($$ update public.users set health_data_consent_at = now() where id = 'c0000000-0000-0000-0000-000000000002' $$,
  '42501', null, 'the columns cannot be written directly');
select throws_ok($$ select public.accept_consent('latest') $$, '22023', 'BAD_VERSION',
  'accept_consent refuses a version that is not a date');
select lives_ok($$ select public.accept_consent('2026-10-08') $$, 'accept_consent records the signed-in person''s consent');
reset role;
select ok(
  (select health_data_consent_at is not null and consent_version = '2026-10-08'
     from public.users where id = 'c0000000-0000-0000-0000-000000000002'),
  'and the row now carries it');
select ok(
  (select health_data_consent_at is null from public.users where id = 'c0000000-0000-0000-0000-000000000003'),
  'it touched nobody else');

select * from finish();
rollback;
