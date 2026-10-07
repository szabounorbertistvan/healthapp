-- HealthApp schema · marketplace analytics & conversion tracking (first party, minimal)
--
-- There was no analytics infrastructure to reuse: the app sets only the
-- auth session cookie, the privacy page says there is no tracking, and
-- coach_marketplace_overview (20261108100000) deliberately counted only rows
-- that exist. This adds the smallest event log that answers "where do people
-- find coaches, and where do they convert?" — and nothing more.
--
-- Privacy, by construction:
--   * No cookie, no localStorage, nothing stored on the visitor's device —
--     so the cookie notice stays a notice (no consent wall is needed for
--     something that does not exist). A visitor is a daily-rotating hash:
--     sha256(today's random salt | IP | user agent), cut to 32 hex. The salt
--     lives only in marketplace_salts, is never readable from the app, and
--     is deleted the day after; the IP and user agent are never stored. The
--     same person tomorrow is a different visitor: we count visitor-days, we
--     never follow anyone, and nobody can be re-identified from the table.
--   * The hash is computed HERE, from the headers PostgREST hands the
--     database (cf-connecting-ip / x-real-ip / x-forwarded-for, user-agent),
--     so a caller cannot choose their own visitor id. The browser calls the
--     RPC directly (the web app has no service key), so these are the
--     visitor's headers.
--   * Events carry no user id, no message, no health data, no free text.
--     Context is a coach profile id, a city or specialization slug (checked
--     against the catalog), and a source / medium / campaign (lower-case
--     [a-z0-9_.-], capped).
--   * Signup attribution (marketplace_signups) is the one per-user row: which
--     coach page and source an account came from. It is deleted with the
--     account and after two years.
--
-- Business conversions are written by triggers on the tables that ARE the
-- business (coaching_requests, trainer_clients, bookings, coach_reviews,
-- coach_saves) — never by the browser — so they cannot be faked or
-- double-counted (dedupe key = the row). Dashboards count business totals
-- from those tables directly; the events only add what the tables cannot
-- know: views, clicks, and where the person came from.
--
-- Anti-abuse: client events are a closed list; profile events need a coach
-- the public page would show; your own profile is not counted; known bots
-- and agent-less requests are ignored; one event per visitor, event, target
-- and day (unique dedupe key); 60 events per visitor per hour.
--
-- Retention (marketplace_retention, daily): anonymous views and clicks 180
-- days, signups and conversions 2 years, salts 1 day.

-- ---------- tables ----------
create table public.marketplace_salts (
  day date primary key,
  salt text not null default (gen_random_uuid()::text || gen_random_uuid()::text)
);
alter table public.marketplace_salts enable row level security;
revoke all on table public.marketplace_salts from anon, authenticated;

create table public.marketplace_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  event text not null check (event in (
    -- written by the browser through marketplace_track()
    'directory_view', 'profile_view', 'cta_contact', 'cta_book', 'cta_save', 'cta_full_profile', 'signup_started',
    -- written by the database itself
    'signup_completed', 'request_sent', 'request_accepted', 'coaching_started',
    'booking_created', 'booking_completed', 'review_submitted', 'coach_saved')),
  coach_profile_id uuid references public.coach_profiles (id) on delete cascade,
  visitor text check (visitor is null or visitor ~ '^[0-9a-f]{32}$'),
  signed_in boolean not null default false,
  source text check (source is null or source ~ '^[a-z0-9_.-]{1,40}$'),
  medium text check (medium is null or medium ~ '^[a-z0-9_.-]{1,40}$'),
  campaign text check (campaign is null or campaign ~ '^[a-z0-9_.-]{1,80}$'),
  city text check (city is null or char_length(city) <= 60),
  specialization text check (specialization is null or char_length(specialization) <= 60),
  dedupe_key text check (dedupe_key is null or char_length(dedupe_key) <= 200)
);
create unique index marketplace_events_dedupe on public.marketplace_events (dedupe_key) where dedupe_key is not null;
create index marketplace_events_coach_idx on public.marketplace_events (coach_profile_id, event, created_at)
  where coach_profile_id is not null;
