-- pgTAP · food_favorites: owner-only read/write, one star per food, and the
-- active coach does not see a client's shortlist.
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

-- ---------- fixtures ----------
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'coach@ff.local',  '{"full_name":"Coach Alex"}'),
  ('22222222-2222-2222-2222-222222222222', 'maria@ff.local',  '{"full_name":"Maria D."}'),
  ('33333333-3333-3333-3333-333333333333', 'andrei@ff.local', '{"full_name":"Andrei P."}');
update public.users set role = 'coach' where id = '11111111-1111-1111-1111-111111111111';
insert into public.trainer_clients (coach_id, client_id, status, started_at) values
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'active', now());

insert into public.foods (id, source, owner_id, name_en, name_ro, kcal_100g, protein_100g, carbs_100g, fat_100g) values
  ('f0000000-0000-0000-0000-000000000001', 'custom', '22222222-2222-2222-2222-222222222222',
   'Chicken breast, raw', 'Piept de pui, crud', 165, 31, 0, 3.6);

-- ---------- owner ----------
select pg_temp.authenticate_as('22222222-2222-2222-2222-222222222222');
select lives_ok($$
  insert into public.food_favorites (user_id, food_id, food_name, kcal_100g, protein_100g, carbs_100g, fat_100g)
  values ('22222222-2222-2222-2222-222222222222', 'f0000000-0000-0000-0000-000000000001', 'Piept de pui, crud', 165, 31, 0, 3.6)
$$, 'a client stars a food that has a foods row');
select lives_ok($$
  insert into public.food_favorites (user_id, food_id, food_name, kcal_100g)
  values ('22222222-2222-2222-2222-222222222222', null, 'Iaurt grecesc 2%', 73)
$$, 'a client stars a food known only by name');
select is(
  (select count(*)::int from public.food_favorites),
  2, 'the owner sees both of their favourites');

select throws_ok($$
  insert into public.food_favorites (user_id, food_id, food_name, kcal_100g)
  values ('22222222-2222-2222-2222-222222222222', 'f0000000-0000-0000-0000-000000000001', 'Piept de pui, crud', 165)
$$, '23505', null, 'the same foods row cannot be starred twice');
select throws_ok($$
  insert into public.food_favorites (user_id, food_id, food_name, kcal_100g)
  values ('22222222-2222-2222-2222-222222222222', null, 'IAURT GRECESC 2%', 73)
$$, '23505', null, 'the same name cannot be starred twice, regardless of case');

-- ---------- everybody else ----------
select pg_temp.authenticate_as('33333333-3333-3333-3333-333333333333');
select is(
  (select count(*)::int from public.food_favorites),
  0, 'another client sees none of them');
select throws_ok($$
  insert into public.food_favorites (user_id, food_id, food_name, kcal_100g)
  values ('22222222-2222-2222-2222-222222222222', null, 'Planted', 100)
$$, '42501', null, 'nobody can star on someone else''s behalf');

select pg_temp.authenticate_as('11111111-1111-1111-1111-111111111111');
select is(
  (select count(*)::int from public.food_favorites),
  0, 'the active coach does not see the client''s shortlist');

select * from finish();
rollback;
