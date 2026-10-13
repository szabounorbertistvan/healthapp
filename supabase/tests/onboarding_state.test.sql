-- pgTAP · onboarding state (20261123100000_onboarding_state): one row per
-- person, readable by its owner only, written only through onboarding_mark().
--
-- Run with a local stack up:  npm run db:test
-- or without Docker:          node scripts/pgtest/run.mjs onboarding_state

begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

create or replace function pg_temp.authenticate_as(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$fn$;

create or replace function pg_temp.as_postgres()
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$fn$;

-- ---------- fixtures: two people who signed up after the migration ----------
insert into auth.users (id, email, raw_user_meta_data) values
  ('0b000000-0000-0000-0000-000000000001', 'ob-ana@test.local',  '{}'),
  ('0b000000-0000-0000-0000-000000000002', 'ob-ion@test.local',  '{}');
update public.users set role = 'coach' where id = '0b000000-0000-0000-0000-000000000002';

-- ---------- a new account has no state at all ----------
select is((select count(*)::int from public.onboarding_state
            where user_id = '0b000000-0000-0000-0000-000000000001'), 0,
  'a new account starts with no onboarding row (sees the welcome cards)');

-- ---------- marking ----------
select pg_temp.authenticate_as('0b000000-0000-0000-0000-000000000001');
select is(public.onboarding_mark('welcome', 'done'), '{"welcome":"done"}'::jsonb,
  'the first mark creates the row and returns the map');
select is(public.onboarding_mark('step:goal', 'skipped'), '{"welcome":"done","step:goal":"skipped"}'::jsonb,
  'a second key merges into the map');
select is(public.onboarding_mark('step:goal', 'done') ->> 'step:goal', 'done',
  'marking a skipped step done later overwrites the mark (resume)');
select is(public.onboarding_mark('tour:today', 'dismissed') ->> 'tour:today', 'dismissed',
  'a tour can be marked dismissed');
select is(public.onboarding_mark('tips', 'dismissed') ->> 'tips', 'dismissed',
  'automatic tips can be switched off');
select ok(not (public.onboarding_mark('tour:today', 'reset') ? 'tour:today'),
  'reset removes one key');
select is((select state from public.onboarding_state),
  '{"welcome":"done","step:goal":"done","tips":"dismissed"}'::jsonb,
  'the owner reads their own row back (state survives a new session)');

-- ---------- what the function refuses ----------
select throws_ok($$ select public.onboarding_mark('role', 'done') $$, '22023', 'ONBOARDING_KEY',
  'an unknown key is refused');
select throws_ok($$ select public.onboarding_mark('tour:Today!', 'done') $$, '22023', 'ONBOARDING_KEY',
  'a tour id outside [a-z_] is refused');
select throws_ok($$ select public.onboarding_mark('step:' || repeat('a', 33), 'done') $$, '22023', 'ONBOARDING_KEY',
  'an over-long id is refused');
select throws_ok($$ select public.onboarding_mark('welcome', 'admin') $$, '22023', 'ONBOARDING_MARK',
  'an unknown mark is refused');
select throws_ok($$ select public.onboarding_mark(null, 'done') $$, '22023', 'ONBOARDING_KEY',
  'a null key is refused');

-- ---------- no direct writes ----------
select throws_ok($$ insert into public.onboarding_state (user_id, state) values ('0b000000-0000-0000-0000-000000000001', '{}') $$,
  '42501', null, 'no direct insert');
select throws_ok($$ update public.onboarding_state set state = '{}' $$,
  '42501', null, 'no direct update');
select throws_ok($$ delete from public.onboarding_state $$,
  '42501', null, 'no direct delete');

-- ---------- nobody else reads it ----------
select pg_temp.authenticate_as('0b000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.onboarding_state), 0,
  'another account sees no one else''s row');
select is(public.onboarding_mark('welcome', 'skipped'), '{"welcome":"skipped"}'::jsonb,
  'the second account marks only its own row');
select is((select count(*)::int from public.onboarding_state), 1,
  'and reads exactly that one row');

select pg_temp.as_postgres();
select set_config('role', 'anon', true);
select throws_ok($$ select public.onboarding_mark('welcome', 'done') $$, '42501', null,
  'anon cannot call onboarding_mark');
select throws_ok($$ select count(*) from public.onboarding_state $$, '42501', null,
  'anon cannot read the table');

-- ---------- the first account's row is untouched by the second ----------
select pg_temp.as_postgres();
select is((select state ->> 'welcome' from public.onboarding_state where user_id = '0b000000-0000-0000-0000-000000000001'),
  'done', 'one account''s marks never touch another''s');

select * from finish();
rollback;
