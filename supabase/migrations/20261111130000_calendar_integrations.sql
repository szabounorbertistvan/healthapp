-- HealthApp schema · External calendars: the provider-agnostic foundation
--
-- A coach will be able to connect Google Calendar or Microsoft Outlook so
-- that their busy time there blocks Voinic booking slots. This migration is
-- the data model, the security boundary and the slot integration — NOT the
-- OAuth flow or the provider calls: those need provider apps, secrets and a
-- worker this project does not have yet. Nothing here creates a connection;
-- until the server side lands (apps/web/lib/calendar/), every coach is "not
-- connected" and booking behaves exactly as before.
--
--   calendar_connections   one per coach and provider while live. Status and
--                          health only — what the coach's screen shows.
--                          Readable by its owner; written only by the
--                          functions below.
--   calendar_credentials   the OAuth tokens, encrypted by the server before
--                          they get here (AES-256-GCM, key outside the
--                          database — lib/calendar/token-crypto.ts), plus the
--                          provider's opaque sync state. No grant and no
--                          policy for anon / authenticated: not even the
--                          owner can read it through the API. service_role only.
--   calendar_sources       the calendars of a connection (name, primary) and
--                          whether each affects availability — the coach's
--                          choice. Owner-readable.
--   calendar_busy_blocks   busy intervals, nothing else: no title, attendees,
--                          location or description is ever stored, and only
--                          for calendars that affect availability. No grant:
--                          clients never see them, the coach sees a count.
--
-- Slots: booking_slots_internal() also subtracts busy blocks (with the
-- service's buffers, like a Voinic booking) of sources that affect
-- availability on connections not disconnected. Busy time is stored as
-- absolute instants (tstzrange), so a time-zone change or a DST switch on
-- either side cannot shift it; all-day events are turned into instants by the
-- worker in the calendar's own zone (packages/shared/src/calendar.ts).
-- book_service() re-runs the slots for the start it is given, so a busy block
-- already synced refuses that start. Voinic bookings stay authoritative: an
-- external event created after a booking does not cancel it.
--
-- Sync model (for the worker to come): a provider push (Google watch
-- channels, Microsoft Graph subscriptions) or a coach action sets
-- next_sync_at; calendar_connections_due() hands the worker what to do; the
-- worker refreshes the access token when needed, reads free/busy for a
-- rolling window and calls calendar_sync_apply() (atomic replace of that
-- window) or calendar_sync_failed() (error vs reauth_required). There is no
-- polling loop here; a safety-net cron can call the worker rarely.
-- Disconnect is immediate for availability (sources and blocks go at once);
-- the token is revoked at the provider by the worker
-- (calendar_credentials_revoked()) and purged after 7 days regardless.

-- ---------- 1. tables ----------
create table public.calendar_connections (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.users (id) on delete cascade,
  provider text not null check (provider in ('google', 'microsoft')),
  status text not null default 'pending'
    check (status in ('pending', 'connected', 'syncing', 'error', 'reauth_required', 'disconnected')),
  -- what the provider calls the account (usually an e-mail), for its owner's screen only
  account_label text check (account_label is null or char_length(account_label) <= 200),
  scopes text[] not null default '{}' check (cardinality(scopes) <= 10),
  last_synced_at timestamptz,
  last_error_code text check (last_error_code is null or last_error_code in (
    'token_expired', 'token_revoked', 'permission_denied', 'rate_limited', 'provider_unavailable',
    'calendar_not_found', 'unknown')),
  last_error_at timestamptz,
  next_sync_at timestamptz,
  revoke_pending boolean not null default false,
  connected_at timestamptz,
  disconnected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'disconnected') = (disconnected_at is not null))
);
create trigger calendar_connections_updated before update on public.calendar_connections
  for each row execute function public.handle_updated_at();
-- one live connection per coach and provider; a disconnected one is history
create unique index calendar_connections_live on public.calendar_connections (coach_id, provider) where status <> 'disconnected';
create index calendar_connections_due_idx on public.calendar_connections (next_sync_at)
  where status in ('connected', 'error') and next_sync_at is not null;

create table public.calendar_credentials (
  connection_id uuid primary key references public.calendar_connections (id) on delete cascade,
  -- ciphertext only (base64 of iv | tag | data); the key never enters the database
  access_token_enc text check (access_token_enc is null or char_length(access_token_enc) <= 8000),
  refresh_token_enc text check (refresh_token_enc is null or char_length(refresh_token_enc) <= 8000),
  key_version smallint not null default 1,
  access_token_expires_at timestamptz,
  -- the provider's own incremental-sync state (sync tokens, delta links), per calendar; opaque
  sync_state jsonb not null default '{}'::jsonb check (jsonb_typeof(sync_state) = 'object'),
  updated_at timestamptz not null default now()
);
create trigger calendar_credentials_updated before update on public.calendar_credentials
  for each row execute function public.handle_updated_at();

