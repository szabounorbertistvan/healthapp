-- HealthApp schema · Coach Discovery: availability, bookable services, bookings
--
-- What existed: users.timezone (IANA, default Europe/Bucharest, used by the
-- streak / check-in jobs), coach_services (the offer), notifications + the
-- Activity Center, pg_cron for jobs, conversations. No calendar, schedule or
-- appointment table of any kind. This migration adds the minimum on top:
--
-- 1. The coach's time zone is users.timezone — reused, not duplicated. Every
--    weekly time and every time-off date is wall-clock time in that zone and
--    is turned into an instant only when slots are computed, so DST moves
--    with the clock (09:00 stays 09:00 in March and in October). A booking
--    stores absolute instants (start_at / end_at) plus the zone it was made
--    in, so it never moves if the coach later changes zone.
--
-- 2. coach_services learns booking settings (bookable, duration, buffers,
--    minimum notice, maximum advance, who may book: public | clients, how:
--    instant | approval). Not content: like active / sort order they are set
--    by an RPC on any profile that is not suspended, so a published coach can
--    open booking without a re-review. A digital service (a plan, no live
--    session) is never bookable.
--
-- 3. coach_availability: weekly blocks (ISO weekday 1 = Monday, start, end,
--    active). Several per day; an exclusion constraint refuses two active
--    blocks of one coach that overlap on the same weekday.
--
-- 4. coach_availability_exceptions: time off without touching the week — a
--    date range all day (holiday, vacation), or one date between two times.
--    Exceptions may overlap each other (they just add up); one that covers an
--    existing booking does not cancel it — the coach cancels explicitly.
--
-- 5. bookings: client, coach, service (+ a snapshot of its name and price —
--    informational, nothing is charged), start/end, zone, status
--      pending -> confirmed | declined | cancelled
--      confirmed -> cancelled | completed | no_show
--    A pending booking holds its slot until the coach answers. Double booking
--    is refused by the database, not the browser: two exclusion constraints
--    over pending + confirmed rows (the coach's time widened by the service's
--    buffers, and the client's own time), plus per-person advisory locks in
--    book_service() so a coach booked as a client elsewhere is not double-
--    booked across roles either. The table has no write policy: every move
--    is an RPC that checks who may make it.
--
-- 6. Slots are computed, never stored: coach_booking_slots() = weekly blocks
--    − time off − pending/confirmed bookings (with buffers) − minimum notice −
--    maximum advance, in one set-based query. book_service() re-runs the same
--    computation for the requested start and refuses anything it does not
--    return.
--
-- 7. Notices: one category, booking, payload.event requested / booked /
--    confirmed / declined / cancelled / reminder, through social_notify_ok
--    like every other notice. A reminder job (pg_cron, every 15 minutes, as
--    the existing jobs) tells both sides once, about a day ahead.
--
-- 8. Messaging is untouched: a booking creates no conversation; the reads
--    return the pair's existing conversation id, if any, for a link.
--
-- Not here: payments, calendar sync, recurring appointments, group classes.
-- bookings.id is stable and start/end/zone are absolute, which is what a
-- calendar feed or a payment row will key on later.

create extension if not exists btree_gist with schema extensions;

-- ---------- helpers ----------
create or replace function public.booking_timezone_valid(p_tz text)
returns boolean language sql stable set search_path = public as $$
  select p_tz is not null and exists (select 1 from pg_catalog.pg_timezone_names where name = p_tz);
$$;
revoke execute on function public.booking_timezone_valid(text) from public, anon;
grant execute on function public.booking_timezone_valid(text) to authenticated;

-- a range of wall-clock times, for the weekly overlap constraint
do $$ begin
  create type public.time_range as range (subtype = time);
exception when duplicate_object then null; end $$;

-- ---------- 2. services: booking settings ----------
alter table public.coach_services
  add column bookable boolean not null default false,
  add column booking_duration_minutes int
    check (booking_duration_minutes is null or booking_duration_minutes between 10 and 480),
  add column booking_buffer_before_minutes int not null default 0 check (booking_buffer_before_minutes between 0 and 240),
  add column booking_buffer_after_minutes int not null default 0 check (booking_buffer_after_minutes between 0 and 240),
  add column booking_min_notice_minutes int not null default 720 check (booking_min_notice_minutes between 0 and 43200),
  add column booking_max_advance_days int not null default 60 check (booking_max_advance_days between 1 and 365),
  add column booking_access text not null default 'public' check (booking_access in ('public', 'clients')),
  add column booking_confirmation text not null default 'approval' check (booking_confirmation in ('instant', 'approval')),
  add constraint coach_services_bookable_duration check (not bookable or booking_duration_minutes is not null),
  add constraint coach_services_bookable_live check (not bookable or delivery <> 'digital');

/**
 * The coach turns booking on or off for one of their services and sets how.
 * Operational, like coach_set_service_active(): any profile but a suspended one.
 */
create or replace function public.coach_set_service_booking(
  p_service uuid,
  p_bookable boolean,
  p_duration int default null,
  p_buffer_before int default 0,
  p_buffer_after int default 0,
  p_min_notice int default 720,
  p_max_advance int default 60,
  p_access text default 'public',
  p_confirmation text default 'approval'
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_status text;
  v_delivery text;
begin
  select cp.status, sv.delivery into v_status, v_delivery
  from public.coach_services sv
  join public.coach_profiles cp on cp.id = sv.coach_profile_id
  where sv.id = p_service and cp.user_id = auth.uid()
  for update of sv;
  if v_status is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_status = 'suspended' then
    raise exception 'PROFILE_LOCKED' using errcode = '55000';
  end if;
  if coalesce(p_bookable, false) and v_delivery = 'digital' then
    raise exception 'NOT_BOOKABLE_KIND' using errcode = '22023';
  end if;
  begin
    update public.coach_services
       set bookable = coalesce(p_bookable, false),
           booking_duration_minutes = p_duration,
           booking_buffer_before_minutes = coalesce(p_buffer_before, 0),
           booking_buffer_after_minutes = coalesce(p_buffer_after, 0),
           booking_min_notice_minutes = coalesce(p_min_notice, 720),
           booking_max_advance_days = coalesce(p_max_advance, 60),
           booking_access = coalesce(p_access, 'public'),
           booking_confirmation = coalesce(p_confirmation, 'approval')
     where id = p_service;
  exception when check_violation then
    raise exception 'INVALID_BOOKING_SETTINGS' using errcode = '22023';
  end;
end;
$$;
revoke execute on function public.coach_set_service_booking(uuid, boolean, int, int, int, int, int, text, text) from public, anon;
grant execute on function public.coach_set_service_booking(uuid, boolean, int, int, int, int, int, text, text) to authenticated;

-- ---------- 3. weekly availability ----------
create table public.coach_availability (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.users (id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7), -- ISO: 1 = Monday … 7 = Sunday
  start_time time not null,
  end_time time not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coach_availability_interval check (start_time < end_time),
  constraint coach_availability_no_overlap exclude using gist (
    coach_id with =, weekday with =, public.time_range(start_time, end_time, '[)') with &&
  ) where (active)
);
create trigger coach_availability_updated before update on public.coach_availability
  for each row execute function public.handle_updated_at();

-- ---------- 4. time off ----------
create table public.coach_availability_exceptions (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.users (id) on delete cascade,
  start_date date not null,
  end_date date not null,
  all_day boolean not null default true,
  start_time time,
  end_time time,
  title text check (title is null or char_length(btrim(title)) between 1 and 100),
  created_at timestamptz not null default now(),
  constraint coach_exceptions_range check (end_date >= start_date and end_date - start_date <= 366),
  constraint coach_exceptions_times check (all_day = (start_time is null) and (start_time is null) = (end_time is null)),
  constraint coach_exceptions_timed check (all_day or (start_date = end_date and start_time < end_time))
);
create index coach_exceptions_coach_idx on public.coach_availability_exceptions (coach_id, end_date);

-- Only the coach reads or writes their own; the public sees slots, never these.
create or replace function public.is_coach_user()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.coach_profiles cp where cp.user_id = auth.uid());
$$;
revoke execute on function public.is_coach_user() from public, anon;
grant execute on function public.is_coach_user() to authenticated;

alter table public.coach_availability enable row level security;
alter table public.coach_availability_exceptions enable row level security;
create policy coach_availability_owner on public.coach_availability for all to authenticated
  using (coach_id = auth.uid()) with check (coach_id = auth.uid() and public.is_coach_user());
create policy coach_exceptions_owner on public.coach_availability_exceptions for all to authenticated
  using (coach_id = auth.uid()) with check (coach_id = auth.uid() and public.is_coach_user());
revoke all on table public.coach_availability from anon, authenticated;
revoke all on table public.coach_availability_exceptions from anon, authenticated;
grant select, delete on table public.coach_availability to authenticated;
grant insert (coach_id, weekday, start_time, end_time, active) on table public.coach_availability to authenticated;
grant update (weekday, start_time, end_time, active) on table public.coach_availability to authenticated;
grant select, delete on table public.coach_availability_exceptions to authenticated;
grant insert (coach_id, start_date, end_date, all_day, start_time, end_time, title)
  on table public.coach_availability_exceptions to authenticated;

-- ---------- 5. bookings ----------
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.users (id) on delete cascade,
  coach_id uuid not null references public.users (id) on delete cascade,
  service_id uuid references public.coach_services (id) on delete set null,
  -- what was booked, as it was: the service may change or go later
  service_name text not null,
  price_cents int,
  currency text,
  price_unit text,
  start_at timestamptz not null,
  end_at timestamptz not null,
  -- the coach's zone when booked: the times are shown in it
  timezone text not null,
  -- start / end widened by the service's buffers: the coach's occupied time
  block_start timestamptz not null,
  block_end timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'declined', 'cancelled', 'completed', 'no_show')),
  note text check (note is null or char_length(note) between 1 and 1000),
  cancellation_reason text check (cancellation_reason is null or char_length(cancellation_reason) between 1 and 500),
  cancelled_by uuid references public.users (id) on delete set null,
  confirmed_at timestamptz,
  resolved_at timestamptz,
  reminded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bookings_not_self check (client_id <> coach_id),
  constraint bookings_interval check (end_at > start_at),
  constraint bookings_block check (block_start <= start_at and block_end >= end_at),
  constraint bookings_no_coach_overlap exclude using gist (
    coach_id with =, tstzrange(block_start, block_end, '[)') with &&
  ) where (status in ('pending', 'confirmed')),
  constraint bookings_no_client_overlap exclude using gist (
    client_id with =, tstzrange(start_at, end_at, '[)') with &&
  ) where (status in ('pending', 'confirmed'))
);
create trigger bookings_updated before update on public.bookings
  for each row execute function public.handle_updated_at();
