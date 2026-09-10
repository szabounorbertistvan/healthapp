-- pgTAP · sign-up carries username, sex and birth year; usernames are unique.
--
-- The login form sends the three as user metadata. The trigger must record
-- them, must never fail a sign-up over a taken or malformed username, and the
-- unique index must hold case-insensitively.
--
-- Run with a local stack up:  npm run db:test

begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email, raw_user_meta_data) values
  ('b1000000-0000-0000-0000-000000000001', 'maria@profile.local',
   '{"full_name":"Maria D.","role":"client","username":"maria_d","sex":"female","birth_year":"1994"}'),
  ('b1000000-0000-0000-0000-000000000002', 'maria2@profile.local',
   '{"full_name":"Maria Two","role":"client","username":"MARIA_D","sex":"female","birth_year":"1990"}'),
  ('b1000000-0000-0000-0000-000000000003', 'bad@profile.local',
   '{"full_name":"Bad Name","role":"client","username":"x","sex":"dragon","birth_year":"abcd"}'),
  ('b1000000-0000-0000-0000-000000000004', 'google@profile.local',
   '{"full_name":"From Google"}');

select is((select username from public.users where id = 'b1000000-0000-0000-0000-000000000001'),
  'maria_d', 'username is taken from metadata');
select is((select sex from public.users where id = 'b1000000-0000-0000-0000-000000000001'),
  'female', 'sex is taken from metadata');
select is((select birth_year from public.users where id = 'b1000000-0000-0000-0000-000000000001'),
  1994, 'birth_year is taken from metadata');

select is((select username from public.users where id = 'b1000000-0000-0000-0000-000000000002'),
  'MARIA_D_1', 'a taken username (case-insensitively) gets a numbered variant instead of failing');

select is((select username from public.users where id = 'b1000000-0000-0000-0000-000000000003'),
  null, 'a malformed username is dropped, not rejected');
select is((select sex from public.users where id = 'b1000000-0000-0000-0000-000000000003'),
  null, 'an unknown sex value is dropped');
select is((select birth_year from public.users where id = 'b1000000-0000-0000-0000-000000000003'),
  null, 'a non-numeric birth year is dropped');

select is((select username from public.users where id = 'b1000000-0000-0000-0000-000000000004'),
  null, 'a sign-up without metadata (Google) leaves username empty for the complete-profile step');

-- The availability check sees other people's names.
select is(public.username_available('Maria_D'), false, 'username_available is case-insensitive');

select * from finish();
rollback;