create table public.calendar_sources (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.calendar_connections (id) on delete cascade,
  coach_id uuid not null references public.users (id) on delete cascade,
  external_id text not null check (char_length(external_id) between 1 and 1024),
  name text check (name is null or char_length(name) <= 200),
  is_primary boolean not null default false,
  affects_availability boolean not null default false,
  created_at timestamptz not null default now(),
  unique (connection_id, external_id)
);
create index calendar_sources_coach_idx on public.calendar_sources (coach_id) where affects_availability;

create table public.calendar_busy_blocks (
  id bigint generated always as identity primary key,
  source_id uuid not null references public.calendar_sources (id) on delete cascade,
  coach_id uuid not null references public.users (id) on delete cascade,
  busy tstzrange not null check (not isempty(busy) and not lower_inf(busy) and not upper_inf(busy)
                                 and upper(busy) - lower(busy) <= interval '31 days'),
  synced_at timestamptz not null default now()
);
-- the slot query asks "does anything of this coach overlap [start, end)?"
create index calendar_busy_blocks_coach_busy on public.calendar_busy_blocks using gist (coach_id, busy);
create index calendar_busy_blocks_source_idx on public.calendar_busy_blocks (source_id);

-- ---------- 2. access ----------
alter table public.calendar_connections enable row level security;
alter table public.calendar_credentials enable row level security;
alter table public.calendar_sources enable row level security;
alter table public.calendar_busy_blocks enable row level security;
revoke all on table public.calendar_connections, public.calendar_credentials, public.calendar_sources,
                    public.calendar_busy_blocks from anon, authenticated;
revoke all on sequence public.calendar_busy_blocks_id_seq from anon, authenticated;

-- the owner reads status and their calendars (no token column exists on these tables)
grant select (id, coach_id, provider, status, account_label, scopes, last_synced_at, last_error_code, last_error_at,
              revoke_pending, connected_at, disconnected_at, created_at, updated_at)
  on table public.calendar_connections to authenticated;
create policy calendar_connections_owner on public.calendar_connections for select to authenticated
  using (coach_id = auth.uid());
grant select (id, connection_id, coach_id, name, is_primary, affects_availability, created_at)
  on table public.calendar_sources to authenticated;
create policy calendar_sources_owner on public.calendar_sources for select to authenticated
  using (coach_id = auth.uid());
-- calendar_credentials and calendar_busy_blocks: no policy, no grant. service_role only.

comment on table public.calendar_credentials is
  'Encrypted OAuth tokens for calendar_connections. Never readable by anon/authenticated (no grant, no policy). Ciphertext only.';
comment on table public.calendar_busy_blocks is
  'Busy intervals from external calendars, no event content. Never readable through the API; used by booking_slots_internal().';

-- ---------- 3. the coach's doors ----------
/** The signed-in coach's connections, calendars and health — no secret, no event. */
create or replace function public.my_calendar_integrations()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'provider', c.provider,
    'status', c.status,
    'account_label', c.account_label,
    'last_synced_at', c.last_synced_at,
    'last_error_code', c.last_error_code,
    'connected_at', c.connected_at,
    'sources', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'is_primary', s.is_primary,
                                                             'affects_availability', s.affects_availability)
                                          order by s.is_primary desc, s.name)
                           from public.calendar_sources s where s.connection_id = c.id), '[]'::jsonb),
    'upcoming_busy', (select count(*)::int from public.calendar_busy_blocks b
                       join public.calendar_sources s on s.id = b.source_id
                      where s.connection_id = c.id and upper(b.busy) > now()))
    order by c.provider), '[]'::jsonb)
  from public.calendar_connections c
  where c.coach_id = auth.uid() and c.status <> 'disconnected';
$$;
revoke execute on function public.my_calendar_integrations() from public, anon;
grant execute on function public.my_calendar_integrations() to authenticated;

/**
 * Which of my calendars block my booking slots. Turning one off stops it
 * blocking at once (its blocks go); turning one on asks for a sync — busy
 * time is only ever stored for calendars that affect availability.
 */
