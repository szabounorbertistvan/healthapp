-- pgTAP · the rest-push tick sleeps while nobody is resting (20261210100000):
-- a pending rest wakes rest-push-tick, a tick with nothing pending puts it to
-- sleep, and nobody but the database can flip it.
--
-- Run with a local stack up:  npm run db:test
-- Without pg_cron (scripts/pgtest) a minimal cron.job / cron.alter_job stands
-- in for it, inside this transaction.

begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

do $$
begin
  if to_regclass('cron.job') is null then
    create schema cron;
    create table cron.job (jobid bigserial primary key, jobname text, schedule text, command text, active boolean not null default true);
    create function cron.alter_job(job_id bigint, schedule text default null, command text default null,
                                   database text default null, username text default null, active boolean default null)
    returns void language sql as $f$ update cron.job set active = coalesce(alter_job.active, job.active) where jobid = job_id $f$;
    insert into cron.job (jobname, schedule, command) values ('rest-push-tick', '5 seconds', 'select public.tick_rest_pushes()');
  end if;
end;
$$;

create or replace function pg_temp.tick_awake() returns boolean language sql as
  $f$ select active from cron.job where jobname = 'rest-push-tick' $f$;

create or replace function pg_temp.authenticate_as(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$fn$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('c5000000-0000-0000-0000-000000000001', 'rest@tick.local', '{"full_name":"Rest","username":"rest_tick"}');
delete from public.rest_pushes;

-- ---------- sleep ----------
select public.tick_rest_pushes();
select is(pg_temp.tick_awake(), false, 'a tick with no rest pending puts the job to sleep');

-- ---------- wake ----------
select pg_temp.authenticate_as('c5000000-0000-0000-0000-000000000001');
insert into public.rest_pushes (id, user_id, notify_at, title, body, url)
  values ('c5000000-0000-0000-0000-0000000000a1', 'c5000000-0000-0000-0000-000000000001',
          now() + interval '90 seconds', 'Rest over', 'Next set', '/workout');
reset role;
select is(pg_temp.tick_awake(), true, 'a new rest wakes the job, though written by the person themselves');

select public.tick_rest_pushes();
select is(pg_temp.tick_awake(), true, 'a tick leaves it awake while the rest is pending');

select public.rest_push_tick_set(false);
select is(pg_temp.tick_awake(), true, 'it cannot be put to sleep while a rest is pending');

-- ---------- cancel, then restart ----------
select pg_temp.authenticate_as('c5000000-0000-0000-0000-000000000001');
update public.rest_pushes set cancelled_at = now() where id = 'c5000000-0000-0000-0000-0000000000a1';
reset role;
select public.tick_rest_pushes();
select is(pg_temp.tick_awake(), false, 'a cancelled rest lets the next tick sleep');

select pg_temp.authenticate_as('c5000000-0000-0000-0000-000000000001');
update public.rest_pushes set cancelled_at = null, notify_at = now() + interval '60 seconds'
 where id = 'c5000000-0000-0000-0000-0000000000a1';
reset role;
select is(pg_temp.tick_awake(), true, 'a restarted rest (the upsert path) wakes it again');

-- ---------- sent, and stale ----------
update public.rest_pushes set sent_at = now() where id = 'c5000000-0000-0000-0000-0000000000a1';
select public.tick_rest_pushes();
select is(pg_temp.tick_awake(), false, 'once the push is sent the job sleeps');

insert into public.rest_pushes (id, user_id, notify_at, title, body, url, created_at)
  values ('c5000000-0000-0000-0000-0000000000a2', 'c5000000-0000-0000-0000-000000000001',
          now() - interval '20 minutes', 'Rest over', 'Next set', '/workout', now() - interval '22 minutes');
select is(pg_temp.tick_awake(), true, 'any unsent row wakes it');
select public.tick_rest_pushes();
select is(pg_temp.tick_awake(), false, 'a row long past its time and never claimed does not keep it awake');

-- ---------- nobody else flips it ----------
select pg_temp.authenticate_as('c5000000-0000-0000-0000-000000000001');
select throws_ok($$ select public.rest_push_tick_set(true) $$, '42501', null,
  'a signed-in user cannot switch the tick');
reset role;

select * from finish();
rollback;
