-- pgTAP · record_login_failure(): anonymous by design, but capped per address
-- and per reported IP so it cannot be used to bury or flood the audit log.
--
-- Run with a local stack up:  npm run db:test

begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

create or replace function pg_temp.anonymous()
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '', true);
end;
$fn$;

select pg_temp.anonymous();
select public.record_login_failure('victim@caps.local', '198.51.100.' || g, 'pgTAP') from generate_series(1, 15) g;
reset role;
select is(
  (select count(*)::int from public.admin_audit_events where action = 'LOGIN_FAILED' and entity_id = 'victim@caps.local'),
  10, 'one address records at most 10 failures per 15 minutes');

select pg_temp.anonymous();
select public.record_login_failure('spray' || g || '@caps.local', '203.0.113.77', 'pgTAP') from generate_series(1, 40) g;
reset role;
select is(
  (select count(*)::int from public.admin_audit_events where action = 'LOGIN_FAILED' and ip = '203.0.113.77'),
  30, 'one reported IP records at most 30 failures a minute');

select pg_temp.anonymous();
select lives_ok($$ select public.record_login_failure('not-an-email', null, null) $$, 'garbage is ignored, not an error');
reset role;
select is(
  (select count(*)::int from public.admin_audit_events where action = 'LOGIN_FAILED' and entity_id = 'not-an-email'),
  0, 'a value without @ is not recorded');

select * from finish();
rollback;