create index marketplace_events_event_idx on public.marketplace_events (event, created_at);
create index marketplace_events_visitor_idx on public.marketplace_events (visitor, created_at) where visitor is not null;
alter table public.marketplace_events enable row level security;
revoke all on table public.marketplace_events from anon, authenticated;
comment on table public.marketplace_events is
  'First-party marketplace funnel events. No user id, no PII: visitor is a daily-rotating salted hash. Written only by marketplace_track() and triggers; read only through aggregate RPCs.';

create table public.marketplace_signups (
  user_id uuid primary key references public.users (id) on delete cascade,
  coach_profile_id uuid references public.coach_profiles (id) on delete set null,
  source text check (source is null or source ~ '^[a-z0-9_.-]{1,40}$'),
  medium text check (medium is null or medium ~ '^[a-z0-9_.-]{1,40}$'),
  campaign text check (campaign is null or campaign ~ '^[a-z0-9_.-]{1,80}$'),
  created_at timestamptz not null default now()
);
alter table public.marketplace_signups enable row level security;
revoke all on table public.marketplace_signups from anon, authenticated;

-- ---------- helpers ----------
/** A source / medium / campaign as stored: lower case, [a-z0-9_.-] only, capped; blank is null. */
create or replace function public.marketplace_clean(p text, p_max int)
returns text language sql immutable set search_path = public as $$
  select nullif(left(regexp_replace(lower(btrim(coalesce(p, ''))), '[^a-z0-9_.-]+', '', 'g'), p_max), '');
$$;

/** The request's user agent, as PostgREST passes it; null outside a request. */
create or replace function public.marketplace_user_agent()
returns text language sql stable set search_path = public as $$
  select nullif(coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb ->> 'user-agent', '');
$$;

/** Crawlers, previews, scripts — and anything that sends no user agent — are not visitors. */
create or replace function public.marketplace_is_bot(p_ua text)
returns boolean language sql immutable set search_path = public as $$
  select p_ua is null or p_ua ~* '(bot|crawl|spider|slurp|facebookexternalhit|embedly|preview|monitor|lighthouse|curl|wget|python-requests|httpclient|go-http|okhttp|java/)';
$$;

/**
 * Today's visitor id: sha256(salt | ip | user agent), 32 hex. The salt is
 * created on the day's first event and deleted the day after, so nothing
 * links one day's visitor to the next, and the inputs are never stored.
 */
create or replace function public.marketplace_visitor()
returns text language plpgsql volatile security definer set search_path = public as $$
declare
  v_h jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  v_ip text := coalesce(v_h ->> 'cf-connecting-ip', v_h ->> 'x-real-ip', btrim(split_part(coalesce(v_h ->> 'x-forwarded-for', ''), ',', 1)));
  v_salt text;
begin
  insert into public.marketplace_salts (day) values (current_date) on conflict (day) do nothing;
  select s.salt into v_salt from public.marketplace_salts s where s.day = current_date;
  return left(encode(sha256(convert_to(v_salt || '|' || coalesce(v_ip, '') || '|' || coalesce(v_h ->> 'user-agent', ''), 'UTF8')), 'hex'), 32);
end;
$$;
revoke execute on function public.marketplace_visitor() from public, anon, authenticated;

-- ---------- the browser's one door ----------
/**
 * Record a view or a click. Returns whether it was counted (false for a
 * bot, your own profile, a coach the public cannot see, a repeat today, or
 * past the hourly cap) — never an error for those, so a beacon is silent.
 * An unknown event is an error: that is a programming mistake.
 */
create or replace function public.marketplace_track(
  p_event text, p_slug text default null, p_source text default null, p_medium text default null,
  p_campaign text default null, p_city text default null, p_specialization text default null
) returns boolean language plpgsql volatile security definer set search_path = public as $$
declare
  v_profile uuid;
  v_coach uuid;
  v_visitor text;
  v_city text;
  v_spec text;
  v_n int;
