-- pgTAP · Voinic's starter routines (20261207150000)

begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

create or replace function pg_temp.authenticate_as(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$fn$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('5a000000-0000-0000-0000-00000000000a', 'admin@starter.local', '{"full_name":"Admin","username":"starter_admin"}'),
  ('5a000000-0000-0000-0000-000000000001', 'user@starter.local',  '{"full_name":"User","username":"starter_user"}');
update public.users set role = 'admin' where id = '5a000000-0000-0000-0000-00000000000a';

-- the few library exercises the routines name (the full library is a seed, not a migration)
insert into public.exercises (source, external_id, name_en)
select 'free-exercise-db', x, replace(x, '_', ' ')
  from unnest(array['Barbell_Squat', 'Barbell_Bench_Press_-_Medium_Grip', 'Bent_Over_Barbell_Row', 'Plank',
                    'Romanian_Deadlift', 'Standing_Military_Press', 'Barbell_Deadlift', 'Pullups']) x;

-- 1  not for a non-admin
select pg_temp.authenticate_as('5a000000-0000-0000-0000-000000000001');
select throws_ok($$ select public.admin_create_starter_routines() $$, '42501', null, 'a non-admin cannot create them');

-- 2-5  an admin creates four public, official, featured routines
select pg_temp.authenticate_as('5a000000-0000-0000-0000-00000000000a');
select is(public.admin_create_starter_routines(), 4, 'four routines are created');
reset role;
select is((select count(*)::int from public.programs
            where client_id = '5a000000-0000-0000-0000-00000000000a' and visibility = 'public'
              and is_official and featured_at is not null and status = 'published'), 4,
  'all four are public, published, official and featured');
select ok((select count(*) from public.program_exercises pe
             join public.program_days d on d.id = pe.program_day_id
             join public.programs p on p.id = d.program_id
            where p.client_id = '5a000000-0000-0000-0000-00000000000a') > 0,
  'the routines carry the library exercises that exist');
select is((select pe.measure from public.program_exercises pe join public.exercises e on e.id = pe.exercise_id
            where e.external_id = 'Plank' limit 1), 'time', 'the plank is prescribed in seconds');

-- 6  pressing it again creates nothing
select pg_temp.authenticate_as('5a000000-0000-0000-0000-00000000000a');
select is(public.admin_create_starter_routines(), 0, 'a second call creates nothing new');

-- 7  another user finds them in Discover
select pg_temp.authenticate_as('5a000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.discover_programs(p_featured => true)), 4,
  'another user sees the four on the Featured shelf');

select * from finish();
rollback;
