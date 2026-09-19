-- HealthApp schema · rest timer between sets + Web Push for "rest finished"
--
-- The timer itself lives in the browser (packages/shared/src/rest-timer.ts:
-- two instants, startedAt and endsAt). What the database holds is the part a
-- locked phone cannot do for itself:
--
-- 1. users.rest_prefs — the person's default rest, per-lift overrides and
--    whether they want the rest-finished notification. One jsonb column,
--    editable by the person like the other profile columns (the update grant
--    is column-level since 20260907110000). The coach's prescription stays
--    where it is, program_exercises.rest_seconds; this is the trainee's own.
--
-- 2. push_subscriptions — one row per browser the person allowed
--    notifications in: the PushManager endpoint and the two keys the push
--    service needs (RFC 8291). Owner-only under RLS; the edge function reads
--    them with the service role. Nothing else is stored: no VAPID material
--    ever touches the database — the private key is an edge-function secret.
--
-- 3. rest_pushes — the schedule. When a rest starts the app writes one row
--    keyed by the timer's own id with the instant to notify at; pausing,
--    skipping or finishing in the foreground cancels it. A pg_cron tick every
--    ten seconds asks the `rest-push` edge function to deliver whatever is
--    due. claim_due_rest_pushes() marks a row sent *before* the push goes
--    out, in one statement, so two overlapping ticks cannot both send it:
--    the primary key is the idempotency key.
--
-- Deployment (once, by hand — none of this is in the migration):
--   · VAPID keys:   node scripts/vapid-keys.mjs  → secrets for the function
--                   (VAPID_KEYS_JSON, VAPID_SUBJECT) and NEXT_PUBLIC_VAPID_PUBLIC_KEY
--                   for the web app.
--   · The tick needs to know where the function is and how to call it:
--       select vault.create_secret('https://<ref>.supabase.co/functions/v1/rest-push', 'rest_push_url');
--       select vault.create_secret('<service role key>', 'rest_push_key');
--     Without both the tick is a no-op and the timer still works, minus the
--     locked-phone notification.

-- ---------- 1. the person's rest settings ----------

alter table public.users
  add column rest_prefs jsonb not null default '{}'
    constraint users_rest_prefs_object check (jsonb_typeof(rest_prefs) = 'object');

comment on column public.users.rest_prefs is
  'Rest timer: {default_seconds, notify, exercises: {exercise_id: seconds}}. Read through normalizeRestPrefs().';

grant update (rest_prefs) on table public.users to authenticated;

-- ---------- 2. where to push ----------

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and length(endpoint) <= 2048),
  p256dh text not null check (length(p256dh) between 1 and 256),
  auth text not null check (length(auth) between 1 and 64),
  user_agent text check (user_agent is null or length(user_agent) <= 512),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);
create trigger push_subscriptions_updated before update on public.push_subscriptions
  for each row execute function public.handle_updated_at();

alter table public.push_subscriptions enable row level security;

create policy push_subscriptions_select on public.push_subscriptions for select to authenticated
  using (user_id = auth.uid());
create policy push_subscriptions_insert on public.push_subscriptions for insert to authenticated
  with check (user_id = auth.uid());
create policy push_subscriptions_update on public.push_subscriptions for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy push_subscriptions_delete on public.push_subscriptions for delete to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on table public.push_subscriptions to authenticated;

-- ---------- 3. when to push ----------

create table public.rest_pushes (
  -- The timer's id, minted in the browser: one rest period, one row, one push.
  id uuid primary key,
  user_id uuid not null references public.users (id) on delete cascade,
  notify_at timestamptz not null,
  -- Localised by the server action when the row is written, so the function
  -- that sends it needs no dictionary.
  title text not null check (length(title) between 1 and 120),
  body text not null check (length(body) between 1 and 300),
  -- Same-origin path the notification click opens, e.g. /workout/<day>/log.
  url text not null check (url ~ '^/' and length(url) <= 512),
  sent_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);
create index rest_pushes_due_idx on public.rest_pushes (notify_at)
  where sent_at is null and cancelled_at is null;

alter table public.rest_pushes enable row level security;

create policy rest_pushes_select on public.rest_pushes for select to authenticated
  using (user_id = auth.uid());
create policy rest_pushes_insert on public.rest_pushes for insert to authenticated
  with check (user_id = auth.uid());
create policy rest_pushes_update on public.rest_pushes for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy rest_pushes_delete on public.rest_pushes for delete to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on table public.rest_pushes to authenticated;

-- Claim what is due: mark sent and hand back, atomically. The edge function
-- calls this with the service role and then delivers; a row it fails to
-- deliver stays marked — a rest notification five minutes late is noise, not
-- a retry worth making. Rows older than a day are pruned on the way.
create or replace function public.claim_due_rest_pushes(p_limit int default 100)
returns setof public.rest_pushes
language plpgsql security definer set search_path = public as $$
begin
  delete from public.rest_pushes where created_at < now() - interval '1 day';
  return query
    update public.rest_pushes p
       set sent_at = now()
     where p.id in (
             select id from public.rest_pushes
              where sent_at is null and cancelled_at is null and notify_at <= now()
              order by notify_at
              limit greatest(1, least(p_limit, 500))
              for update skip locked
           )
    returning p.*;
end;
$$;
revoke execute on function public.claim_due_rest_pushes(int) from public, anon, authenticated;

-- The cron tick. Cheap when nothing is due (one partial-index probe); when
-- something is, it asks the edge function to send. pg_net's http_post is
-- asynchronous — the tick never waits on the push service.
create or replace function public.tick_rest_pushes()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_url text;
  v_key text;
begin
  if not exists (
    select 1 from public.rest_pushes
     where sent_at is null and cancelled_at is null and notify_at <= now()
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

-- ---------- scheduling (pg_cron ships with Supabase; guarded for local dev) ----------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    begin
      -- Sub-minute schedules need pg_cron ≥ 1.5 (Supabase ships 1.6). On an
      -- older build the schedule is refused rather than the migration failing.
      perform cron.schedule('rest-push-tick', '10 seconds', $cron$ select public.tick_rest_pushes(); $cron$);
    exception when others then
      raise notice 'rest-push-tick not scheduled (%)', sqlerrm;
    end;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
end;
$$;
