-- pgTAP · paywall (20260923120000): the switch, the tier a client inherits
-- from a Coach Pro, and the plan limits the database enforces.
--
-- Run with a local stack up:  npm run db:test

begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

create or replace function pg_temp.authenticate_as(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$fn$;

create or replace function pg_temp.as_postgres()
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$fn$;

-- ---------- fixtures ----------
-- pro coach (paid), starter coach (trial over), a client of each, and a solo client.
insert into auth.users (id, email, raw_user_meta_data) values
  ('a1111111-1111-1111-1111-111111111111', 'pro@pw.local',     '{"full_name":"Pro Coach"}'),
  ('a2222222-2222-2222-2222-222222222222', 'starter@pw.local', '{"full_name":"Starter Coach"}'),
  ('b1111111-1111-1111-1111-111111111111', 'propc@pw.local',   '{"full_name":"Client of Pro"}'),
  ('b2222222-2222-2222-2222-222222222222', 'startc@pw.local',  '{"full_name":"Client of Starter"}'),
  ('b3333333-3333-3333-3333-333333333333', 'solo@pw.local',    '{"full_name":"Solo"}');
update public.users set role = 'coach'
  where id in ('a1111111-1111-1111-1111-111111111111', 'a2222222-2222-2222-2222-222222222222');
-- Everyone's signup trial is over; only the pro coach pays.
update public.subscriptions set trial_ends_at = now() - interval '1 day'
  where user_id in ('a1111111-1111-1111-1111-111111111111', 'a2222222-2222-2222-2222-222222222222',
                    'b1111111-1111-1111-1111-111111111111', 'b2222222-2222-2222-2222-222222222222',
                    'b3333333-3333-3333-3333-333333333333');
update public.subscriptions set tier = 'coach_pro', status = 'active'
  where user_id = 'a1111111-1111-1111-1111-111111111111';
insert into public.trainer_clients (coach_id, client_id, status, started_at) values
  ('a1111111-1111-1111-1111-111111111111', 'b1111111-1111-1111-1111-111111111111', 'active', now()),
  ('a2222222-2222-2222-2222-222222222222', 'b2222222-2222-2222-2222-222222222222', 'active', now());

-- ---------- tiers ----------
select is(public.effective_tier('a2222222-2222-2222-2222-222222222222'), 'coach_free',
  'a coach whose trial ended is Coach Starter, not the client free tier');
select is(public.effective_tier('b1111111-1111-1111-1111-111111111111'), 'premium',
  'a client of a paying Coach Pro gets Premium');
select is(public.own_tier('b1111111-1111-1111-1111-111111111111'), 'free',
  '...through the coach: their own tier is still free');
select is(public.effective_tier('b2222222-2222-2222-2222-222222222222'), 'free',
  'a client of a Starter coach stays free');

-- ---------- switch off: nothing is limited ----------
select pg_temp.authenticate_as('b3333333-3333-3333-3333-333333333333');
insert into public.programs (coach_id, client_id, name) values (null, 'b3333333-3333-3333-3333-333333333333', 'One');
select lives_ok($$
  insert into public.programs (coach_id, client_id, name) values (null, 'b3333333-3333-3333-3333-333333333333', 'Two')
$$, 'with the paywall off a free client builds a second program');
select is((select paywall from public.my_plan), false, 'my_plan reports the paywall off');

-- ---------- switch on for two preview users ----------
select pg_temp.as_postgres();
update public.app_flags
  set preview_users = array['b3333333-3333-3333-3333-333333333333', 'b1111111-1111-1111-1111-111111111111']::uuid[]
  where key = 'paywall';

select pg_temp.authenticate_as('b3333333-3333-3333-3333-333333333333');
select is((select count(*)::int from public.my_plan), 1, 'my_plan is one row: your own');
select is((select paywall from public.my_plan), true, '...and a preview user sees the paywall on');
select throws_ok($$
  insert into public.programs (coach_id, client_id, name) values (null, 'b3333333-3333-3333-3333-333333333333', 'Three')
$$, 'P0001', 'PLAN_LIMIT_REACHED', 'free: past one own program is refused');

insert into public.exercises (owner_id, source, name_en) values
  ('b3333333-3333-3333-3333-333333333333', 'custom', 'A'),
  ('b3333333-3333-3333-3333-333333333333', 'custom', 'B'),
  ('b3333333-3333-3333-3333-333333333333', 'custom', 'C');
select throws_ok($$
  insert into public.exercises (owner_id, source, name_en) values ('b3333333-3333-3333-3333-333333333333', 'custom', 'D')
$$, 'P0001', 'PLAN_LIMIT_REACHED', 'free: a fourth custom exercise is refused');

insert into public.food_favorites (user_id, food_name, kcal_100g)
  select 'b3333333-3333-3333-3333-333333333333', 'Food ' || g, 100 from generate_series(1, 10) g;
select throws_ok($$
  insert into public.food_favorites (user_id, food_name, kcal_100g) values ('b3333333-3333-3333-3333-333333333333', 'Food 11', 100)
$$, 'P0001', 'PLAN_LIMIT_REACHED', 'free: an eleventh favourite is refused');

select is(public.claim_barcode_scan(), 4, 'the first scan of the day leaves four');
select public.claim_barcode_scan(), public.claim_barcode_scan(), public.claim_barcode_scan(), public.claim_barcode_scan();
select throws_ok($$ select public.claim_barcode_scan() $$, 'P0001', 'PLAN_LIMIT_REACHED',
  'free: the sixth scan of the day is refused');

select throws_ok($$ select * from public.app_flags $$, '42501', null,
  'nobody reads the switch table directly');

-- The client of a Pro coach is a preview user too, and inherits Premium: unlimited.
-- (A coached client builds no own programs at all — programs_solo_insert — so
-- the inherited tier is shown on custom exercises.)
select pg_temp.authenticate_as('b1111111-1111-1111-1111-111111111111');
insert into public.exercises (owner_id, source, name_en)
  select 'b1111111-1111-1111-1111-111111111111', 'custom', 'Ex ' || g from generate_series(1, 3) g;
select lives_ok($$
  insert into public.exercises (owner_id, source, name_en) values ('b1111111-1111-1111-1111-111111111111', 'custom', 'Ex 4')
$$, 'Premium through the coach: no cap on custom exercises');
select is(public.claim_barcode_scan(), null::int, 'Premium through the coach: scans are unlimited');

-- A coach writing a client's program is never "own" and never counted.
select pg_temp.authenticate_as('a1111111-1111-1111-1111-111111111111');
select lives_ok($$
  insert into public.programs (coach_id, client_id, name) values ('a1111111-1111-1111-1111-111111111111', 'b1111111-1111-1111-1111-111111111111', 'From coach')
$$, 'a coach''s program for a client is outside the own-program cap');

select * from finish();
rollback;
