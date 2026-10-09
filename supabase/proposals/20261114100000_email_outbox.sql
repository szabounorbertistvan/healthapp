-- PROPOSAL — NOT A MIGRATION. Lives in supabase/proposals/ so neither
-- `supabase db push` nor CI applies it. To adopt it, move it to
-- supabase/migrations/ (keep or bump the timestamp) together with
-- supabase/proposals/email_outbox.test.sql → supabase/tests/. See
-- docs/MARKETPLACE_EMAIL.md §5 and §8.
--
-- Marketplace email outbox: the persistent state the dispatcher
-- (supabase/functions/marketplace-email-dispatch) needs to send each eligible
-- notification at most once, retry what failed for a passing reason, and stop
-- on what will not pass. `notifications.sent_at` cannot carry this: it belongs
-- to push-dispatch, which also stamps the rows it skips.
--
--   notifications INSERT ──trigger──▶ email_outbox (one row per eligible notification)
--   cron → dispatcher ── email_outbox_claim() ──▶ decide / render / send ── email_outbox_mark()
--
-- Service role only: no grant, no policy for anon or authenticated. The claim
-- reads the recipient's address from auth.users inside the function; it never
-- leaves the database except to the dispatcher.

-- ---------- 1. the table ----------
create table public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  -- one notification can only ever be one email
  notification_id uuid not null unique references public.notifications (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'retry', 'failed', 'skipped')),
  reason text check (reason is null or reason ~ '^[a-z_]{1,40}$'),
  attempts int not null default 0 check (attempts between 0 and 20),
  not_before timestamptz not null,
  locked_until timestamptz,
  provider_message_id text check (provider_message_id is null or length(provider_message_id) <= 200),
  last_status int,
  last_error_code text check (last_error_code is null or last_error_code ~ '^[a-z0-9_]{1,60}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index email_outbox_due_idx on public.email_outbox (not_before) where status in ('pending', 'retry', 'sending');
create index email_outbox_user_idx on public.email_outbox (user_id);
alter table public.email_outbox enable row level security;
revoke all on public.email_outbox from public, anon, authenticated;

-- ---------- 2. which notifications are eligible, and their hold ----------
-- Mirrors MARKETPLACE_EMAIL_RULES (packages/shared/src/marketplace-email.ts);
-- apps/web/lib/email-outbox-proposal.test.ts keeps the two lists equal.
create or replace function public.email_rule_delay_minutes(p_category text, p_event text)
returns int language sql immutable set search_path = public as $$
  select r.delay from (values
    ('coaching_request', 'sent', 0), ('coaching_request', 'accepted', 0), ('coaching_request', 'declined', 0),
    ('coaching_request', 'started', 0),
    ('booking', 'booked', 0), ('booking', 'requested', 0), ('booking', 'confirmed', 0), ('booking', 'declined', 0),
    ('booking', 'cancelled', 0), ('booking', 'reminder', 0),
    ('new_message', '*', 15),
    ('review', 'published', 0), ('review', 'response', 0),
    ('marketplace', 'profile_published', 0), ('marketplace', 'profile_returned', 0),
    ('marketplace', 'revision_approved', 0), ('marketplace', 'revision_returned', 0)
  ) r(category, event, delay)
  where r.category = p_category and (r.event = coalesce(p_event, '*') or r.event = '*')
  limit 1;
$$;
revoke execute on function public.email_rule_delay_minutes(text, text) from public, anon, authenticated;

-- ---------- 3. enqueue: the single integration point ----------
-- The *_notify() functions are untouched; they keep deciding who gets a
-- notification. This only queues the eligible ones. Whether an email is
-- actually sent is decided at send time (preferences, confirmed address,
-- suspension, read in-app, age).
create or replace function public.email_outbox_enqueue()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_delay int := public.email_rule_delay_minutes(new.category::text, new.payload ->> 'event');
begin
  if v_delay is not null then
    insert into public.email_outbox (notification_id, user_id, not_before)
    values (new.id, new.user_id, new.created_at + make_interval(mins => v_delay))
    on conflict (notification_id) do nothing;
  end if;
  return null;
end;
$$;
revoke execute on function public.email_outbox_enqueue() from public, anon, authenticated;

create trigger notifications_email_outbox
  after insert on public.notifications
  for each row execute function public.email_outbox_enqueue();

-- ---------- 4. what the dispatcher reads ----------
create or replace function public.email_outbox_rows(p_ids uuid[])
returns table (
  id uuid, notification_id uuid, attempts int, category text, payload jsonb, created_at timestamptz,
  read_at timestamptz, email text, email_confirmed boolean, locale text, time_zone text, prefs jsonb,
  suspended boolean, deletion_requested boolean, actor_name text, starts_at timestamptz
) language sql stable security definer set search_path = public as $$
  select o.id, o.notification_id, o.attempts, n.category::text, n.payload, n.created_at, n.read_at,
         au.email, au.email_confirmed_at is not null, u.locale, u.timezone, u.notification_prefs,
         u.suspended_at is not null,
         exists (select 1 from public.account_deletion_requests d where d.user_id = o.user_id),
         (select public.public_display_name(a.username, a.full_name) from public.users a
           where (n.payload ->> 'actor_id') ~ '^[0-9a-f-]{36}$' and a.id = (n.payload ->> 'actor_id')::uuid),
         (select b.start_at from public.bookings b
           where n.category = 'booking' and (n.payload ->> 'booking_id') ~ '^[0-9a-f-]{36}$'
             and b.id = (n.payload ->> 'booking_id')::uuid)
    from public.email_outbox o
    join public.notifications n on n.id = o.notification_id
    join public.users u on u.id = o.user_id
    left join auth.users au on au.id = o.user_id
   where o.id = any (p_ids)
   order by o.not_before;
$$;
revoke execute on function public.email_outbox_rows(uuid[]) from public, anon, authenticated;

-- Locks due rows for this run: SKIP LOCKED, so two overlapping runs never get
-- the same row; a row left in 'sending' by a crashed run comes back after its
-- lock expires.
create or replace function public.email_outbox_claim(p_limit int)
returns table (
  id uuid, notification_id uuid, attempts int, category text, payload jsonb, created_at timestamptz,
  read_at timestamptz, email text, email_confirmed boolean, locale text, time_zone text, prefs jsonb,
  suspended boolean, deletion_requested boolean, actor_name text, starts_at timestamptz
) language plpgsql security definer set search_path = public as $$
declare
  v_ids uuid[];
begin
  with picked as (
    select o.id from public.email_outbox o
     where (o.status in ('pending', 'retry') and o.not_before <= now())
        or (o.status = 'sending' and o.locked_until < now())
     order by o.not_before
     limit greatest(1, least(coalesce(p_limit, 20), 50))
     for update skip locked
  ), claimed as (
    update public.email_outbox o
       set status = 'sending', locked_until = now() + interval '5 minutes', updated_at = now()
      from picked where o.id = picked.id
    returning o.id
  )
  select coalesce(array_agg(claimed.id), '{}') into v_ids from claimed;
  return query select * from public.email_outbox_rows(v_ids);
end;
$$;

-- The same rows without locking anything: the dispatcher's dry run.
create or replace function public.email_outbox_peek(p_limit int)
returns table (
  id uuid, notification_id uuid, attempts int, category text, payload jsonb, created_at timestamptz,
  read_at timestamptz, email text, email_confirmed boolean, locale text, time_zone text, prefs jsonb,
  suspended boolean, deletion_requested boolean, actor_name text, starts_at timestamptz
) language sql stable security definer set search_path = public as $$
  select * from public.email_outbox_rows(array(
    select o.id from public.email_outbox o
     where o.status in ('pending', 'retry') and o.not_before <= now()
     order by o.not_before
     limit greatest(1, least(coalesce(p_limit, 20), 50))));
$$;

-- Records an outcome. Only a claimed ('sending') row moves; anything else is an error.
create or replace function public.email_outbox_mark(
  p_id uuid, p_status text, p_reason text, p_not_before timestamptz, p_last_status int,
  p_error_code text, p_provider_message_id text
) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('sent', 'skipped', 'pending', 'retry', 'failed') then
    raise exception 'EMAIL_OUTBOX_BAD_STATUS' using errcode = '22023';
  end if;
  if p_status in ('pending', 'retry') and p_not_before is null then
    raise exception 'EMAIL_OUTBOX_NOT_BEFORE_REQUIRED' using errcode = '22023';
  end if;
  update public.email_outbox o
     set status = p_status,
         reason = case when p_status = 'skipped' then p_reason else o.reason end,
         not_before = coalesce(p_not_before, o.not_before),
         attempts = o.attempts + case when p_status in ('sent', 'retry', 'failed') then 1 else 0 end,
         last_status = coalesce(p_last_status, o.last_status),
         last_error_code = case when p_status in ('retry', 'failed') then p_error_code else o.last_error_code end,
         provider_message_id = coalesce(p_provider_message_id, o.provider_message_id),
         locked_until = null,
         updated_at = now()
   where o.id = p_id and o.status = 'sending';
  if not found then
    raise exception 'EMAIL_OUTBOX_NOT_CLAIMED' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.email_outbox_claim(int) from public, anon, authenticated;
revoke execute on function public.email_outbox_peek(int) from public, anon, authenticated;
revoke execute on function public.email_outbox_mark(uuid, text, text, timestamptz, int, text, text) from public, anon, authenticated;
grant execute on function public.email_outbox_claim(int) to service_role;
grant execute on function public.email_outbox_peek(int) to service_role;
grant execute on function public.email_outbox_mark(uuid, text, text, timestamptz, int, text, text) to service_role;

-- The pg_cron tick (net.http_post with Vault 'marketplace_email_url' /
-- 'marketplace_email_key', as tick_rest_pushes() does) is deliberately NOT
-- here: it is scheduled by hand once the secrets exist (docs/MARKETPLACE_EMAIL.md §8).