create index bookings_coach_start_idx on public.bookings (coach_id, start_at);
create index bookings_client_start_idx on public.bookings (client_id, start_at);
create index bookings_status_idx on public.bookings (status);
create index bookings_service_idx on public.bookings (service_id);
create index bookings_reminder_idx on public.bookings (start_at) where status = 'confirmed' and reminded_at is null;

alter table public.bookings enable row level security;
create policy bookings_select on public.bookings for select to authenticated
  using (client_id = auth.uid() or coach_id = auth.uid() or public.is_admin());
revoke all on table public.bookings from anon, authenticated;
grant select on table public.bookings to authenticated;

-- ---------- 6. slots ----------
/**
 * Every free start for one service between p_from and p_from + p_days - 1
 * (local dates in the coach's zone, at most 31): weekly blocks − time off −
 * pending / confirmed bookings (with buffers, and the coach's own bookings
 * as somebody's client) − minimum notice − maximum advance. With p_viewer,
 * also the viewer's own bookings. Internal: the public door checks who may
 * look, book_service() checks one start against it.
 */
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
    and (p_viewer is null or not exists (
          select 1 from public.bookings b
          where (b.client_id = p_viewer or b.coach_id = p_viewer) and b.status in ('pending', 'confirmed')
            and tstzrange(b.start_at, b.end_at, '[)') && tstzrange(t.s_start, t.s_end, '[)')))
  order by 1;
