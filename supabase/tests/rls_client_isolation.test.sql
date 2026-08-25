-- pgTAP · the invariant the whole permission model rests on.
--
-- Plan §6: "Every policy goes through one helper — is_active_coach_of(client_id)
-- — a single point of truth, tested with pgTAP in CI." PRODUCT_SPEC §11 makes it
-- a launch gate: "pgTAP green: no cross-client access; ended-coach access removed."
--
-- Run with a local stack up:  npm run db:test

begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

-- Acting as a signed-in user means two things: the `authenticated` role (so RLS
-- applies at all — postgres bypasses it) and a JWT claim, which is where
-- auth.uid() reads the user id from.
create or replace function pg_temp.authenticate_as(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$fn$;

-- ---------- fixtures ----------
-- public.users rows are created by the on_auth_user_created trigger.
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'coach@test.local',  '{"full_name":"Coach Alex"}'),
  ('22222222-2222-2222-2222-222222222222', 'maria@test.local',  '{"full_name":"Maria D."}'),
  ('33333333-3333-3333-3333-333333333333', 'andrei@test.local', '{"full_name":"Andrei P."}'),
  ('44444444-4444-4444-4444-444444444444', 'other@test.local',  '{"full_name":"Other Coach"}');

update public.users set role = 'coach'
where id in ('11111111-1111-1111-1111-111111111111',
             '44444444-4444-4444-4444-444444444444');

-- Alex actively coaches Maria; nobody coaches Andrei.
insert into public.trainer_clients (coach_id, client_id, status, started_at) values
  ('11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222', 'active', now());

insert into public.measurements (user_id, date, weight_kg) values
  ('22222222-2222-2222-2222-222222222222', current_date, 67.4),
  ('33333333-3333-3333-3333-333333333333', current_date, 81.6);

-- ---------- the client owns their data ----------
select pg_temp.authenticate_as('22222222-2222-2222-2222-222222222222');
select is(
  (select count(*)::int from public.measurements),
  1,
  'a client sees exactly their own measurements'
);

-- ---------- the active coach may read it ----------
select pg_temp.authenticate_as('11111111-1111-1111-1111-111111111111');
select is(
  (select count(*)::int from public.measurements),
  1,
  'an active coach reads their client''s measurements'
);
select is(
  (select user_id from public.measurements),
  '22222222-2222-2222-2222-222222222222'::uuid,
  'and only that client''s — not every client in the table'
);

-- ---------- an unrelated coach may not ----------
select pg_temp.authenticate_as('44444444-4444-4444-4444-444444444444');
select is(
  (select count(*)::int from public.measurements),
  0,
  'a coach with no relationship reads nothing'
);

-- ---------- a client may not read another client ----------
select pg_temp.authenticate_as('33333333-3333-3333-3333-333333333333');
select is(
  (select count(*)::int from public.measurements
   where user_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'one client cannot read another client''s measurements'
);

-- ---------- ending the relationship removes access ----------
reset role;
update public.trainer_clients set status = 'ended', ended_at = now()
where coach_id = '11111111-1111-1111-1111-111111111111';

select pg_temp.authenticate_as('11111111-1111-1111-1111-111111111111');
select is(
  (select count(*)::int from public.measurements),
  0,
  'an ended coach loses access to the client''s data'
);

select * from finish();
rollback;
