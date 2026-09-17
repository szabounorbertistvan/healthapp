-- pgTAP · city/bio are the person's to edit; an unfinished profile may still
-- pick coach/client; deletion hides both new columns.
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
  ('b3000000-0000-0000-0000-000000000001', 'me@extras.local',     '{"full_name":"Me","username":"me_extras"}'),
  ('b3000000-0000-0000-0000-000000000002', 'other@extras.local',  '{"full_name":"Other","username":"other_extras"}'),
  ('b3000000-0000-0000-0000-000000000003', 'google@extras.local', '{"full_name":"Google"}');
-- The Google account is old but never finished its profile (no username).
update public.users set created_at = now() - interval '1 day'
  where id = 'b3000000-0000-0000-0000-000000000003';

-- ---------- editing your own extras ----------
select pg_temp.authenticate_as('b3000000-0000-0000-0000-000000000001');

select lives_ok(
  $$ update public.users set city = 'Cluj-Napoca', bio = 'Lifting since 2019.'
     where id = 'b3000000-0000-0000-0000-000000000001' $$,
  'a user can set their own city and bio');
select throws_ok(
  $$ update public.users set city = repeat('x', 81) where id = 'b3000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'city is capped at 80 characters');
select throws_ok(
  $$ update public.users set bio = repeat('x', 501) where id = 'b3000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'bio is capped at 500 characters');

-- RLS filters the other row out: the write is silently a no-op, not an error.
update public.users set city = 'Nowhere' where id = 'b3000000-0000-0000-0000-000000000002';
select is((select city from public.users where id = 'b3000000-0000-0000-0000-000000000002'),
  null, 'someone else''s city cannot be written');

-- ---------- an unfinished profile may still pick its role ----------
reset role;
select pg_temp.authenticate_as('b3000000-0000-0000-0000-000000000003');
select public.claim_signup_role('coach');
select is((select role from public.users where id = 'b3000000-0000-0000-0000-000000000003'),
  'coach'::user_role, 'an old account without a username may still become a coach');

-- Once the profile is complete the window closes for good.
reset role;
update public.users set username = 'google_done' where id = 'b3000000-0000-0000-0000-000000000003';
select pg_temp.authenticate_as('b3000000-0000-0000-0000-000000000003');
select public.claim_signup_role('client');
select is((select role from public.users where id = 'b3000000-0000-0000-0000-000000000003'),
  'coach'::user_role, '…and cannot re-pick once the profile is complete');

-- ---------- deletion hides the extras too ----------
reset role;
select pg_temp.authenticate_as('b3000000-0000-0000-0000-000000000001');
select public.request_account_deletion();
select is((select city from public.users where id = 'b3000000-0000-0000-0000-000000000001'),
  null, 'requesting deletion blanks the city');
select is((select bio from public.users where id = 'b3000000-0000-0000-0000-000000000001'),
  null, '…and the bio');

select * from finish();
rollback;