$$;
revoke execute on function public.booking_slots_internal(uuid, date, int, uuid) from public, anon, authenticated;

/** May this reader book this service? 'ok' or the reason why not. */
create or replace function public.booking_eligibility(p_service uuid, p_viewer uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when s.id is null or not s.active then 'SERVICE_NOT_FOUND'
    when not s.bookable or s.booking_duration_minutes is null then 'NOT_BOOKABLE'
    when u.suspended_at is not null
      or exists (select 1 from public.account_deletion_requests d where d.user_id = cp.user_id)
      or cp.status = 'suspended'
      or (p_viewer is not null and public.social_blocked_between(p_viewer, cp.user_id)) then 'COACH_NOT_FOUND'
    when s.booking_access = 'public' and cp.status <> 'published' then 'COACH_NOT_FOUND'
    when p_viewer = cp.user_id then 'CANNOT_BOOK_SELF'
    when s.booking_access = 'clients' and (p_viewer is null or not exists (
           select 1 from public.trainer_clients tc
           where tc.coach_id = cp.user_id and tc.client_id = p_viewer and tc.status = 'active')) then 'CLIENTS_ONLY'
    when not public.booking_timezone_valid(u.timezone) then 'COACH_TIMEZONE_INVALID'
    else 'ok' end
  from (select 1) one
  left join public.coach_services s on s.id = p_service
  left join public.coach_profiles cp on cp.id = s.coach_profile_id
  left join public.users u on u.id = cp.user_id;
$$;
revoke execute on function public.booking_eligibility(uuid, uuid) from public, anon, authenticated;

/**
 * The public door to slots: anyone (anon too) for a public service of a
 * visible coach, an active client for a clients-only one, the coach for
 * their own. Only free times come back — never who booked what.
 */
create or replace function public.coach_booking_slots(p_service uuid, p_from date, p_days int default 7)
returns table (start_at timestamptz, end_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare
  v_reason text := public.booking_eligibility(p_service, auth.uid());
begin
  -- the reader may book it, or it is the coach previewing their own; anyone
  -- else (a clients-only service for a non-client, a hidden coach) sees nothing
  if v_reason in ('ok', 'CANNOT_BOOK_SELF') then
    return query select s.start_at, s.end_at from public.booking_slots_internal(p_service, p_from, p_days, auth.uid()) s;
  end if;
  return;
end;
$$;
revoke execute on function public.coach_booking_slots(uuid, date, int) from public;
grant execute on function public.coach_booking_slots(uuid, date, int) to anon, authenticated;

/**
 * The bookable services of a public coach page, for anyone: the settings a
 * booking screen shows (duration, who may book, instant or on approval) and
 * the coach's zone, plus whether this reader may book each one.
 * The field list is public, like coach_public_profile()'s.
 */
create or replace function public.coach_booking_services(p_slug text)
returns table (
  service_id uuid, duration_minutes int, access text, confirmation text,
  min_notice_minutes int, max_advance_days int, timezone text, can_book text
) language sql stable security definer set search_path = public as $$
  select s.id, s.booking_duration_minutes, s.booking_access, s.booking_confirmation,
         s.booking_min_notice_minutes, s.booking_max_advance_days, u.timezone,
         public.booking_eligibility(s.id, auth.uid())
  from public.coach_public_visible(p_slug) v
  join public.coach_services s on s.coach_profile_id = v.profile_id
  join public.users u on u.id = v.user_id
  where s.active and s.bookable and s.booking_duration_minutes is not null
  order by s.sort_order;
$$;
revoke execute on function public.coach_booking_services(text) from public;
grant execute on function public.coach_booking_services(text) to anon, authenticated;

-- ---------- 7. the notice ----------
alter type public.notification_category add value if not exists 'booking';

create or replace function public.booking_notify(p_recipient uuid, p_actor uuid, p_event text, p_booking uuid, p_screen text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_name text;
begin
  if not public.social_notify_ok(p_recipient, p_actor) then
    return;
  end if;
  select public.public_display_name(u.username, u.full_name) into v_name from public.users u where u.id = p_actor;
  insert into public.notifications (user_id, category, title, body, payload)
  values (p_recipient, 'booking',
          case p_event when 'requested' then 'New booking request' when 'booked' then 'New booking'
                       when 'confirmed' then 'Booking confirmed' when 'declined' then 'Booking declined'
                       when 'cancelled' then 'Booking cancelled' else 'Upcoming session' end,
          case p_event when 'requested' then v_name || ' requested a session'
                       when 'booked' then v_name || ' booked a session'
                       when 'confirmed' then v_name || ' confirmed your session'
                       when 'declined' then v_name || ' declined your session'
                       when 'cancelled' then v_name || ' cancelled a session'
                       else 'Your session with ' || v_name || ' is coming up' end,
          jsonb_build_object('booking_id', p_booking, 'actor_id', p_actor, 'event', p_event, 'screen', p_screen));
end;
$$;
revoke execute on function public.booking_notify(uuid, uuid, text, uuid, text) from public, anon, authenticated;

-- ---------- 5b. the moves ----------
/**
 * The client books one start of one service. Every rule is checked here,
 * again, whatever the screen showed: who may book, the service, the coach,
 * the zone, notice and advance, and that the start is one of the slots
 * coach_booking_slots() would return right now. Both people are locked for
 * the decision; the exclusion constraints are the last word.
 */
create or replace function public.book_service(p_service uuid, p_start_at timestamptz, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_reason text;
  v_sv public.coach_services;
  v_coach uuid;
  v_tz text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_end timestamptz;
  v_id uuid;
  v_status text;
begin
  if not public.social_actor_active()
     or not exists (select 1 from public.users u where u.id = v_user and u.username is not null) then
    raise exception 'NOT_SIGNED_IN' using errcode = '42501';
  end if;
  v_reason := public.booking_eligibility(p_service, v_user);
  if v_reason <> 'ok' then
    raise exception '%', v_reason using errcode = case when v_reason in ('SERVICE_NOT_FOUND', 'COACH_NOT_FOUND') then 'P0002'
                                                        when v_reason = 'CLIENTS_ONLY' then '42501' else '22023' end;
  end if;
  select s.* into v_sv from public.coach_services s where s.id = p_service;
  select cp.user_id, u.timezone into v_coach, v_tz
  from public.coach_profiles cp join public.users u on u.id = cp.user_id where cp.id = v_sv.coach_profile_id;

  if p_start_at is null or date_trunc('minute', p_start_at) <> p_start_at then
    raise exception 'INVALID_START' using errcode = '22023';
  end if;
  if p_start_at < now() + make_interval(mins => v_sv.booking_min_notice_minutes) then
    raise exception 'TOO_SOON' using errcode = '22023';
  end if;
  if p_start_at > now() + make_interval(days => v_sv.booking_max_advance_days) then
    raise exception 'TOO_FAR' using errcode = '22023';
  end if;
  if char_length(v_note) > 1000 then
    raise exception 'NOTE_TOO_LONG' using errcode = '22023';
  end if;
  if (select count(*) from public.bookings b where b.client_id = v_user and b.created_at > now() - interval '24 hours') >= 10 then
    raise exception 'BOOKING_RATE' using errcode = 'P0001';
  end if;

  -- one decision at a time per person, in a fixed order (no deadlock)
  perform pg_advisory_xact_lock(hashtextextended('booking:' || least(v_user, v_coach)::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('booking:' || greatest(v_user, v_coach)::text, 0));

  if not exists (
       select 1 from public.booking_slots_internal(p_service, (p_start_at at time zone v_tz)::date, 1, v_user) s
       where s.start_at = p_start_at) then
    raise exception 'SLOT_UNAVAILABLE' using errcode = '23P01';
  end if;

  v_end := p_start_at + make_interval(mins => v_sv.booking_duration_minutes);
  v_status := case when v_sv.booking_confirmation = 'instant' then 'confirmed' else 'pending' end;
  begin
    insert into public.bookings (client_id, coach_id, service_id, service_name, price_cents, currency, price_unit,
                                 start_at, end_at, timezone, block_start, block_end, status, note, confirmed_at)
    values (v_user, v_coach, p_service, v_sv.name,
            case when v_sv.price_public then v_sv.price_cents end, v_sv.currency, v_sv.price_unit,
            p_start_at, v_end, v_tz,
            p_start_at - make_interval(mins => v_sv.booking_buffer_before_minutes),
            v_end + make_interval(mins => v_sv.booking_buffer_after_minutes),
            v_status, v_note, case when v_status = 'confirmed' then now() end)
    returning id into v_id;
  exception when exclusion_violation then
    raise exception 'SLOT_UNAVAILABLE' using errcode = '23P01';
  end;
  perform public.booking_notify(v_coach, v_user, case when v_status = 'confirmed' then 'booked' else 'requested' end,
                                v_id, 'coach_bookings');
  return v_id;
end;
$$;
revoke execute on function public.book_service(uuid, timestamptz, text) from public, anon;
grant execute on function public.book_service(uuid, timestamptz, text) to authenticated;

/** The coach answers a pending booking: confirmed or declined. The client is told. */
create or replace function public.respond_booking(p_booking uuid, p_accept boolean, p_reason text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_client uuid;
  v_status text := case when coalesce(p_accept, false) then 'confirmed' else 'declined' end;
begin
  if not public.social_actor_active() then
    raise exception 'NOT_SIGNED_IN' using errcode = '42501';
  end if;
  update public.bookings
     set status = v_status,
         confirmed_at = case when v_status = 'confirmed' then now() end,
         resolved_at = case when v_status = 'declined' then now() end,
         cancellation_reason = case when v_status = 'declined' then left(nullif(btrim(coalesce(p_reason, '')), ''), 500) end
   where id = p_booking and coach_id = auth.uid() and status = 'pending'
     and (v_status = 'declined' or start_at > now())
  returning client_id into v_client;
  if v_client is null then
    raise exception 'BOOKING_NOT_PENDING' using errcode = '55000';
  end if;
  perform public.booking_notify(v_client, auth.uid(), v_status, p_booking, 'my_bookings');
  return v_status;
end;
$$;
revoke execute on function public.respond_booking(uuid, boolean, text) from public, anon;
grant execute on function public.respond_booking(uuid, boolean, text) to authenticated;

/** Either side cancels a pending or confirmed booking that has not started. The other is told. */
create or replace function public.cancel_booking(p_booking uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_row public.bookings;
begin
  if auth.uid() is null then
    raise exception 'NOT_SIGNED_IN' using errcode = '42501';
  end if;
  update public.bookings
     set status = 'cancelled', resolved_at = now(), cancelled_by = auth.uid(),
         cancellation_reason = left(nullif(btrim(coalesce(p_reason, '')), ''), 500)
   where id = p_booking and auth.uid() in (client_id, coach_id)
     and status in ('pending', 'confirmed') and start_at > now()
  returning * into v_row;
  if v_row.id is null then
    raise exception 'BOOKING_NOT_CANCELLABLE' using errcode = '55000';
  end if;
  if auth.uid() = v_row.client_id then
    perform public.booking_notify(v_row.coach_id, auth.uid(), 'cancelled', p_booking, 'coach_bookings');
  else
    perform public.booking_notify(v_row.client_id, auth.uid(), 'cancelled', p_booking, 'my_bookings');
  end if;
end;
$$;
revoke execute on function public.cancel_booking(uuid, text) from public, anon;
grant execute on function public.cancel_booking(uuid, text) to authenticated;

/** After a confirmed session has started, the coach records how it went: completed or no_show. */
create or replace function public.mark_booking(p_booking uuid, p_outcome text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_outcome is null or p_outcome not in ('completed', 'no_show') then
    raise exception 'INVALID_OUTCOME' using errcode = '22023';
  end if;
  update public.bookings set status = p_outcome, resolved_at = now()
   where id = p_booking and coach_id = auth.uid() and status = 'confirmed' and start_at <= now();
  if not found then
    raise exception 'BOOKING_NOT_MARKABLE' using errcode = '55000';
  end if;
end;
$$;
revoke execute on function public.mark_booking(uuid, text) from public, anon;
grant execute on function public.mark_booking(uuid, text) to authenticated;

-- ---------- 7b. reminders (the existing pg_cron, every 15 minutes) ----------
create or replace function public.detect_booking_reminders()
returns int language plpgsql security definer set search_path = public as $$
declare
  v_row record;
  v_count int := 0;
begin
  for v_row in
    update public.bookings b set reminded_at = now()
     where b.status = 'confirmed' and b.reminded_at is null
       and b.start_at > now() and b.start_at <= now() + interval '24 hours'
       -- just booked or just confirmed: they know already
       and coalesce(b.confirmed_at, b.created_at) < now() - interval '1 hour'
    returning b.id, b.client_id, b.coach_id
  loop
    perform public.booking_notify(v_row.client_id, v_row.coach_id, 'reminder', v_row.id, 'my_bookings');
    perform public.booking_notify(v_row.coach_id, v_row.client_id, 'reminder', v_row.id, 'coach_bookings');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke execute on function public.detect_booking_reminders() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('booking-reminders', '*/15 * * * *', $cron$ select public.detect_booking_reminders(); $cron$);
  end if;
end;
$$;

-- ---------- 8. the reads ----------
/**
 * The coach's bookings for one tab, with the client's public name and the
 * pair's existing conversation (never a new one).
 *   upcoming   pending + confirmed, not yet started, soonest first
 *   pending | confirmed | cancelled (+ declined) | completed (+ no_show)
 *   past       confirmed ones that started, waiting for an outcome
 */
create or replace function public.coach_bookings(p_scope text default 'upcoming')
returns table (
  id uuid, status text, client_id uuid, client_name text, client_avatar text,
  service_name text, start_at timestamptz, end_at timestamptz, timezone text,
  note text, cancellation_reason text, cancelled_by_me boolean,
  price_cents int, currency text, price_unit text, conversation_id uuid, created_at timestamptz
) language sql stable security definer set search_path = public as $$
  select b.id, b.status, u.id, public.public_display_name(u.username, u.full_name), u.avatar_url,
         b.service_name, b.start_at, b.end_at, b.timezone,
         b.note, b.cancellation_reason, b.cancelled_by = auth.uid(),
         b.price_cents, b.currency, b.price_unit,
         (select c.id from public.conversations c where c.coach_id = b.coach_id and c.client_id = b.client_id),
         b.created_at
  from public.bookings b
  join public.users u on u.id = b.client_id
  where b.coach_id = auth.uid()
    and case coalesce(p_scope, 'upcoming')
          when 'upcoming' then b.status in ('pending', 'confirmed') and b.start_at > now()
          when 'pending' then b.status = 'pending'
          when 'confirmed' then b.status = 'confirmed' and b.start_at > now()
          when 'past' then b.status = 'confirmed' and b.start_at <= now()
          when 'cancelled' then b.status in ('cancelled', 'declined')
          when 'completed' then b.status in ('completed', 'no_show')
          else true end
  order by case when coalesce(p_scope, 'upcoming') in ('upcoming', 'pending', 'confirmed') then b.start_at end asc,
           b.start_at desc
  limit 200;
$$;
revoke execute on function public.coach_bookings(text) from public, anon;
grant execute on function public.coach_bookings(text) to authenticated;

/** The reader's own bookings as a client, every state, with the coach's public name and page. */
create or replace function public.my_bookings()
returns table (
  id uuid, status text, coach_id uuid, coach_name text, coach_slug text, coach_avatar text,
  service_name text, start_at timestamptz, end_at timestamptz, timezone text,
  note text, cancellation_reason text, cancelled_by_me boolean,
  price_cents int, currency text, price_unit text, conversation_id uuid, created_at timestamptz
) language sql stable security definer set search_path = public as $$
  select b.id, b.status, u.id, public.public_display_name(u.username, u.full_name),
         case when cp.status = 'published' then cp.slug end, u.avatar_url,
         b.service_name, b.start_at, b.end_at, b.timezone,
         b.note, b.cancellation_reason, b.cancelled_by = auth.uid(),
         b.price_cents, b.currency, b.price_unit,
         (select c.id from public.conversations c where c.coach_id = b.coach_id and c.client_id = b.client_id),
         b.created_at
  from public.bookings b
  join public.users u on u.id = b.coach_id
  left join public.coach_profiles cp on cp.user_id = b.coach_id
  where b.client_id = auth.uid()
  order by (b.status in ('pending', 'confirmed') and b.start_at > now()) desc, b.start_at asc
  limit 200;
$$;
revoke execute on function public.my_bookings() from public, anon;
grant execute on function public.my_bookings() to authenticated;

-- /coaches/bookings is the client's page: "bookings" is a reserved coach slug too
create or replace function public.coach_slug_reserved(p_slug text)
returns boolean language sql stable security definer set search_path = public as $$
  select p_slug = any (array[
           'online', 'in-person', 'near-me', 'search', 'new', 'edit', 'top', 'all',
           'apply', 'become-a-coach', 'city', 'cities', 'country', 'countries',
           'specialization', 'specializations', 'services', 'verified', 'saved', 'requests',
           'bookings', 'book'])
      or exists (select 1 from public.cities c where c.slug = p_slug)
      or exists (select 1 from public.countries c where c.slug = p_slug)
      or exists (select 1 from public.specializations s where s.slug = p_slug);
$$;