create or replace function public.calendar_set_source_availability(p_source uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_connection uuid;
begin
  select s.connection_id into v_connection
    from public.calendar_sources s join public.calendar_connections c on c.id = s.connection_id
   where s.id = p_source and s.coach_id = auth.uid() and c.status <> 'disconnected';
  if v_connection is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  update public.calendar_sources set affects_availability = coalesce(p_on, false) where id = p_source;
  if not coalesce(p_on, false) then
    delete from public.calendar_busy_blocks where source_id = p_source;
  else
    update public.calendar_connections set next_sync_at = now() where id = v_connection and status in ('connected', 'error');
  end if;
end;
$$;
revoke execute on function public.calendar_set_source_availability(uuid, boolean) from public, anon;
grant execute on function public.calendar_set_source_availability(uuid, boolean) to authenticated;

/**
 * Disconnect: availability stops depending on that calendar now (its
 * calendars and busy time are deleted); the token is kept only until the
 * worker has revoked it at the provider (revoke_pending), 7 days at most.
 */
create or replace function public.calendar_disconnect(p_connection uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.calendar_connections
     set status = 'disconnected', disconnected_at = now(), next_sync_at = null,
         revoke_pending = exists (select 1 from public.calendar_credentials cr where cr.connection_id = p_connection)
   where id = p_connection and coach_id = auth.uid() and status <> 'disconnected';
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  delete from public.calendar_sources where connection_id = p_connection;  -- cascades to busy blocks
end;
$$;
revoke execute on function public.calendar_disconnect(uuid) from public, anon;
grant execute on function public.calendar_disconnect(uuid) to authenticated;

-- ---------- 4. the server's doors (service_role only) ----------
/**
 * After the OAuth callback has stored the encrypted tokens: the coach's live
 * connection for this provider, created or brought back to `pending` (a
 * reconnect after reauth_required reuses the row). Only a coach may connect.
 */
create or replace function public.calendar_connection_open(
  p_coach uuid, p_provider text, p_account_label text, p_scopes text[]
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not exists (select 1 from public.coach_profiles cp where cp.user_id = p_coach) then
    raise exception 'NOT_A_COACH' using errcode = '42501';
  end if;
  select id into v_id from public.calendar_connections
   where coach_id = p_coach and provider = p_provider and status <> 'disconnected';
  if v_id is null then
    insert into public.calendar_connections (coach_id, provider, status, account_label, scopes, connected_at, next_sync_at)
    values (p_coach, p_provider, 'pending', left(p_account_label, 200), coalesce(p_scopes, '{}'), now(), now())
    returning id into v_id;
  else
    update public.calendar_connections
       set status = 'pending', account_label = left(p_account_label, 200), scopes = coalesce(p_scopes, '{}'),
           last_error_code = null, last_error_at = null, connected_at = now(), next_sync_at = now()
     where id = v_id;
  end if;
  return v_id;
end;
$$;

/** What the worker should sync now (oldest first). Marks them syncing so two workers do not take the same one. */
create or replace function public.calendar_connections_due(p_limit int default 20)
returns table (connection_id uuid, coach_id uuid, provider text)
language sql volatile security definer set search_path = public as $$
  update public.calendar_connections c set status = 'syncing'
   where c.id in (select x.id from public.calendar_connections x
                   where x.status in ('pending', 'connected', 'error') and x.next_sync_at <= now()
                   order by x.next_sync_at
                   limit greatest(1, least(coalesce(p_limit, 20), 100))
                   for update skip locked)
  returning c.id, c.coach_id, c.provider;
$$;

/**
 * One successful sync, atomically: the provider's calendar list (new ones
 * affect availability only when primary — opt-in for the rest), then the busy
 * time of [p_from, p_to) replaced for the calendars that affect availability.
 * p_busy: [{"calendar": "<external id>", "start": "<instant>", "end": "<instant>"}].
 */
create or replace function public.calendar_sync_apply(
  p_connection uuid, p_calendars jsonb, p_busy jsonb, p_from timestamptz, p_to timestamptz, p_next_sync_at timestamptz default null
) returns int language plpgsql security definer set search_path = public as $$
declare
  v_coach uuid;
  v_n int;
begin
  select coach_id into v_coach from public.calendar_connections where id = p_connection and status <> 'disconnected' for update;
  if v_coach is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '400 days' then
    raise exception 'INVALID_WINDOW' using errcode = '22023';
  end if;

  if p_calendars is not null then
    insert into public.calendar_sources (connection_id, coach_id, external_id, name, is_primary, affects_availability)
    select p_connection, v_coach, e ->> 'id', left(e ->> 'name', 200), coalesce((e ->> 'primary')::boolean, false),
           coalesce((e ->> 'primary')::boolean, false)
      from jsonb_array_elements(p_calendars) e
     where nullif(e ->> 'id', '') is not null
    on conflict (connection_id, external_id) do update set name = excluded.name, is_primary = excluded.is_primary;
    delete from public.calendar_sources s
     where s.connection_id = p_connection
       and not exists (select 1 from jsonb_array_elements(p_calendars) e where e ->> 'id' = s.external_id);
  end if;

  delete from public.calendar_busy_blocks b using public.calendar_sources s
   where s.id = b.source_id and s.connection_id = p_connection
     and b.busy && tstzrange(p_from, p_to, '[)');
  insert into public.calendar_busy_blocks (source_id, coach_id, busy)
  select s.id, v_coach, tstzrange(greatest((e ->> 'start')::timestamptz, p_from), least((e ->> 'end')::timestamptz, p_to), '[)')
    from jsonb_array_elements(coalesce(p_busy, '[]'::jsonb)) e
    join public.calendar_sources s on s.connection_id = p_connection and s.external_id = e ->> 'calendar'
   where s.affects_availability
     and (e ->> 'end')::timestamptz > (e ->> 'start')::timestamptz
     and (e ->> 'end')::timestamptz > p_from and (e ->> 'start')::timestamptz < p_to;
  get diagnostics v_n = row_count;

  update public.calendar_connections
     set status = 'connected', last_synced_at = now(), last_error_code = null, last_error_at = null,
         next_sync_at = p_next_sync_at
   where id = p_connection;
  return v_n;
end;
$$;

/**
 * A failed sync. Credentials the provider refuses mean the coach must
 * reconnect (reauth_required, no retry); anything else is an error retried
 * later. Busy time already synced stays: an outage must not open slots the
 * coach is busy in.
 */
create or replace function public.calendar_sync_failed(p_connection uuid, p_code text, p_retry_at timestamptz default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_code text := case when p_code in ('token_expired', 'token_revoked', 'permission_denied', 'rate_limited',
                                      'provider_unavailable', 'calendar_not_found') then p_code else 'unknown' end;
begin
  update public.calendar_connections
     set status = case when v_code in ('token_expired', 'token_revoked', 'permission_denied') then 'reauth_required' else 'error' end,
         last_error_code = v_code, last_error_at = now(),
         next_sync_at = case when v_code in ('token_expired', 'token_revoked', 'permission_denied') then null
                             else coalesce(p_retry_at, now() + interval '30 minutes') end
   where id = p_connection and status <> 'disconnected';
end;
$$;

/** The worker revoked the token at the provider (or gave up): forget it. */
create or replace function public.calendar_credentials_revoked(p_connection uuid)
returns void language sql security definer set search_path = public as $$
  delete from public.calendar_credentials where connection_id = p_connection;
  update public.calendar_connections set revoke_pending = false where id = p_connection;
$$;

/** Housekeeping: tokens of a connection disconnected over 7 days ago are deleted, revoked or not. */
create or replace function public.calendar_credentials_purge()
returns int language plpgsql security definer set search_path = public as $$
declare
  v_n int;
begin
  delete from public.calendar_credentials cr using public.calendar_connections c
   where c.id = cr.connection_id and c.status = 'disconnected' and c.disconnected_at < now() - interval '7 days';
  get diagnostics v_n = row_count;
  update public.calendar_connections set revoke_pending = false
   where status = 'disconnected' and revoke_pending and disconnected_at < now() - interval '7 days';
  -- busy time in the past serves nothing
  delete from public.calendar_busy_blocks where upper(busy) < now() - interval '1 day';
  return v_n;
end;
$$;

revoke execute on function public.calendar_connection_open(uuid, text, text, text[]) from public, anon, authenticated;
revoke execute on function public.calendar_connections_due(int) from public, anon, authenticated;
revoke execute on function public.calendar_sync_apply(uuid, jsonb, jsonb, timestamptz, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.calendar_sync_failed(uuid, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.calendar_credentials_revoked(uuid) from public, anon, authenticated;
revoke execute on function public.calendar_credentials_purge() from public, anon, authenticated;
grant execute on function public.calendar_connection_open(uuid, text, text, text[]) to service_role;
grant execute on function public.calendar_connections_due(int) to service_role;
grant execute on function public.calendar_sync_apply(uuid, jsonb, jsonb, timestamptz, timestamptz, timestamptz) to service_role;
grant execute on function public.calendar_sync_failed(uuid, text, timestamptz) to service_role;
grant execute on function public.calendar_credentials_revoked(uuid) to service_role;
grant execute on function public.calendar_credentials_purge() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('calendar-credentials-purge', '41 3 * * *', $cron$ select public.calendar_credentials_purge(); $cron$);
  end if;
end;
$$;

-- ---------- 5. slots: external busy time blocks like a booking ----------
create or replace function public.booking_slots_internal(p_service uuid, p_from date, p_days int, p_viewer uuid)
returns table (start_at timestamptz, end_at timestamptz)
language sql stable security definer set search_path = public as $$
  with sv as (
    select cp.user_id as coach_id, u.timezone as tz,
           s.booking_duration_minutes as dur,
           s.booking_buffer_before_minutes as bb, s.booking_buffer_after_minutes as ba,
           now() + make_interval(mins => s.booking_min_notice_minutes) as earliest,
           now() + make_interval(days => s.booking_max_advance_days) as latest
    from public.coach_services s
    join public.coach_profiles cp on cp.id = s.coach_profile_id
    join public.users u on u.id = cp.user_id
    where s.id = p_service and s.active and s.bookable and s.booking_duration_minutes is not null
      and public.booking_timezone_valid(u.timezone)
  ),
  days as (
    select (p_from + g)::date as d
    from generate_series(0, least(greatest(coalesce(p_days, 7), 1), 31) - 1) g
  ),
  candidates as (
    select ((days.d + a.start_time) + make_interval(mins => step.m * k)) as local_start,
           ((days.d + a.end_time) at time zone sv.tz) as window_end
    from sv
    cross join days
    join public.coach_availability a
      on a.coach_id = sv.coach_id and a.active and a.weekday = extract(isodow from days.d)
    cross join lateral (select case when sv.dur < 30 then 15 else 30 end as m) step
    cross join lateral generate_series(
      0, floor((extract(epoch from (a.end_time - a.start_time)) / 60 - sv.dur) / step.m)::int) k
  ),
  slots as (
    select distinct (c.local_start at time zone sv.tz) as s_start, c.window_end
    from candidates c cross join sv
  ),
  timed as (
    select x.s_start, x.s_start + make_interval(mins => sv.dur) as s_end, sv.*
    from slots x cross join sv
    where x.s_start + make_interval(mins => sv.dur) <= x.window_end
      and x.s_start >= sv.earliest and x.s_start <= sv.latest
  )
  select t.s_start, t.s_end
  from timed t
  where not exists (
          select 1 from public.coach_availability_exceptions e
          where e.coach_id = t.coach_id
            and e.end_date >= ((t.s_start at time zone t.tz)::date - 1)
            and e.start_date <= ((t.s_end at time zone t.tz)::date + 1)
            and tstzrange(t.s_start, t.s_end, '[)') && case
                  when e.all_day then tstzrange(e.start_date::timestamp at time zone t.tz,
                                                (e.end_date + 1)::timestamp at time zone t.tz, '[)')
                  else tstzrange((e.start_date + e.start_time) at time zone t.tz,
                                 (e.start_date + e.end_time) at time zone t.tz, '[)') end)
    and not exists (
          select 1 from public.bookings b
          where b.coach_id = t.coach_id and b.status in ('pending', 'confirmed')
            and tstzrange(b.block_start, b.block_end, '[)')
                && tstzrange(t.s_start - make_interval(mins => t.bb), t.s_end + make_interval(mins => t.ba), '[)'))
    and not exists (
          select 1 from public.bookings b
          where b.client_id = t.coach_id and b.status in ('pending', 'confirmed')
            and tstzrange(b.start_at, b.end_at, '[)')
                && tstzrange(t.s_start - make_interval(mins => t.bb), t.s_end + make_interval(mins => t.ba), '[)'))
    -- busy in a connected external calendar (20261111130000), buffers included like a booking
    and not exists (
          select 1 from public.calendar_busy_blocks cb
          join public.calendar_sources cs on cs.id = cb.source_id and cs.affects_availability
          join public.calendar_connections cc on cc.id = cs.connection_id and cc.status <> 'disconnected'
          where cb.coach_id = t.coach_id
            and cb.busy && tstzrange(t.s_start - make_interval(mins => t.bb), t.s_end + make_interval(mins => t.ba), '[)'))
    and (p_viewer is null or not exists (
          select 1 from public.bookings b
          where (b.client_id = p_viewer or b.coach_id = p_viewer) and b.status in ('pending', 'confirmed')
            and tstzrange(b.start_at, b.end_at, '[)') && tstzrange(t.s_start, t.s_end, '[)')))
  order by 1;
$$;
revoke execute on function public.booking_slots_internal(uuid, date, int, uuid) from public, anon, authenticated;
