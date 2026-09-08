-- pgTAP · the sign-up trigger takes the role the user picked, and nothing more.
--
-- raw_user_meta_data is whatever the browser sent with signUp(). The trigger
-- must honour 'coach' / 'client' and refuse everything else, or a sign-up
-- request could mint an admin.
--
-- Run with a local stack up:  npm run db:test

begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (id, email, raw_user_meta_data) values
  ('a1000000-0000-0000-0000-000000000001', 'coach@signup.local',  '{"full_name":"Coach C","role":"coach"}'),
  ('a1000000-0000-0000-0000-000000000002', 'client@signup.local', '{"full_name":"Client C","role":"client"}'),
  ('a1000000-0000-0000-0000-000000000003', 'admin@signup.local',  '{"full_name":"Sneaky","role":"admin"}'),
  ('a1000000-0000-0000-0000-000000000004', 'none@signup.local',   '{"full_name":"No Role"}'),
  ('a1000000-0000-0000-0000-000000000005', 'blank@signup.local',  '{"full_name":"   ","role":"coach"}');

select is((select role from public.users where id = 'a1000000-0000-0000-0000-000000000001'),
  'coach'::user_role, 'role=coach in metadata creates a coach');
select is((select role from public.users where id = 'a1000000-0000-0000-0000-000000000002'),
  'client'::user_role, 'role=client in metadata creates a client');
select is((select role from public.users where id = 'a1000000-0000-0000-0000-000000000003'),
  'client'::user_role, 'role=admin in metadata is ignored — falls back to client');
select is((select role from public.users where id = 'a1000000-0000-0000-0000-000000000004'),
  'client'::user_role, 'no role in metadata defaults to client');
select is((select full_name from public.users where id = 'a1000000-0000-0000-0000-000000000001'),
  'Coach C', 'full_name is taken from metadata');
select is((select full_name from public.users where id = 'a1000000-0000-0000-0000-000000000005'),
  'blank@signup.local', 'a blank full_name falls back to the email');

select * from finish();
rollback;