begin
  if p_event is null or p_event not in ('directory_view', 'profile_view', 'cta_contact', 'cta_book', 'cta_save',
                                        'cta_full_profile', 'signup_started') then
    raise exception 'UNKNOWN_EVENT' using errcode = '22023';
  end if;
  if public.marketplace_is_bot(public.marketplace_user_agent()) then
    return false;
  end if;

  if p_event <> 'directory_view' then
    select v.profile_id, v.user_id into v_profile, v_coach from public.coach_public_visible(p_slug) v;
    if v_profile is null or v_coach = auth.uid() then
      return false;
    end if;
  else
    select c.slug into v_city from public.cities c where c.slug = lower(btrim(coalesce(p_city, '')));
    select s.slug into v_spec from public.specializations s where s.slug = lower(btrim(coalesce(p_specialization, '')));
  end if;

  v_visitor := public.marketplace_visitor();
  select count(*) into v_n from public.marketplace_events e
   where e.visitor = v_visitor and e.created_at > now() - interval '1 hour';
  if v_n >= 60 then
    return false;
  end if;

  insert into public.marketplace_events (event, coach_profile_id, visitor, signed_in, source, medium, campaign,
                                         city, specialization, dedupe_key)
  values (p_event, v_profile, v_visitor, auth.uid() is not null,
          public.marketplace_clean(p_source, 40), public.marketplace_clean(p_medium, 40), public.marketplace_clean(p_campaign, 80),
          v_city, v_spec,
          p_event || ':' || coalesce(v_profile::text, coalesce(v_city, '') || '/' || coalesce(v_spec, '')) || ':' || v_visitor || ':' || current_date)
  on conflict (dedupe_key) where dedupe_key is not null do nothing;
  return found;
end;
$$;
revoke execute on function public.marketplace_track(text, text, text, text, text, text, text) from public;
grant execute on function public.marketplace_track(text, text, text, text, text, text, text) to anon, authenticated;

-- ---------- the database's own events ----------
/**
 * A conversion, once (the dedupe key names the business row), attributed to
 * where the person's account came from. Never fails the write it rides on:
 * analytics must not be able to break a booking.
 */
