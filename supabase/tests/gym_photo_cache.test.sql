-- pgTAP · gym photos kept in Cloudinary (20261121120000).
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
  ('a5000000-0000-0000-0000-0000000000a1', 'admin@gp.local', '{"full_name":"Admin","username":"gpadmin"}'),
  ('c5000000-0000-0000-0000-0000000000c1', 'cli@gp.local',   '{"full_name":"Cli","username":"gpcli"}');
update public.users set role = 'admin' where id = 'a5000000-0000-0000-0000-0000000000a1';
insert into public.gyms (name, city, status, photo_name) values
  ('Photo Gym', 'Cluj-Napoca', 'active', 'places/P1/photos/A'),
  ('No Photo Gym', 'Cluj-Napoca', 'active', null);
create temp table g as select id from public.gyms where name = 'Photo Gym';
grant select on g to authenticated;

select pg_temp.authenticate_as('c5000000-0000-0000-0000-0000000000c1');
select throws_ok($$ select public.admin_gym_photo_queue() $$, '42501', null, 'only an admin reads the queue');
select throws_ok($$ select public.admin_set_gym_photo((select id from g), 'https://res.cloudinary.com/x/a.jpg', 'places/P1/photos/A') $$,
  '42501', null, 'only an admin records a photo');

select pg_temp.authenticate_as('a5000000-0000-0000-0000-0000000000a1');
select is((public.admin_gym_photo_queue() ->> 'remaining')::int, 1, 'one gym waits (the one with a Google photo)');
select throws_ok($$ select public.admin_set_gym_photo((select id from g), 'https://evil.example/a.jpg', 'places/P1/photos/A') $$,
  '22023', null, 'only a Cloudinary URL');
select lives_ok($$ select public.admin_set_gym_photo((select id from g), 'https://res.cloudinary.com/demo/image/upload/v1/voinic/gyms/x/photo.jpg', 'places/P1/photos/A') $$,
  'the copy is recorded');
select is((public.admin_gym_photo_queue() ->> 'remaining')::int, 0, 'and the queue is empty');

-- The monthly refresh brings a new Google photo: back in the queue, old picture kept meanwhile.
reset role;
update public.gyms set photo_name = 'places/P1/photos/B' where id = (select id from g);
select pg_temp.authenticate_as('a5000000-0000-0000-0000-0000000000a1');
select is((public.admin_gym_photo_queue() -> 'gyms' -> 0 ->> 'photo_name'), 'places/P1/photos/B', 'a changed photo is queued again');
select lives_ok($$ select public.admin_set_gym_photo((select id from g), 'https://res.cloudinary.com/demo/stale.jpg', 'places/P1/photos/A') $$,
  'a copy of the old photo is not recorded against the new one (no error, no change)');

select * from finish();
rollback;
