-- pgTAP · goal plan limit (20261128100000): with the paywall on, a free
-- account holds 2 active measurable goals, Premium more; the setup step's
-- main goal is never counted; editing an active goal is never refused.
--
-- Run with a local stack up:  npm run db:test

begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

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

insert into auth.users (id, email, raw_user_meta_data) values
  ('c7000000-0000-0000-0000-000000000001', 'free@gl.local', '{"full_name":"Free"}'),
  ('c7000000-0000-0000-0000-000000000002', 'paid@gl.local', '{"full_name":"Paid"}');
update public.subscriptions set trial_ends_at = now() - interval '1 day'
  where user_id in ('c7000000-0000-0000-0000-000000000001', 'c7000000-0000-0000-0000-000000000002');
update public.subscriptions set tier = 'premium', status = 'active'
  where user_id = 'c7000000-0000-0000-0000-000000000002';

-- ---------- switch off: nothing limited ----------
select pg_temp.authenticate_as('c7000000-0000-0000-0000-000000000001');
insert into public.goals (user_id, type, title, metric, direction, target_value) values
  ('c7000000-0000-0000-0000-000000000001', 'weight', 'w', 'body_weight', 'decrease', 70),
  ('c7000000-0000-0000-0000-000000000001', 'habit', 'h', 'weekly_workouts', 'increase', 4);
select lives_ok($$
  insert into public.goals (user_id, type, title, metric, direction, target_value)
  values ('c7000000-0000-0000-0000-000000000001', 'habit', 'c', 'consistency', 'increase', 80)
$$, 'with the paywall off a free account starts a third goal');

-- ---------- switch on for both ----------
select pg_temp.as_postgres();
update public.app_flags
  set preview_users = array['c7000000-0000-0000-0000-000000000001', 'c7000000-0000-0000-0000-000000000002']::uuid[]
  where key = 'paywall';
delete from public.goals where user_id = 'c7000000-0000-0000-0000-000000000001' and metric = 'consistency';

select pg_temp.authenticate_as('c7000000-0000-0000-0000-000000000001');
select throws_ok($$
  insert into public.goals (user_id, type, title, metric, direction, target_value)
  values ('c7000000-0000-0000-0000-000000000001', 'habit', 'c', 'consistency', 'increase', 80)
$$, 'P0001', 'PLAN_LIMIT_REACHED', 'free: a third active goal is refused');
select lives_ok($$
  insert into public.goals (user_id, type, title) values ('c7000000-0000-0000-0000-000000000001', 'other', 'Fat loss')
$$, 'the setup step''s main goal (no metric) is never counted');
select lives_ok($$
  update public.goals set target_value = 68
  where user_id = 'c7000000-0000-0000-0000-000000000001' and metric = 'body_weight'
$$, 'editing an active goal is never refused');

-- closing one frees a slot
update public.goals set status = 'abandoned', closed_at = now()
  where user_id = 'c7000000-0000-0000-0000-000000000001' and metric = 'weekly_workouts';
select lives_ok($$
  insert into public.goals (user_id, type, title, metric, direction, target_value)
  values ('c7000000-0000-0000-0000-000000000001', 'habit', 'c', 'consistency', 'increase', 80)
$$, 'closing a goal frees its slot');
select throws_ok($$
  update public.goals set status = 'active', closed_at = null
  where user_id = 'c7000000-0000-0000-0000-000000000001' and metric = 'weekly_workouts'
$$, 'P0001', 'PLAN_LIMIT_REACHED', 'reactivating a closed goal past the limit is refused');

-- ---------- premium ----------
select pg_temp.authenticate_as('c7000000-0000-0000-0000-000000000002');
insert into public.goals (user_id, type, title, metric, direction, target_value) values
  ('c7000000-0000-0000-0000-000000000002', 'weight', 'w', 'body_weight', 'decrease', 70),
  ('c7000000-0000-0000-0000-000000000002', 'habit', 'h', 'weekly_workouts', 'increase', 4);
select lives_ok($$
  insert into public.goals (user_id, type, title, metric, direction, target_value)
  values ('c7000000-0000-0000-0000-000000000002', 'habit', 'c', 'consistency', 'increase', 80)
$$, 'premium: a third active goal is fine');

select pg_temp.as_postgres();
select is(public.plan_limit('free', 'active_goals'), 2, 'plan_limit: free holds 2');
select is(public.plan_limit('premium', 'active_goals'), null, 'plan_limit: premium is unlimited (the 12 cap is goals_guard''s)');

select * from finish();
rollback;
