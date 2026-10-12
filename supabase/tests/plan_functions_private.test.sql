-- pgTAP · Plan functions answer only about the caller (20261120110000)
--
-- own_tier / effective_tier / paywall_on / user_plan_limit told anyone — anon
-- included — another user's tier, preview status and whether they have a
-- paying coach. Now: not callable by anon or a signed-in user; my_plan still
-- gives the caller their own plan; the definer paths that need the tier
-- (the plan-limit trigger, create_invite) still work; program_usage needs a
-- session.
--
-- Run with a local stack up:  npm run db:test
-- or without Docker:          node scripts/pgtest/run.mjs plan_functions_private

begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

create or replace function pg_temp.authenticate_as(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$fn$;

-- a paying coach (pf..01) and their client (pf..02); a stranger (pf..03)
insert into auth.users (id, email, raw_user_meta_data) values
  ('f1000000-0000-0000-0000-000000000001', 'coach@pf.local', '{"full_name":"Coach","username":"pf_coach"}'),
  ('f1000000-0000-0000-0000-000000000002', 'client@pf.local', '{"full_name":"Client","username":"pf_client"}'),
  ('f1000000-0000-0000-0000-000000000003', 'stranger@pf.local', '{"full_name":"Stranger","username":"pf_stranger"}');
update public.users set role = 'coach' where id = 'f1000000-0000-0000-0000-000000000001';
insert into public.subscriptions (user_id, tier, status) values ('f1000000-0000-0000-0000-000000000001', 'coach_pro', 'active')
on conflict (user_id) do update set tier = 'coach_pro', status = 'active';
insert into public.trainer_clients (coach_id, client_id, status, started_at)
values ('f1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000002', 'active', now());

-- the owner of the tables still computes the truth; kept to compare with what each user reads
create temp table truth as select u.id, public.own_tier(u.id) as own from public.users u where u.id::text like 'f1000000-%';
grant select on truth to authenticated;
select is(public.effective_tier('f1000000-0000-0000-0000-000000000002'), 'premium', 'the client of a Coach Pro coach is premium');

select set_config('role', 'anon', true);
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$ select public.own_tier('f1000000-0000-0000-0000-000000000001') $$, '42501', null, 'anonymous: no one''s tier');
select throws_ok($$ select public.effective_tier('f1000000-0000-0000-0000-000000000002') $$, '42501', null, 'anonymous: no coaching relationship');
select throws_ok($$ select public.paywall_on('f1000000-0000-0000-0000-000000000002') $$, '42501', null, 'anonymous: no preview flag');
select throws_ok($$ select public.user_plan_limit('f1000000-0000-0000-0000-000000000002', 'own_programs') $$, '42501', null,
  'anonymous: no plan limit');
select throws_ok($$ select * from public.program_usage(gen_random_uuid()) $$, '42501', null, 'anonymous: no program usage');
reset role;

select pg_temp.authenticate_as('f1000000-0000-0000-0000-000000000003');
select throws_ok($$ select public.effective_tier('f1000000-0000-0000-0000-000000000002') $$, '42501', null,
  'a signed-in stranger cannot learn someone''s tier either');
select throws_ok($$ select public.own_tier('f1000000-0000-0000-0000-000000000001') $$, '42501', null, '… nor their role');
select is((select count(*)::int from public.my_plan), 1, 'my_plan: exactly one row, the caller''s');
select is((select user_id from public.my_plan), 'f1000000-0000-0000-0000-000000000003'::uuid, '… their own');
reset role;
select pg_temp.authenticate_as('f1000000-0000-0000-0000-000000000002');
select is((select tier from public.my_plan), 'premium', 'the client still sees their own premium plan through my_plan');
select is((select own_tier from public.my_plan), (select own from truth where id = auth.uid()), '… and their own tier, as the database computes it');
select lives_ok($$ select * from public.program_usage(gen_random_uuid()) $$, 'program usage still answers a signed-in user');
reset role;
select pg_temp.authenticate_as('f1000000-0000-0000-0000-000000000001');
select lives_ok($$ select public.create_invite() $$, 'create_invite (a definer path that reads the tier) still works');
select is((select tier from public.my_plan), 'coach_pro', 'the coach reads their own plan');
reset role;

select * from finish();
rollback;
