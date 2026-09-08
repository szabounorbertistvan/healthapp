-- pgTAP · nobody edits their own role; a fresh sign-up may still pick coach/client.
--
-- Run with a local stack up:  npm run db:test

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
  ('b2000000-0000-0000-0000-000000000001', 'fresh@role.local', '{"full_name":"Fresh"}'),
  ('b2000000-0000-0000-0000-000000000002', 'old@role.local',   '{"full_name":"Old"}'),
  ('b2000000-0000-0000-0000-000000000003', 'admin@role.local', '{"full_name":"Admin"}');
update public.users set created_at = now() - interval '1 hour'
  where id = 'b2000000-0000-0000-0000-000000000002';
update public.users set role = 'admin'
  where id = 'b2000000-0000-0000-0000-000000000003';

-- ---------- a fresh sign-up ----------
select pg_temp.authenticate_as('b2000000-0000-0000-0000-000000000001');

select throws_ok(
  $$ update public.users set role = 'admin' where id = 'b2000000-0000-0000-0000-000000000001' $$,
  '42501', null, 'a user cannot update their own role column directly');
select lives_ok(
  $$ update public.users set full_name = 'Fresh Renamed' where id = 'b2000000-0000-0000-0000-000000000001' $$,
  'a user can still update their own profile fields');
select throws_ok(
  $$ select public.claim_signup_role('admin') $$,
  '22023', null, 'claim_signup_role refuses anything but coach/client');
select lives_ok(
  $$ select public.claim_signup_role('coach') $$,
  'a fresh sign-up may claim coach');
select is((select role from public.users where id = 'b2000000-0000-0000-0000-000000000001'),
  'coach'::user_role, '…and becomes a coach');

-- ---------- an account older than the sign-up window ----------
reset role;
select pg_temp.authenticate_as('b2000000-0000-0000-0000-000000000002');
select lives_ok($$ select public.claim_signup_role('coach') $$, 'the call is a no-op, not an error');
select is((select role from public.users where id = 'b2000000-0000-0000-0000-000000000002'),
  'client'::user_role, 'an old account cannot re-pick its role');

-- ---------- an admin cannot be demoted through it ----------
reset role;
update public.users set created_at = now() where id = 'b2000000-0000-0000-0000-000000000003';
select pg_temp.authenticate_as('b2000000-0000-0000-0000-000000000003');
select public.claim_signup_role('client');
select is((select role from public.users where id = 'b2000000-0000-0000-0000-000000000003'),
  'admin'::user_role, 'claim_signup_role never touches an admin row');

select * from finish();
rollback;
