-- pgTAP · food_daily_totals(): the caller's food_logs summed per day.
--
-- The nutrition trends view reads this rather than raw rows: a year of logs is
-- past PostgREST's 1000-row cap, and a truncated read would silently lower
-- every average. The function sums the macros snapshotted on food_logs — it
-- never re-reads foods — and answers for auth.uid() only.
--
-- Run with a local stack up:  npm run db:test   (or: npm run db:test:offline)

begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

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
  ('a2000000-0000-0000-0000-000000000001', 'eater@food.local', '{"full_name":"Eater"}'),
  ('a2000000-0000-0000-0000-000000000002', 'other@food.local', '{"full_name":"Other"}'),
  ('a2000000-0000-0000-0000-000000000003', 'coach@food.local', '{"full_name":"Coach"}');

update public.users set role = 'coach' where id = 'a2000000-0000-0000-0000-000000000003';
insert into public.trainer_clients (coach_id, client_id, status, started_at) values
  ('a2000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-000000000001', 'active', now());

-- Eater: three entries over two slots on the 20th, one on the 22nd, one long
-- ago. Other: one entry on the 20th.
insert into public.food_logs (user_id, date, slot, food_name, grams, kcal, protein_g, carbs_g, fat_g, client_generated_id) values
  ('a2000000-0000-0000-0000-000000000001', '2026-09-20', 'breakfast', 'Oats',   80, 300.5, 10.2, 54.1, 5.5, 'f2000000-0000-0000-0000-000000000001'),
  ('a2000000-0000-0000-0000-000000000001', '2026-09-20', 'breakfast', 'Milk',  200, 100.0,  6.8,  9.6, 3.0, 'f2000000-0000-0000-0000-000000000002'),
  ('a2000000-0000-0000-0000-000000000001', '2026-09-20', 'lunch',     'Chicken', 200, 330.0, 62.0, 0.0, 7.2, 'f2000000-0000-0000-0000-000000000003'),
  ('a2000000-0000-0000-0000-000000000001', '2026-09-22', 'dinner',    'Rice',  150, 195.0,  4.0, 42.0, 0.4, 'f2000000-0000-0000-0000-000000000004'),
  ('a2000000-0000-0000-0000-000000000001', '2025-01-05', 'snack',     'Apple', 150,  78.0,  0.4, 21.0, 0.3, 'f2000000-0000-0000-0000-000000000005'),
  ('a2000000-0000-0000-0000-000000000002', '2026-09-20', 'lunch',     'Pizza', 300, 800.0, 30.0, 90.0, 35.0, 'f2000000-0000-0000-0000-000000000006');

-- ---------- the eater ----------
select pg_temp.authenticate_as('a2000000-0000-0000-0000-000000000001');

select is((select count(*)::int from public.food_daily_totals(null)), 3,
  'one row per logged day, all time when p_from is null');

select is(
  (select kcal::text || ' ' || protein::text || ' ' || carbs::text || ' ' || fat::text
     from public.food_daily_totals(null) where day = '2026-09-20'),
  '730.5 79.0 63.7 15.7',
  'the day''s snapshotted macros, summed exactly');

select is(
  (select entries || '/' || meals from public.food_daily_totals(null) where day = '2026-09-20'),
  '3/2',
  'entries count rows; meals count distinct slots');

select is(
  (select string_agg(day, ',' order by day) from public.food_daily_totals('2026-09-01')),
  '2026-09-20,2026-09-22',
  'p_from bounds the range and days come back as yyyy-mm-dd');

-- ---------- someone else ----------
select pg_temp.authenticate_as('a2000000-0000-0000-0000-000000000002');

select is(
  (select string_agg(day || ' ' || kcal::text, ',') from public.food_daily_totals(null)),
  '2026-09-20 800.0',
  'another user sees only their own days');

-- ---------- the coach ----------
select pg_temp.authenticate_as('a2000000-0000-0000-0000-000000000003');

select is((select count(*)::int from public.food_daily_totals(null)), 0,
  'a coach gets their own totals, not their client''s');

select is(
  (select count(*)::int from public.food_logs where user_id = 'a2000000-0000-0000-0000-000000000001'),
  5,
  'control: the coach CAN read the client''s logs directly, so the 0 above is the function scoping');

-- ---------- privileges ----------
reset role;

select is(
  (select prosecdef from pg_proc where oid = 'public.food_daily_totals(date)'::regprocedure),
  false,
  'security invoker: RLS on food_logs still applies inside');

select ok(
  not has_function_privilege('anon', 'public.food_daily_totals(date)', 'execute'),
  'anon cannot execute');

select ok(
  has_function_privilege('authenticated', 'public.food_daily_totals(date)', 'execute'),
  'authenticated can execute');

select * from finish();
rollback;