create or replace function public.marketplace_record(p_event text, p_profile uuid, p_subject uuid, p_dedupe text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_su public.marketplace_signups;
begin
  if p_profile is null then
    return;
  end if;
  select * into v_su from public.marketplace_signups s where s.user_id = p_subject;
  insert into public.marketplace_events (event, coach_profile_id, signed_in, source, medium, campaign, dedupe_key)
  values (p_event, p_profile, true, v_su.source, v_su.medium, v_su.campaign, p_dedupe)
  on conflict (dedupe_key) where dedupe_key is not null do nothing;
exception when others then
  return;
end;
$$;
revoke execute on function public.marketplace_record(text, uuid, uuid, text) from public, anon, authenticated;

create or replace function public.marketplace_profile_of(p_coach uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select cp.id from public.coach_profiles cp where cp.user_id = p_coach;
$$;
revoke execute on function public.marketplace_profile_of(uuid) from public, anon, authenticated;

create or replace function public.marketplace_requests_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.marketplace_record('request_sent', public.marketplace_profile_of(new.coach_id), new.client_id, 'request_sent:' || new.id);
  elsif new.status = 'accepted' and old.status is distinct from 'accepted' then
    perform public.marketplace_record('request_accepted', public.marketplace_profile_of(new.coach_id), new.client_id, 'request_accepted:' || new.id);
  end if;
  return null;
end;
$$;
create trigger coaching_requests_marketplace after insert or update of status on public.coaching_requests
  for each row execute function public.marketplace_requests_event();

-- a start, not a resume: invited → active, or a row born active
create or replace function public.marketplace_coaching_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'active' and new.client_id is not null and (tg_op = 'INSERT' or old.status = 'invited') then
    perform public.marketplace_record('coaching_started', public.marketplace_profile_of(new.coach_id), new.client_id, 'coaching_started:' || new.id);
  end if;
  return null;
end;
$$;
create trigger trainer_clients_marketplace after insert or update of status on public.trainer_clients
  for each row execute function public.marketplace_coaching_event();

create or replace function public.marketplace_bookings_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.marketplace_record('booking_created', public.marketplace_profile_of(new.coach_id), new.client_id, 'booking_created:' || new.id);
  elsif new.status = 'completed' and old.status is distinct from 'completed' then
    perform public.marketplace_record('booking_completed', public.marketplace_profile_of(new.coach_id), new.client_id, 'booking_completed:' || new.id);
  end if;
  return null;
end;
$$;
create trigger bookings_marketplace after insert or update of status on public.bookings
  for each row execute function public.marketplace_bookings_event();

create or replace function public.marketplace_reviews_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.marketplace_record('review_submitted', public.marketplace_profile_of(new.coach_id), new.reviewer_id, 'review_submitted:' || new.id);
  return null;
end;
$$;
create trigger coach_reviews_marketplace after insert on public.coach_reviews
  for each row execute function public.marketplace_reviews_event();

-- a save counts once per person and coach, however often it is toggled
create or replace function public.marketplace_saves_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.marketplace_record('coach_saved', new.coach_profile_id, new.user_id, 'coach_saved:' || new.user_id || ':' || new.coach_profile_id);
  return null;
end;
$$;
create trigger coach_saves_marketplace after insert on public.coach_saves
  for each row execute function public.marketplace_saves_event();

-- ---------- signup attribution ----------
/**
 * The sign-up form (components/login-form.tsx) sends signup_ref — the coach
 * page the person signed up from and the source it carried — as user
 * metadata. Runs after handle_new_user (trigger names sort), so the users row
 * exists. Anything malformed is dropped; a failure never blocks a signup.
 */
create or replace function public.marketplace_signup_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_ref jsonb := new.raw_user_meta_data -> 'signup_ref';
  v_profile uuid;
  v_source text;
  v_medium text;
  v_campaign text;
begin
  if v_ref is null or jsonb_typeof(v_ref) <> 'object' then
    return new;
  end if;
  begin
    select cp.id into v_profile from public.coach_profiles cp
     where cp.slug = lower(btrim(coalesce(v_ref ->> 'coach', ''))) and cp.status = 'published';
    v_source := public.marketplace_clean(v_ref ->> 'source', 40);
    v_medium := public.marketplace_clean(v_ref ->> 'medium', 40);
    v_campaign := public.marketplace_clean(v_ref ->> 'campaign', 80);
    if v_profile is null and v_source is null then
      return new;
    end if;
    insert into public.marketplace_signups (user_id, coach_profile_id, source, medium, campaign)
    values (new.id, v_profile, v_source, v_medium, v_campaign)
    on conflict (user_id) do nothing;
    insert into public.marketplace_events (event, coach_profile_id, signed_in, source, medium, campaign, dedupe_key)
    values ('signup_completed', v_profile, false, v_source, v_medium, v_campaign, 'signup_completed:' || new.id)
    on conflict (dedupe_key) where dedupe_key is not null do nothing;
  exception when others then
    return new;
  end;
  return new;
end;
$$;
create trigger on_auth_user_created_marketplace
  after insert on auth.users
  for each row execute function public.marketplace_signup_event();

-- ---------- retention ----------
create or replace function public.marketplace_retention()
returns void language sql security definer set search_path = public as $$
  delete from public.marketplace_events
   where created_at < now() - interval '180 days'
     and event in ('directory_view', 'profile_view', 'cta_contact', 'cta_book', 'cta_save', 'cta_full_profile', 'signup_started');
  delete from public.marketplace_events where created_at < now() - interval '730 days';
  delete from public.marketplace_signups where created_at < now() - interval '730 days';
  delete from public.marketplace_salts where day < current_date;
$$;
revoke execute on function public.marketplace_retention() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('marketplace-retention', '17 3 * * *', $cron$ select public.marketplace_retention(); $cron$);
  end if;
end;
$$;

-- ---------- reads: the coach's own ----------
/**
 * The signed-in coach's marketplace performance over the last p_days (7..180).
 * Business counts come from the business tables; views and clicks from the
 * event log, with tracking_since so the screen can say since when (and show
 * nothing when there is nothing yet). No conversion rate is computed here.
 */
create or replace function public.coach_marketplace_analytics(p_days int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_cp public.coach_profiles;
  v_days int := greatest(7, least(coalesce(p_days, 30), 180));
  v_from timestamptz := now() - make_interval(days => greatest(7, least(coalesce(p_days, 30), 180)));
begin
  select * into v_cp from public.coach_profiles where user_id = auth.uid();
  if v_cp.id is null then
    return null;
  end if;
  return jsonb_build_object(
    'window_days', v_days,
    'tracking_since', (select min(e.created_at) from public.marketplace_events e),
    'profile_views', (select count(*) from public.marketplace_events e
                       where e.coach_profile_id = v_cp.id and e.event = 'profile_view' and e.created_at >= v_from),
    'contact_clicks', (select count(*) from public.marketplace_events e
                        where e.coach_profile_id = v_cp.id and e.event = 'cta_contact' and e.created_at >= v_from),
    'book_clicks', (select count(*) from public.marketplace_events e
                     where e.coach_profile_id = v_cp.id and e.event = 'cta_book' and e.created_at >= v_from),
    'signups', (select count(*) from public.marketplace_events e
                 where e.coach_profile_id = v_cp.id and e.event = 'signup_completed' and e.created_at >= v_from),
    'saves', (select count(*) from public.coach_saves s where s.coach_profile_id = v_cp.id and s.created_at >= v_from),
    'saves_total', (select count(*) from public.coach_saves s where s.coach_profile_id = v_cp.id),
    'requests', (select count(*) from public.coaching_requests r where r.coach_id = v_cp.user_id and r.created_at >= v_from),
    'requests_accepted', (select count(*) from public.coaching_requests r
                           where r.coach_id = v_cp.user_id and r.created_at >= v_from and r.status = 'accepted'),
    'bookings', (select count(*) from public.bookings b where b.coach_id = v_cp.user_id and b.created_at >= v_from),
    'bookings_completed', (select count(*) from public.bookings b
                            where b.coach_id = v_cp.user_id and b.status = 'completed' and b.end_at >= v_from),
    'review_count', v_cp.review_count,
    'review_avg', v_cp.review_avg,
    'sources', coalesce((select jsonb_agg(jsonb_build_object('source', x.source, 'n', x.n) order by x.n desc, x.source)
                           from (select coalesce(e.source, 'direct') as source, count(*)::int as n
                                   from public.marketplace_events e
                                  where e.coach_profile_id = v_cp.id and e.event = 'profile_view' and e.created_at >= v_from
                                  group by 1 order by 2 desc limit 6) x), '[]'::jsonb));
end;
$$;
revoke execute on function public.coach_marketplace_analytics(int) from public, anon;
grant execute on function public.coach_marketplace_analytics(int) to authenticated;

-- ---------- reads: the admin's aggregate ----------
/**
 * The marketplace at a glance for /admin/marketplace: totals now, the last
 * 30 days, a weekly series over p_weeks (4..26), the event funnel and the
 * sources. Business numbers from the business tables; views, clicks and
 * signups from the event log (which starts at tracking_since).
 */
create or replace function public.admin_marketplace_analytics(p_weeks int default 12)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_weeks int := greatest(4, least(coalesce(p_weeks, 12), 26));
  v_from timestamptz := now() - interval '30 days';
  v_start date;
begin
  perform public.admin_assert();
  v_start := (date_trunc('week', now()) - make_interval(weeks => v_weeks - 1))::date;
  return jsonb_build_object(
    'tracking_since', (select min(e.created_at) from public.marketplace_events e),
    'coaches', (
      select jsonb_build_object(
        'public', count(*),
        'verified', count(*) filter (where cp.verification_status = 'verified'),
        'accepting', count(*) filter (where cp.accepting_clients),
        'active', count(*) filter (where exists (select 1 from public.trainer_clients tc
                                                  where tc.coach_id = cp.user_id and tc.status in ('active', 'paused'))))
      from public.coach_profiles cp join public.users u on u.id = cp.user_id
      where cp.status = 'published' and u.suspended_at is null
        and not exists (select 1 from public.account_deletion_requests d where d.user_id = cp.user_id)),
    'last30', jsonb_build_object(
      'directory_views', (select count(*) from public.marketplace_events e where e.event = 'directory_view' and e.created_at >= v_from),
      'profile_views', (select count(*) from public.marketplace_events e where e.event = 'profile_view' and e.created_at >= v_from),
      'signups', (select count(*) from public.marketplace_events e where e.event = 'signup_completed' and e.created_at >= v_from),
      'signups_from_profile', (select count(*) from public.marketplace_events e
                                where e.event = 'signup_completed' and e.coach_profile_id is not null and e.created_at >= v_from),
      'requests', (select count(*) from public.coaching_requests r where r.created_at >= v_from),
      'requests_accepted', (select count(*) from public.coaching_requests r where r.created_at >= v_from and r.status = 'accepted'),
      'bookings', (select count(*) from public.bookings b where b.created_at >= v_from),
      'bookings_completed', (select count(*) from public.bookings b where b.status = 'completed' and b.end_at >= v_from),
      'coaching_started', (select count(*) from public.trainer_clients tc where tc.started_at >= v_from),
      'relationships_ended', (select count(*) from public.trainer_clients tc where tc.status = 'ended' and tc.ended_at >= v_from),
      'reviews', (select count(*) from public.coach_reviews r where r.created_at >= v_from and r.status <> 'deleted')),
    'weekly', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'week', w.wk,
               'profile_views', (select count(*) from public.marketplace_events e
                                  where e.event = 'profile_view' and e.created_at >= w.wk and e.created_at < w.wk + 7),
               'signups', (select count(*) from public.marketplace_events e
                            where e.event = 'signup_completed' and e.created_at >= w.wk and e.created_at < w.wk + 7),
               'requests', (select count(*) from public.coaching_requests r where r.created_at >= w.wk and r.created_at < w.wk + 7),
               'bookings', (select count(*) from public.bookings b where b.created_at >= w.wk and b.created_at < w.wk + 7),
               'coaching_started', (select count(*) from public.trainer_clients tc
                                     where tc.started_at >= w.wk and tc.started_at < w.wk + 7),
               'reviews', (select count(*) from public.coach_reviews r
                            where r.created_at >= w.wk and r.created_at < w.wk + 7 and r.status <> 'deleted'))
             order by w.wk), '[]'::jsonb)
      from (select generate_series(v_start, current_date, interval '7 days')::date as wk) w),
    'funnel', (
      select jsonb_object_agg(f.event, f.n)
      from (select ev.event, (select count(*) from public.marketplace_events e
                               where e.event = ev.event and e.created_at >= v_from)::int as n
              from unnest(array['directory_view', 'profile_view', 'cta_contact', 'cta_book', 'cta_save', 'cta_full_profile',
                                'signup_started', 'signup_completed', 'request_sent', 'request_accepted', 'coaching_started',
                                'booking_created', 'booking_completed', 'review_submitted', 'coach_saved']) as ev(event)) f),
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object('source', x.source, 'views', x.views, 'signups', x.signups, 'requests', x.requests)
                       order by x.views desc, x.source)
      from (select coalesce(e.source, 'direct') as source,
                   count(*) filter (where e.event = 'profile_view')::int as views,
                   count(*) filter (where e.event = 'signup_completed')::int as signups,
                   count(*) filter (where e.event = 'request_sent')::int as requests
              from public.marketplace_events e
             where e.created_at >= v_from and e.event in ('profile_view', 'signup_completed', 'request_sent')
             group by 1 order by 2 desc limit 10) x), '[]'::jsonb));
end;
$$;
revoke execute on function public.admin_marketplace_analytics(int) from public, anon;
grant execute on function public.admin_marketplace_analytics(int) to authenticated;
