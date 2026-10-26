-- The rest-push tick sleeps while nobody is resting (2026-10-26)
--
-- rest-push-tick runs every 5 seconds (20260922110000), day and night: 17,280
-- runs a day, each one a row in cron.job_run_details, for a feature that sent 2
-- notifications in the 30 days before this. The tick itself was cheap; its
-- run history was not (20261209100000).
--
-- Now the job is switched on only while there is a rest to wait for:
--
--   * wake — a rest_pushes row that is still to be sent (inserted, or upserted
--     back by a rest that was restarted) switches the job on, from a trigger;
--   * sleep — a tick that finds nothing pending switches it off again.
--
-- Timing is unchanged while awake (every 5 s, claimed 5 s ahead). pg_cron picks
-- the switch up within a tick, and a rest is far longer than that.
--
-- The race between the two: a tick that has just seen "nothing pending" could
-- switch the job off right after a new rest switched it on, and that rest would
-- never be sent. Both sides take the same transaction-level advisory lock and
-- decide only once they hold it — the wake reads the job's current state, the
-- sleep re-checks the queue — so whichever comes second sees what the first one
-- committed.
--
-- "Pending" ignores rows whose notify_at is more than 10 minutes gone: without
-- the vault secrets nothing is ever claimed, and such a row must not keep the
-- job awake for the day claim_due_rest_pushes() would take to prune it.
--
-- cron.* is reached through dynamic SQL behind to_regclass(): a stack without
-- pg_cron (the offline test runner) applies this and the tick is a no-op there.
-- The functions run as their owner (postgres), who owns the job and so may
-- alter it. The Android app is not involved: it schedules its rest
-- notification on the phone itself.

create or replace function public.rest_push_pending()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.rest_pushes
     where sent_at is null and cancelled_at is null
       and notify_at > now() - interval '10 minutes'
  );
$$;
revoke execute on function public.rest_push_pending() from public, anon, authenticated;

-- Switch rest-push-tick on or off. Off only when, under the lock, nothing is
-- pending; a no-op when the job is already in that state or does not exist.
create or replace function public.rest_push_tick_set(p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_job bigint;
  v_active boolean;
begin
  if to_regclass('cron.job') is null then
    return;
  end if;
  perform pg_advisory_xact_lock(hashtext('rest-push-tick'));
  execute 'select jobid, active from cron.job where jobname = $1'
    into v_job, v_active using 'rest-push-tick';
  if v_job is null or v_active is not distinct from p_active then
    return;
  end if;
  if not p_active and public.rest_push_pending() then
    return;
  end if;
  execute 'select cron.alter_job(job_id := $1, active := $2)' using v_job, p_active;
end;
$$;
revoke execute on function public.rest_push_tick_set(boolean) from public, anon, authenticated;

create or replace function public.rest_pushes_wake_tick()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.sent_at is null and new.cancelled_at is null then
    perform public.rest_push_tick_set(true);
  end if;
  return null;
end;
$$;
revoke execute on function public.rest_pushes_wake_tick() from public, anon, authenticated;

drop trigger if exists rest_pushes_wake_tick on public.rest_pushes;
create trigger rest_pushes_wake_tick
  after insert or update of notify_at, sent_at, cancelled_at on public.rest_pushes
  for each row execute function public.rest_pushes_wake_tick();

-- 20260922110000's tick, plus: nothing pending → go to sleep.
create or replace function public.tick_rest_pushes()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_url text;
  v_key text;
begin
  if not public.rest_push_pending() then
    perform public.rest_push_tick_set(false);
    return;
  end if;

  -- Same lead as claim_due_rest_pushes(): wake for a rest that is about to
  -- end, not only for one that already has.
  if not exists (
    select 1 from public.rest_pushes
     where sent_at is null and cancelled_at is null and notify_at <= now() + interval '5 seconds'
  ) then
    return;
  end if;

  begin
    select decrypted_secret into v_url from vault.decrypted_secrets where name = 'rest_push_url';
    select decrypted_secret into v_key from vault.decrypted_secrets where name = 'rest_push_key';
  exception when others then
    return; -- no vault (local stack): the timer works, the push does not
  end;
  if v_url is null or v_key is null then
    return;
  end if;

  begin
    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
      body := '{}'::jsonb,
      timeout_milliseconds := 5000
    );
  exception when others then
    raise notice 'tick_rest_pushes: http_post unavailable (%)', sqlerrm;
  end;
end;
$$;
revoke execute on function public.tick_rest_pushes() from public, anon, authenticated;
