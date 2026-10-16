-- pgTAP · opt-in trial (20261129100000): no trial at sign-up; start_trial()
-- opens 30 days once, only while the paywall applies and only for someone on
-- a free tier; a stored trial_ends_at nobody started does not count.
--
-- Run with a local stack up:  npm run db:test

begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

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

insert into auth.users (id, email, raw_user_meta_data) values
  ('c9000000-0000-0000-0000-000000000001', 'client@to.local', '{"full_name":"Client"}'),
  ('c9000000-0000-0000-0000-000000000002', 'coach@to.local',  '{"full_name":"Coach"}'),
  ('c9000000-0000-0000-0000-000000000003', 'paid@to.local',   '{"full_name":"Paid"}'),
  ('c9000000-0000-0000-0000-000000000004', 'legacy@to.local', '{"full_name":"Legacy"}');
update public.users set role = 'coach' where id = 'c9000000-0000-0000-0000-000000000002';
update public.subscriptions set tier = 'premium', status = 'active' where user_id = 'c9000000-0000-0000-0000-000000000003';
-- what the old sign-up trigger left behind: an end date nobody chose
update public.subscriptions set trial_ends_at = now() + interval '20 days' where user_id = 'c9000000-0000-0000-0000-000000000004';
update public.app_flags set enabled = false, preview_users = '{}' where key = 'paywall';

-- ---------- sign-up ----------
select is((select trial_ends_at from public.subscriptions where user_id = 'c9000000-0000-0000-0000-000000000001'), null,
  'a new account has no trial');
select is(public.own_tier('c9000000-0000-0000-0000-000000000004'), 'free',
  'a stored sign-up trial nobody started does not count');

-- ---------- paywall off: nothing to try ----------
select pg_temp.authenticate_as('c9000000-0000-0000-0000-000000000001');
select is((select trial_available from public.my_plan), false, 'paywall off: no trial offered');
select throws_ok($$ select public.start_trial() $$, '22023', 'TRIAL_NOT_OPEN', 'paywall off: start_trial refuses');

-- ---------- paywall on (preview) ----------
select pg_temp.as_postgres();
update public.app_flags set preview_users = array[
  'c9000000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000002',
  'c9000000-0000-0000-0000-000000000003', 'c9000000-0000-0000-0000-000000000004']::uuid[] where key = 'paywall';

select pg_temp.authenticate_as('c9000000-0000-0000-0000-000000000001');
select is((select trial_available from public.my_plan), true, 'paywall on, free, never tried: the trial is offered');
select is((select trial_ends_at from public.my_plan), null, '...and no trial end is shown yet');
-- once into a temp table: BETWEEN would evaluate the call twice
create temp table started on commit drop as select public.start_trial() as ends;
select ok((select ends from started) between now() + interval '29 days' and now() + interval '31 days',
  'start_trial opens 30 days');
select is((select tier from public.my_plan), 'premium', 'a client on trial is Premium');
select is((select trial_available from public.my_plan), false, '...and is not offered a second trial');
select throws_ok($$ select public.start_trial() $$, '22023', 'TRIAL_NOT_NEEDED', 'pressing again while on trial is refused');

select pg_temp.authenticate_as('c9000000-0000-0000-0000-000000000002');
select lives_ok($$ select public.start_trial() $$, 'a coach starts a trial');
select is((select tier from public.my_plan), 'coach_pro', 'a coach on trial is Coach Pro');

select pg_temp.authenticate_as('c9000000-0000-0000-0000-000000000003');
select throws_ok($$ select public.start_trial() $$, '22023', 'TRIAL_NOT_NEEDED', 'a paying account is not offered a trial');

select pg_temp.authenticate_as('c9000000-0000-0000-0000-000000000004');
select is((select tier from public.my_plan), 'free', 'the legacy end date gives nothing with the paywall on');
select is((select trial_available from public.my_plan), true, '...and the person still has their one trial');

-- ---------- after the 30 days ----------
select pg_temp.as_postgres();
update public.subscriptions set trial_ends_at = now() - interval '1 day' where user_id = 'c9000000-0000-0000-0000-000000000001';
select pg_temp.authenticate_as('c9000000-0000-0000-0000-000000000001');
select throws_ok($$ select public.start_trial() $$, '22023', 'TRIAL_USED', 'a trial that ran out is not a second one');

select pg_temp.as_postgres();
select ok(not has_function_privilege('anon', 'public.start_trial()', 'execute'), 'anon cannot start a trial');

select * from finish();
rollback;
