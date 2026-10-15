-- pgTAP · client_food_daily_totals(): a client's day totals, for their coach.
--
-- The coach's client page folds the client's nutrition goals from these. The
-- function sums the same snapshotted macros food_daily_totals() does, and
-- answers only while the caller is the client's ACTIVE coach.
--
-- Run with a local stack up:  npm run db:test   (or: npm run db:test:offline client_food_daily_totals)

begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

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
  ('a3000000-0000-0000-0000-000000000001', 'cft-client@food.local',   '{"full_name":"Client"}'),
  ('a3000000-0000-0000-0000-000000000002', 'cft-other@food.local',    '{"full_name":"Other"}'),
  ('a3000000-0000-0000-0000-000000000003', 'cft-coach@food.local',    '{"full_name":"Coach"}'),
  ('a3000000-0000-0000-0000-000000000004', 'cft-stranger@food.local', '{"full_name":"Stranger"}');

update public.users set role = 'coach'
  where id in ('a3000000-0000-0000-0000-000000000003', 'a3000000-0000-0000-0000-000000000004');
insert into public.trainer_clients (id, coach_id, client_id, status, started_at) values
  ('a3000000-0000-0000-0000-0000000000a1', 'a3000000-0000-0000-0000-000000000003', 'a3000000-0000-0000-0000-000000000001', 'active', now());

insert into public.food_logs (user_id, date, slot, food_name, grams, kcal, protein_g, carbs_g, fat_g, client_generated_id) values
  ('a3000000-0000-0000-0000-000000000001', '2026-09-20', 'breakfast', 'Oats',    80, 300.5, 10.2, 54.1, 5.5, 'f3000000-0000-0000-0000-000000000001'),
  ('a3000000-0000-0000-0000-000000000001', '2026-09-20', 'lunch',     'Chicken', 200, 330.0, 62.0, 0.0, 7.2, 'f3000000-0000-0000-0000-000000000002'),
  ('a3000000-0000-0000-0000-000000000001', '2026-09-22', 'dinner',    'Rice',   150, 195.0,  4.0, 42.0, 0.4, 'f3000000-0000-0000-0000-000000000003'),
  ('a3000000-0000-0000-0000-000000000002', '2026-09-20', 'lunch',     'Pizza',  300, 800.0, 30.0, 90.0, 35.0, 'f3000000-0000-0000-0000-000000000004');

-- ---------- the active coach ----------
select pg_temp.authenticate_as('a3000000-0000-0000-0000-000000000003');

select is(
  (select string_agg(day || ' ' || kcal::text || ' ' || protein::text, ',' order by day)
     from public.client_food_daily_totals('a3000000-0000-0000-0000-000000000001', null)),
  '2026-09-20 630.5 72.2,2026-09-22 195.0 4.0',
  'the active coach gets the client''s days, summed exactly');

select is(
  (select entries || '/' || meals from public.client_food_daily_totals('a3000000-0000-0000-0000-000000000001', null) where day = '2026-09-20'),
  '2/2',
  'entries count rows; meals count distinct slots');

select is(
  (select string_agg(day, ',') from public.client_food_daily_totals('a3000000-0000-0000-0000-000000000001', '2026-09-21')),
  '2026-09-22',
  'p_from bounds the range');

select is((select count(*)::int from public.client_food_daily_totals('a3000000-0000-0000-0000-000000000002', null)), 0,
  'not someone who is not their client');

-- ---------- a coach of nobody here ----------
select pg_temp.authenticate_as('a3000000-0000-0000-0000-000000000004');
select is((select count(*)::int from public.client_food_daily_totals('a3000000-0000-0000-0000-000000000001', null)), 0,
  'a stranger coach gets nothing');

-- ---------- the client themself ----------
select pg_temp.authenticate_as('a3000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.client_food_daily_totals('a3000000-0000-0000-0000-000000000001', null)), 0,
  'the client gets nothing through the coach door (their own is food_daily_totals)');

-- ---------- after the coaching ends ----------
select pg_temp.authenticate_as('a3000000-0000-0000-0000-000000000003');
select is(public.coaching_transition('a3000000-0000-0000-0000-0000000000a1', 'ended'), 'ended', 'the coach ends the coaching');
select is((select count(*)::int from public.client_food_daily_totals('a3000000-0000-0000-0000-000000000001', null)), 0,
  'a former coach gets nothing');

-- ---------- privileges ----------
reset role;

select is(
  (select prosecdef from pg_proc where oid = 'public.client_food_daily_totals(uuid, date)'::regprocedure),
  false,
  'security invoker: food_logs_coach_read still applies inside');

select ok(
  not has_function_privilege('anon', 'public.client_food_daily_totals(uuid, date)', 'execute'),
  'anon cannot execute');

select ok(
  has_function_privilege('authenticated', 'public.client_food_daily_totals(uuid, date)', 'execute'),
  'authenticated can execute');

select * from finish();
rollback;
