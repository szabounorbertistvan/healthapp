-- Native push for the Android app (docs/ANDROID_PLAN.md §7, Phase 4).
--
-- 1. push_devices — one row per phone, not one users.push_token per person:
--    a person has a phone and maybe a tablet, and tokens rotate. users.push_token
--    was never written by any client; it stays (unused) until a later cleanup,
--    and nothing reads it any more. A users row is readable by connected people,
--    which is one more reason a device token does not belong on it.
--    The table has an owner-read policy and no write grant: a phone registers
--    itself through register_push_device() and leaves through
--    unregister_push_device(); push-dispatch reads it as the service role.
-- 2. An account deletion request drops the person's devices at once, so a
--    deleted account is never pushed to during the 30-day window.
-- 3. The push-dispatch tick: pg_cron every minute → tick_push_dispatch() →
--    net.http_post to the edge function, with its URL and a service key in
--    vault (push_dispatch_url / push_dispatch_key), exactly like
--    tick_rest_pushes(). Without the vault secrets the tick does nothing.
--    One-time setup on a project:
--       select vault.create_secret('https://<ref>.supabase.co/functions/v1/push-dispatch', 'push_dispatch_url');
--       select vault.create_secret('<service role key>', 'push_dispatch_key');

-- ---------- 1. devices ----------

create table public.push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  -- An Expo push token, as expo-notifications hands it to the app.
  token text not null unique
    check (token ~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,200}\]$'),
  platform text not null check (platform in ('android', 'ios')),
  app_build text check (app_build is null or length(app_build) <= 40),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index push_devices_user_idx on public.push_devices (user_id);

alter table public.push_devices enable row level security;

create policy push_devices_owner_read on public.push_devices
  for select to authenticated using (user_id = auth.uid());

revoke all on public.push_devices from anon, authenticated;
grant select on public.push_devices to authenticated;

/** How many phones one person keeps registered; the oldest goes first. */
create or replace function public.register_push_device(p_token text, p_platform text, p_build text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  -- One token, one owner: a phone that changed hands moves to whoever signed
  -- in on it last, so the previous person's pushes never reach it.
  insert into public.push_devices (user_id, token, platform, app_build)
  values (v_user, p_token, p_platform, nullif(left(coalesce(p_build, ''), 40), ''))
  on conflict (token) do update
    set user_id = excluded.user_id,
        platform = excluded.platform,
        app_build = excluded.app_build,
        last_seen_at = now();
  -- Ten phones is plenty; past that the least recently seen ones go.
  delete from public.push_devices d
   where d.user_id = v_user
     and d.id not in (
       select id from public.push_devices
        where user_id = v_user
        order by last_seen_at desc
        limit 10);
end;
$$;

create or replace function public.unregister_push_device(p_token text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.push_devices where token = p_token and user_id = auth.uid();
$$;

revoke execute on function public.register_push_device(text, text, text) from public, anon;
revoke execute on function public.unregister_push_device(text) from public, anon;
grant execute on function public.register_push_device(text, text, text) to authenticated;
grant execute on function public.unregister_push_device(text) to authenticated;

-- ---------- 2. a deletion request drops the devices ----------

create or replace function public.push_devices_drop_on_deletion()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.push_devices where user_id = new.user_id;
  return new;
end;
$$;
revoke execute on function public.push_devices_drop_on_deletion() from public, anon, authenticated;

create trigger account_deletion_drops_push_devices
  after insert on public.account_deletion_requests
  for each row execute function public.push_devices_drop_on_deletion();

-- ---------- 3. the dispatch tick ----------

create or replace function public.tick_push_dispatch()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_url text;
  v_key text;
begin
  -- Nothing to do: no unsent notification for anyone with a phone.
  if not exists (
    select 1 from public.notifications n
     where n.sent_at is null
       and exists (select 1 from public.push_devices d where d.user_id = n.user_id)
  ) then
    return;
  end if;
  begin
    select decrypted_secret into v_url from vault.decrypted_secrets where name = 'push_dispatch_url';
    select decrypted_secret into v_key from vault.decrypted_secrets where name = 'push_dispatch_key';
  exception when others then
    return; -- no vault (local stack): in-app notifications work, push does not
  end;
  if v_url is null or v_key is null then
    return;
  end if;
  begin
    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
      body := '{}'::jsonb
    );
  exception when others then
    raise notice 'tick_push_dispatch: http_post unavailable (%)', sqlerrm;
  end;
end;
$$;
revoke execute on function public.tick_push_dispatch() from public, anon, authenticated;

/**
 * The dispatcher's one door to "who may this go to": service role only, so the
 * edge function proves who it is through Postgres (the caller's bearer is its
 * client key) instead of comparing strings with SUPABASE_SERVICE_ROLE_KEY — the
 * comparison that stops working once a project carries sb_secret_ keys.
 * Rows older than 12 hours are marked sent without a push first: a notification
 * that waited that long is history, and it keeps the first run on a project
 * from pushing a backlog nobody asked for.
 */
create or replace function public.claim_push_batch(p_limit int default 100)
returns table (
  id uuid, user_id uuid, category text, title text, body text, payload jsonb, created_at timestamptz,
  timezone text, notification_prefs jsonb, tokens text[]
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.notifications n
     set sent_at = now()
   where n.sent_at is null
     and n.created_at < now() - interval '12 hours';

  -- No phone, no push: the row stays in-app history and is marked handled.
  update public.notifications n
     set sent_at = now()
   where n.sent_at is null
     and not exists (select 1 from public.push_devices d where d.user_id = n.user_id);

  return query
    select n.id, n.user_id, n.category::text, n.title, n.body, n.payload, n.created_at,
           u.timezone, coalesce(u.notification_prefs, '{}'::jsonb),
           array(select d.token from public.push_devices d where d.user_id = n.user_id order by d.last_seen_at desc)
      from public.notifications n
      join public.users u on u.id = n.user_id
     where n.sent_at is null
     order by n.created_at
     limit greatest(1, least(p_limit, 500));
end;
$$;
revoke execute on function public.claim_push_batch(int) from public, anon, authenticated;
grant execute on function public.claim_push_batch(int) to service_role;

/** Marks rows handled (pushed or skipped) — service role only, like the claim. */
create or replace function public.mark_pushed(p_ids uuid[])
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.notifications set sent_at = now() where id = any(p_ids) and sent_at is null;
$$;
revoke execute on function public.mark_pushed(uuid[]) from public, anon, authenticated;
grant execute on function public.mark_pushed(uuid[]) to service_role;

/** A token Expo answered DeviceNotRegistered for: the app was uninstalled. */
create or replace function public.forget_push_tokens(p_tokens text[])
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.push_devices where token = any(p_tokens);
$$;
revoke execute on function public.forget_push_tokens(text[]) from public, anon, authenticated;
grant execute on function public.forget_push_tokens(text[]) to service_role;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    begin
      perform cron.unschedule('push-dispatch-tick');
    exception when others then
      null;
    end;
    perform cron.schedule('push-dispatch-tick', '* * * * *', $cron$ select public.tick_push_dispatch(); $cron$);
  end if;
exception when others then
  raise notice 'push-dispatch-tick not scheduled (%)', sqlerrm;
end;
$$;
