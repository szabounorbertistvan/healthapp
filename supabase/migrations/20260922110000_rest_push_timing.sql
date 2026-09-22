-- HealthApp schema · rest push: on time, and allowed onto the lock screen
--
-- Two complaints about the "rest finished" notification, both real.
--
-- 1. **It arrives late.** The delivery chain was: a pg_cron tick every ten
--    seconds → claim whatever is already due → pg_net → edge function → push
--    service → phone. A rest that ended a tenth of a second after a tick
--    waited the full ten for the next one, and then paid another second or two
--    for the delivery. Worst case the phone lit up twelve seconds after the
--    timer had run out, which on a 60-second rest is a fifth of the pause.
--
--    Fixed on both ends of the same interval: the tick runs every five
--    seconds, and a row is claimed once it is due *within the next five*. The
--    notification now lands somewhere between four seconds early and two late
--    instead of up to twelve late — and early is the harmless direction,
--    because the countdown on screen is the authority and the person is
--    looking at a phone that is already awake by the time it matters.
--
-- 2. **It never reached the lock screen.** That part is the app's (sw.js
--    stopped forcing `silent: true`), but the person's choice has to travel
--    with the schedule row, because the worker that shows the notification is
--    handed nothing but the push payload.

alter table public.rest_pushes
  add column alert boolean not null default true;

comment on column public.rest_pushes.alert is
  'RestPrefs.alert as it stood when the rest started: false shows the notification silently, true lets the device treat it as an alert. Never a sound or a vibration pattern — see apps/web/public/sw.js.';

-- How far ahead of `notify_at` a row may be claimed. Matches the tick period,
-- so every rest is picked up by exactly the tick before it ends.
create or replace function public.claim_due_rest_pushes(p_limit int default 100, p_lead_seconds int default 5)
returns setof public.rest_pushes
language plpgsql security definer set search_path = public as $$
declare
  v_lead interval := make_interval(secs => least(greatest(coalesce(p_lead_seconds, 5), 0), 30));
begin
  delete from public.rest_pushes where created_at < now() - interval '1 day';
  return query
    update public.rest_pushes p
       set sent_at = now()
     where p.id in (
             select id from public.rest_pushes
              where sent_at is null and cancelled_at is null and notify_at <= now() + v_lead
              order by notify_at
              limit greatest(1, least(p_limit, 500))
              for update skip locked
           )
    returning p.*;
end;
$$;
revoke execute on function public.claim_due_rest_pushes(int, int) from public, anon, authenticated;

-- The one-argument shape the deployed edge function calls is gone now that the
-- function above takes two with defaults; drop the old signature so PostgREST
-- does not keep offering it.
drop function if exists public.claim_due_rest_pushes(int);

create or replace function public.tick_rest_pushes()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_url text;
  v_key text;
begin
  -- Same lead as the claim above: wake for a rest that is about to end, not
  -- only for one that already has.
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

-- Re-schedule the tick at five seconds. cron.schedule() on an existing job
-- name replaces it, so this is idempotent.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      perform cron.schedule('rest-push-tick', '5 seconds', $cron$ select public.tick_rest_pushes(); $cron$);
    exception when others then
      raise notice 'rest-push-tick not re-scheduled (%)', sqlerrm;
    end;
  end if;
end;
$$;
