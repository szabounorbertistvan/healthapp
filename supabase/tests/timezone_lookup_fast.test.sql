-- pgTAP · booking_timezone_valid() answers from timezone_names (20261113130000)
-- exactly as it did from pg_timezone_names, and the copy stays private.
--
-- Run with a local stack up:  npm run db:test
-- or without Docker:          node scripts/pgtest/run.mjs timezone_lookup_fast

begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

select ok((select count(*) from public.timezone_names) = (select count(*) from pg_catalog.pg_timezone_names),
  'every zone the catalog knows is copied');
select ok(public.booking_timezone_valid('Europe/Bucharest'), 'an IANA zone is valid');
select ok(public.booking_timezone_valid('UTC'), 'UTC is valid');
select ok(not public.booking_timezone_valid('Mars/Olympus_Mons'), 'an unknown zone is not');
select ok(not public.booking_timezone_valid(null), 'no zone is not');

-- a zone missing from the copy (as after a Postgres upgrade) is still valid, via the catalog
delete from public.timezone_names where name = 'Europe/Bucharest';
select ok(public.booking_timezone_valid('Europe/Bucharest'), 'a zone missing from the copy falls back to the catalog');

select set_config('role', 'authenticated', true);
select throws_ok($$ select count(*) from public.timezone_names $$, '42501', null, 'the copy is not readable directly');

select * from finish();
rollback;
