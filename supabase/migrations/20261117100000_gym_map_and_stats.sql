-- HealthApp schema · gyms: where a workout happened, gym tops, gym stats, the map
--
-- 1. GOOGLE PLACE DATA ON A GYM. Rating, hours (and "open now"), status,
--    phone, website, place types, a short summary, parking / accessibility /
--    payment options and one photo — from Google Places (New), parsed in SQL
--    by gym_apply_google(). Written by the admin's form (server-side fetch,
--    GOOGLE_PLACES_API_KEY) and refreshed monthly by pg_cron + pg_net with the
--    key in Vault, since Google's terms allow keeping only the place id.
--
-- 2. WHERE A WORKOUT HAPPENED. logged_sessions.gym_id — optional, chosen on
--    the "workout done" screen (home gym first, any listed gym, or a
--    suggestion that waits for an admin). The owner writes it like any other
--    column of their session (sessions_owner); a trigger accepts only an
--    active gym, so nothing points at a pending suggestion.
--
-- 3. GYM TOPS. gym_tops() ranks gyms against each other — workouts, people
--    who trained there, volume (period) or members (home gym, now). Numbers
--    about a gym are numbers about the people in it, so a gym is ranked, and
--    its stats are shown, only once at least K_ANON (3) different people
--    are behind them: one person's training never shows up as "the gym's".
--    Suspended and deleting accounts are not counted.
--
-- 4. GYM STATS. gym_stats(gym): members, coaches, this week / this month,
--    busiest hours and weekdays (last 30 days, Bucharest time), its place in
--    the month's workouts top, and the caller's own count there.
--
-- 5. THE MAP. gyms_map(): every active gym with coordinates and the few
--    numbers a pin shows. Unpaged — the table is a curated list.

-- ============================================================================
-- 1. Google place data
-- ============================================================================
-- Everything Google said about a gym lives in these columns, parsed in ONE
-- place — gym_apply_google() below — from Google's own Places (New) JSON,
-- whether it came from the admin's form (admin_set_gym_google) or from the
-- monthly refresh (gym_google_refresh_*). Google's terms let us keep only the
-- place id for good; the rest is refreshed every month and shown as Google's.
alter table public.gyms
  add column google_rating numeric(2, 1) check (google_rating is null or google_rating between 0 and 5),
  add column google_ratings_total int check (google_ratings_total is null or google_ratings_total >= 0),
  -- weekdayDescriptions: up to seven readable lines, in Romanian
  add column opening_hours jsonb check (opening_hours is null or jsonb_typeof(opening_hours) = 'array'),
  -- periods: [{open:{day,hour,minute}, close:{…}}], day 0 = Sunday — the app works out "open now"
  add column opening_periods jsonb check (opening_periods is null or jsonb_typeof(opening_periods) = 'array'),
  add column google_business_status text check (google_business_status is null or length(google_business_status) <= 40),
  add column phone text check (phone is null or length(phone) <= 40),
  add column website text check (website is null or (length(website) <= 500 and website ~ '^https?://')),
  add column place_types text[] check (place_types is null or cardinality(place_types) <= 30),
  add column primary_type text check (primary_type is null or length(primary_type) <= 60),
  add column summary text check (summary is null or length(summary) <= 500),
  -- booleans as Google gives them: {"freeParkingLot": true, …}
  add column parking jsonb check (parking is null or jsonb_typeof(parking) = 'object'),
  add column accessibility jsonb check (accessibility is null or jsonb_typeof(accessibility) = 'object'),
  add column payment jsonb check (payment is null or jsonb_typeof(payment) = 'object'),
  -- the first photo's resource name (served through /api/gyms/[id]/photo) and its author
  add column photo_name text check (photo_name is null or (length(photo_name) <= 500 and photo_name ~ '^places/[A-Za-z0-9_-]+/photos/[A-Za-z0-9_-]+$')),
  add column photo_attribution text check (photo_attribution is null or length(photo_attribution) <= 120),
  add column google_refreshed_at timestamptz;

-- A jsonb object of booleans only (Google's option blocks), else null.
create or replace function public.gym_bool_object(p jsonb)
returns jsonb language sql immutable set search_path = public as $$
  select case when jsonb_typeof(p) = 'object' then
    (select jsonb_object_agg(k, v) from jsonb_each(p) e(k, v) where jsonb_typeof(v) = 'boolean' and length(k) <= 60)
  end;
$$;
revoke execute on function public.gym_bool_object(jsonb) from public, anon;

/**
 * Store one Places (New) "place" object on a gym. p_place null clears every
 * Google field. Internal: admin_set_gym_google() and the monthly refresh are
 * its only callers. Fields Google left out become null — what it no longer
 * says, we no longer show.
 */
create or replace function public.gym_apply_google(p_gym uuid, p_place jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_id text := p_place ->> 'id';
  v_web text := p_place ->> 'websiteUri';
  v_photo text := p_place #>> '{photos,0,name}';
begin
  if p_place is not null and (v_id is null or length(v_id) > 300 or v_id !~ '^[A-Za-z0-9_-]+$') then
    raise exception 'GYM_PLACE' using errcode = '22023';
  end if;
  update public.gyms set
    google_place_id = v_id,
    google_rating = round((p_place ->> 'rating')::numeric, 1),
    google_ratings_total = (p_place ->> 'userRatingCount')::int,
    opening_hours = (select jsonb_agg(left(h #>> '{}', 120))
                     from jsonb_array_elements(case when jsonb_typeof(p_place #> '{regularOpeningHours,weekdayDescriptions}') = 'array'
                                                    then p_place #> '{regularOpeningHours,weekdayDescriptions}' else '[]' end) with ordinality x(h, i)
                     where i <= 7 and jsonb_typeof(h) = 'string'),
    opening_periods = case when jsonb_typeof(p_place #> '{regularOpeningHours,periods}') = 'array'
                           and jsonb_array_length(p_place #> '{regularOpeningHours,periods}') <= 28
                           then p_place #> '{regularOpeningHours,periods}' end,
    google_business_status = left(p_place ->> 'businessStatus', 40),
    phone = left(coalesce(p_place ->> 'nationalPhoneNumber', p_place ->> 'internationalPhoneNumber'), 40),
    website = case when v_web ~ '^https?://' and length(v_web) <= 500 then v_web end,
    place_types = (select array_agg(left(t #>> '{}', 60))
                   from jsonb_array_elements(case when jsonb_typeof(p_place -> 'types') = 'array' then p_place -> 'types' else '[]' end)
                        with ordinality x(t, i)
                   where i <= 30),
    primary_type = left(p_place ->> 'primaryType', 60),
    summary = left(p_place #>> '{editorialSummary,text}', 500),
    parking = public.gym_bool_object(p_place -> 'parkingOptions'),
    accessibility = public.gym_bool_object(p_place -> 'accessibilityOptions'),
    payment = public.gym_bool_object(p_place -> 'paymentOptions'),
    photo_name = case when v_photo ~ '^places/[A-Za-z0-9_-]+/photos/[A-Za-z0-9_-]+$' and length(v_photo) <= 500 then v_photo end,
    photo_attribution = left(p_place #>> '{photos,0,authorAttributions,0,displayName}', 120),
    google_refreshed_at = case when p_place is null then null else now() end
  where id = p_gym;
  if not found then
    raise exception 'GYM_NOT_FOUND' using errcode = 'P0002';
  end if;
end;
$$;
revoke execute on function public.gym_apply_google(uuid, jsonb) from public, anon, authenticated;

/** The admin stores (or, with null, clears) what Google said about a gym. */
create or replace function public.admin_set_gym_google(p_id uuid, p_place jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_name text;
begin
  perform public.admin_assert();
  if p_place is not null and jsonb_typeof(p_place) <> 'object' then
    raise exception 'GYM_PLACE' using errcode = '22023';
  end if;
  perform public.gym_apply_google(p_id, p_place);
  select name into v_name from public.gyms where id = p_id;
  perform public.audit_log('ADMIN_ACTION', 'gym', p_id::text, null,
    jsonb_build_object('kind', 'gym_google', 'name', v_name, 'linked', p_place is not null));
end;
$$;
revoke execute on function public.admin_set_gym_google(uuid, jsonb) from public, anon;
grant execute on function public.admin_set_gym_google(uuid, jsonb) to authenticated;

-- ---------- the monthly refresh (pg_cron + pg_net, like the email tick) ----------
-- The key is a Vault secret, set once by hand (never in a migration):
--   select vault.create_secret('<GOOGLE_PLACES_API_KEY>', 'google_places_api_key');
-- Without it both jobs do nothing. Request: one Place Details call per gym
-- not refreshed for 25 days (at most 200 a run); collect: a later job reads
-- the answers pg_net stored and applies them through gym_apply_google().
create table public.gym_google_refresh (
  request_id bigint primary key,
  gym_id uuid not null references public.gyms (id) on delete cascade,
  requested_at timestamptz not null default now()
);
alter table public.gym_google_refresh enable row level security;
revoke all on table public.gym_google_refresh from public, anon, authenticated;

-- One field list for the form and the refresh (lib/google-places.ts mirrors it).
create or replace function public.gym_google_field_mask()
returns text language sql immutable as $$
  select 'id,displayName,formattedAddress,location,rating,userRatingCount,'
      || 'regularOpeningHours.weekdayDescriptions,regularOpeningHours.periods,businessStatus,googleMapsUri,'
      || 'nationalPhoneNumber,internationalPhoneNumber,websiteUri,types,primaryType,editorialSummary,'
      || 'photos,parkingOptions,accessibilityOptions,paymentOptions';
$$;

create or replace function public.gym_google_refresh_request()
returns int language plpgsql security definer set search_path = public as $$
declare
  v_key text;
  v_gym record;
  v_req bigint;
  v_n int := 0;
begin
  begin
    select decrypted_secret into v_key from vault.decrypted_secrets where name = 'google_places_api_key';
  exception when others then
    return 0;
  end;
  if v_key is null then
    return 0;
  end if;
  for v_gym in
    select g.id, g.google_place_id from public.gyms g
    where g.status = 'active' and g.google_place_id is not null
      and (g.google_refreshed_at is null or g.google_refreshed_at < now() - interval '25 days')
      and not exists (select 1 from public.gym_google_refresh r where r.gym_id = g.id)
    order by g.google_refreshed_at nulls first
    limit 200
  loop
    begin
      v_req := net.http_get(
        url := 'https://places.googleapis.com/v1/places/' || v_gym.google_place_id || '?languageCode=ro',
        headers := jsonb_build_object('X-Goog-Api-Key', v_key, 'X-Goog-FieldMask', public.gym_google_field_mask()),
        timeout_milliseconds := 10000
      );
      insert into public.gym_google_refresh (request_id, gym_id) values (v_req, v_gym.id);
      v_n := v_n + 1;
    exception when others then
      raise notice 'gym_google_refresh_request: http_get unavailable (%)', sqlerrm;
      return v_n;
    end;
  end loop;
  return v_n;
end;
$$;
revoke execute on function public.gym_google_refresh_request() from public, anon, authenticated;

create or replace function public.gym_google_refresh_collect()
returns int language plpgsql security definer set search_path = public as $$
declare
  v_row record;
  v_n int := 0;
begin
  for v_row in
    execute $q$
      select r.request_id, r.gym_id, h.status_code, h.content
      from public.gym_google_refresh r
      join net._http_response h on h.id = r.request_id
    $q$
  loop
    begin
      if v_row.status_code = 200 then
        perform public.gym_apply_google(v_row.gym_id, v_row.content::jsonb);
        v_n := v_n + 1;
      elsif v_row.status_code = 404 then
        -- Google no longer knows the place: keep the link, say so.
        update public.gyms set google_business_status = 'NOT_FOUND', google_refreshed_at = now() where id = v_row.gym_id;
      end if;
    exception when others then
      raise notice 'gym_google_refresh_collect: gym % not applied (%)', v_row.gym_id, sqlerrm;
    end;
    delete from public.gym_google_refresh where request_id = v_row.request_id;
  end loop;
  -- an answer that never came (pg_net keeps responses for a while only)
  delete from public.gym_google_refresh where requested_at < now() - interval '1 day';
  return v_n;
exception when undefined_table then
  return 0;
end;
$$;
revoke execute on function public.gym_google_refresh_collect() from public, anon, authenticated;

-- Monthly on the 1st at 04:10, collected ten minutes later. Idempotent.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    begin
      perform cron.schedule('gym-google-refresh', '10 4 1 * *', $cron$ select public.gym_google_refresh_request(); $cron$);
      perform cron.schedule('gym-google-collect', '20,40 4 1 * *', $cron$ select public.gym_google_refresh_collect(); $cron$);
    exception when others then
      raise notice 'gym google refresh not scheduled (%)', sqlerrm;
    end;
  end if;
end;
$$;

-- ============================================================================
-- 2. where a workout happened
-- ============================================================================
alter table public.logged_sessions
  add column gym_id uuid references public.gyms (id) on delete set null;
create index logged_sessions_gym_idx on public.logged_sessions (gym_id, started_at desc) where gym_id is not null;
comment on column public.logged_sessions.gym_id is
  'Where this workout happened, if the person said so (the workout-done screen). Active gyms only.';

create or replace function public.logged_sessions_gym_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.gym_id is not null
     and new.gym_id is distinct from (case when tg_op = 'UPDATE' then old.gym_id end)
     and not exists (select 1 from public.gyms g where g.id = new.gym_id and g.status = 'active') then
    raise exception 'GYM_NOT_FOUND' using errcode = 'P0002';
  end if;
  return new;
end;
$$;
revoke execute on function public.logged_sessions_gym_guard() from public, anon, authenticated;
create trigger logged_sessions_gym_guard before insert or update of gym_id on public.logged_sessions
  for each row execute function public.logged_sessions_gym_guard();

/** The gyms the caller trained at lately, most recent first — the picker's shortcuts. */
create or replace function public.my_recent_gyms(p_limit int default 5)
returns table (id uuid, name text, city text, last_at timestamptz)
language sql stable security definer set search_path = public as $$
  select g.id, g.name, g.city, max(s.started_at)
  from public.logged_sessions s
  join public.gyms g on g.id = s.gym_id and g.status = 'active'
  where s.user_id = auth.uid() and s.started_at > now() - interval '180 days'
  group by g.id, g.name, g.city
  order by max(s.started_at) desc
  limit least(greatest(coalesce(p_limit, 5), 1), 10);
$$;
revoke execute on function public.my_recent_gyms(int) from public, anon;
grant execute on function public.my_recent_gyms(int) to authenticated;

-- ============================================================================
-- 3. gym tops
-- ============================================================================

-- Accounts whose training may be counted in a gym's numbers.
create or replace function public.gym_countable(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.users u where u.id = p_user and u.suspended_at is null)
     and not exists (select 1 from public.account_deletion_requests d where d.user_id = p_user);
$$;
revoke execute on function public.gym_countable(uuid) from public, anon, authenticated;

-- The first day of a period on the Bucharest calendar; null = all time.
create or replace function public.gym_period_start(p_period text)
returns timestamptz language sql stable set search_path = public as $$
  select case p_period
    when 'week' then date_trunc('week', now() at time zone 'Europe/Bucharest') at time zone 'Europe/Bucharest'
    when 'month' then date_trunc('month', now() at time zone 'Europe/Bucharest') at time zone 'Europe/Bucharest'
    else null
  end;
$$;
revoke execute on function public.gym_period_start(text) from public, anon;
grant execute on function public.gym_period_start(text) to authenticated;

/**
 * Gyms ranked against each other. p_metric: workouts | athletes | volume
 * (completed sessions at the gym in the period) or members (home gym, now).
 * p_period: week | month | all. p_city narrows to one city (accent- and
 * case-insensitive). Only gyms with at least three different people behind
 * the number are ranked.
 */
create or replace function public.gym_tops(
  p_metric text default 'workouts',
  p_period text default 'month',
  p_city text default null,
  p_limit int default 20
) returns table (
  rank int, gym_id uuid, name text, city text, score numeric, athletes int, workouts int, members int
) language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_from timestamptz;
  v_city text := nullif(public.search_normalize(btrim(coalesce(p_city, ''))), '');
begin
  if p_metric not in ('workouts', 'athletes', 'volume', 'members') then
    raise exception 'unknown gym metric' using errcode = '22023';
  end if;
  if p_period not in ('week', 'month', 'all') then
    raise exception 'unknown gym period' using errcode = '22023';
  end if;
  if auth.uid() is null then
    return;
  end if;
  v_from := public.gym_period_start(p_period);

  return query
  with sess as (
    select s.gym_id, s.id, s.user_id
    from public.logged_sessions s
    where s.gym_id is not null
      and s.completed_at is not null
      and (v_from is null or s.started_at >= v_from)
      and public.gym_countable(s.user_id)
  ),
  per_gym as (
    select s.gym_id, count(distinct s.user_id)::int as athletes, count(distinct s.id)::int as workouts,
           coalesce(sum(greatest(ls.weight_kg, 0) * ls.reps) filter (where ls.reps > 0), 0) as volume
    from sess s
    left join public.logged_sets ls on ls.session_id = s.id
    group by s.gym_id
  ),
  mem as (
    select u.home_gym_id as gym_id, count(*)::int as members
    from public.users u
    where u.home_gym_id is not null and public.gym_countable(u.id)
    group by u.home_gym_id
  ),
  scored as (
    select g.id, g.name, g.city, g.created_at,
           coalesce(p.athletes, 0) as athletes, coalesce(p.workouts, 0) as workouts,
           coalesce(m.members, 0) as members,
           case p_metric
             when 'workouts' then coalesce(p.workouts, 0)::numeric
             when 'athletes' then coalesce(p.athletes, 0)::numeric
             when 'volume' then round(coalesce(p.volume, 0))::numeric
             else coalesce(m.members, 0)::numeric
           end as score
    from public.gyms g
    left join per_gym p on p.gym_id = g.id
    left join mem m on m.gym_id = g.id
    where g.status = 'active'
      and (v_city is null or public.search_normalize(g.city) = v_city)
      -- three people at least behind the number
      and case when p_metric = 'members' then coalesce(m.members, 0) else coalesce(p.athletes, 0) end >= 3
  )
  select (row_number() over (order by sc.score desc, sc.athletes desc, sc.created_at, sc.id))::int,
         sc.id, sc.name, sc.city, sc.score, sc.athletes, sc.workouts, sc.members
  from scored sc
  where sc.score > 0
  order by 1
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
end;
$$;
revoke execute on function public.gym_tops(text, text, text, int) from public, anon;
grant execute on function public.gym_tops(text, text, text, int) to authenticated;

-- ============================================================================
-- 4. one gym's stats
-- ============================================================================
create or replace function public.gym_stats(p_gym uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_g public.gyms;
  v_week timestamptz := public.gym_period_start('week');
  v_month timestamptz := public.gym_period_start('month');
  v_week_n int; v_week_people int;
  v_month_n int; v_month_people int; v_month_volume numeric;
  v_30_people int;
  v_hours jsonb; v_days jsonb;
  v_rank int;
begin
  if auth.uid() is null then
    return null;
  end if;
  select * into v_g from public.gyms where id = p_gym and status = 'active';
  if v_g.id is null then
    return null;
  end if;

  select count(*), count(distinct s.user_id) into v_week_n, v_week_people
  from public.logged_sessions s
  where s.gym_id = p_gym and s.completed_at is not null and s.started_at >= v_week and public.gym_countable(s.user_id);

  select count(*), count(distinct s.user_id) into v_month_n, v_month_people
  from public.logged_sessions s
  where s.gym_id = p_gym and s.completed_at is not null and s.started_at >= v_month and public.gym_countable(s.user_id);

  select coalesce(round(sum(greatest(ls.weight_kg, 0) * ls.reps)), 0) into v_month_volume
  from public.logged_sessions s
  join public.logged_sets ls on ls.session_id = s.id and ls.reps > 0
  where s.gym_id = p_gym and s.completed_at is not null and s.started_at >= v_month and public.gym_countable(s.user_id);

  select count(distinct s.user_id) into v_30_people
  from public.logged_sessions s
  where s.gym_id = p_gym and s.completed_at is not null and s.started_at >= now() - interval '30 days'
    and public.gym_countable(s.user_id);

  -- Busiest hours / weekdays: only with three people behind them.
  if v_30_people >= 3 then
    select jsonb_agg(coalesce(c.n, 0) order by h.h) into v_hours
    from generate_series(0, 23) h(h)
    left join (
      select extract(hour from s.started_at at time zone 'Europe/Bucharest')::int as hr, count(*)::int as n
      from public.logged_sessions s
      where s.gym_id = p_gym and s.completed_at is not null and s.started_at >= now() - interval '30 days'
        and public.gym_countable(s.user_id)
      group by 1
    ) c on c.hr = h.h;
    -- ISO weekday, Monday first
    select jsonb_agg(coalesce(c.n, 0) order by d.d) into v_days
    from generate_series(1, 7) d(d)
    left join (
      select extract(isodow from s.started_at at time zone 'Europe/Bucharest')::int as dw, count(*)::int as n
      from public.logged_sessions s
      where s.gym_id = p_gym and s.completed_at is not null and s.started_at >= now() - interval '30 days'
        and public.gym_countable(s.user_id)
      group by 1
    ) c on c.dw = d.d;
  end if;

  select t.rank into v_rank from public.gym_tops('workouts', 'month', null, 100) t where t.gym_id = p_gym;

  return jsonb_build_object(
    'gym', jsonb_build_object(
      'id', v_g.id, 'name', v_g.name, 'city', v_g.city, 'address', v_g.address,
      'lat', v_g.lat, 'lng', v_g.lng, 'maps_url', v_g.maps_url,
      'google_place_id', v_g.google_place_id, 'google_rating', v_g.google_rating,
      'google_ratings_total', v_g.google_ratings_total, 'opening_hours', v_g.opening_hours,
      'opening_periods', v_g.opening_periods, 'google_business_status', v_g.google_business_status,
      'phone', v_g.phone, 'website', v_g.website, 'primary_type', v_g.primary_type, 'summary', v_g.summary,
      'parking', v_g.parking, 'accessibility', v_g.accessibility, 'payment', v_g.payment,
      'has_photo', v_g.photo_name is not null, 'photo_attribution', v_g.photo_attribution,
      'google_refreshed_at', v_g.google_refreshed_at),
    'members', (select count(*) from public.users u where u.home_gym_id = p_gym and public.gym_countable(u.id)),
    'board', (select count(*) from public.users u where u.home_gym_id = p_gym and u.gym_board and public.gym_countable(u.id)),
    'coaches', public.gym_coach_count(p_gym),
    -- below three people the numbers would be someone's own: null, not a figure
    'week', case when v_week_people >= 3 then jsonb_build_object('workouts', v_week_n, 'athletes', v_week_people) end,
    'month', case when v_month_people >= 3
                  then jsonb_build_object('workouts', v_month_n, 'athletes', v_month_people, 'volume_kg', v_month_volume) end,
    'busy_hours', v_hours,
    'busy_days', v_days,
    'rank_month', v_rank,
    'is_home', exists (select 1 from public.users u where u.id = auth.uid() and u.home_gym_id = p_gym),
    'my_month', (select count(*) from public.logged_sessions s
                 where s.user_id = auth.uid() and s.gym_id = p_gym and s.completed_at is not null and s.started_at >= v_month)
  );
end;
$$;
revoke execute on function public.gym_stats(uuid) from public, anon;
grant execute on function public.gym_stats(uuid) to authenticated;

-- ============================================================================
-- 5. the map
-- ============================================================================
create or replace function public.gyms_map()
returns table (
  id uuid, name text, city text, address text, lat double precision, lng double precision,
  members int, coaches int, athletes_30d int, google_rating numeric
) language sql stable security definer set search_path = public as $$
  select g.id, g.name, g.city, g.address, g.lat, g.lng,
         (select count(*) from public.users u where u.home_gym_id = g.id and public.gym_countable(u.id))::int,
         public.gym_coach_count(g.id),
         -- shown only from three people up, like every gym number
         case when a.n >= 3 then a.n end,
         g.google_rating
  from public.gyms g
  cross join lateral (
    select count(distinct s.user_id)::int as n
    from public.logged_sessions s
    where s.gym_id = g.id and s.completed_at is not null
      and s.started_at >= now() - interval '30 days' and public.gym_countable(s.user_id)
  ) a
  where auth.uid() is not null and g.status = 'active' and g.lat is not null
  order by g.city, g.name;
$$;
revoke execute on function public.gyms_map() from public, anon;
grant execute on function public.gyms_map() to authenticated;

-- ============================================================================
-- 6. the admin list shows the Google link
-- ============================================================================
-- admin_gyms from 20261024100000, plus the Google columns.
create or replace function public.admin_gyms(
  p_status text default null, p_search text default null, p_limit int default 50, p_offset int default 0
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_needle text := nullif(btrim(coalesce(p_search, '')), '');
  v_rows jsonb; v_stats jsonb; v_total int;
begin
  perform public.admin_assert();
  p_limit := least(greatest(coalesce(p_limit, 50), 1), 200);
  p_offset := greatest(coalesce(p_offset, 0), 0);

  select jsonb_build_object(
    'active', count(*) filter (where status = 'active'),
    'pending', count(*) filter (where status = 'pending'),
    'members', (select count(*) from public.users where home_gym_id is not null),
    'coaches', (select count(distinct coach_profile_id) from public.coach_locations where gym_id is not null),
    'requests', (select count(*) from public.coaching_requests where status = 'pending')
  ) into v_stats from public.gyms;

  select count(*) into v_total from public.gyms g
   where (p_status is null or g.status = p_status)
     and (v_needle is null or g.search_text like public.gym_like(v_needle));

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.pending desc, x.city_key, x.name_key), '[]'::jsonb) into v_rows
  from (
    select g.id, g.name, g.city, g.address, g.lat, g.lng, g.maps_url, g.status, g.created_at,
           g.google_place_id, g.google_rating, g.google_ratings_total, g.google_refreshed_at,
           g.status = 'pending' as pending, lower(g.city) as city_key, lower(g.name) as name_key,
           (select coalesce(s.username, s.full_name) from public.users s where s.id = g.suggested_by) as suggested_by,
           (select count(*) from public.users u where u.home_gym_id = g.id)::int as members,
           (select coalesce(jsonb_agg(jsonb_build_object(
                     'id', cp.user_id, 'name', public.public_display_name(c.username, c.full_name),
                     'slug', cp.slug, 'status', cp.status) order by cl.created_at), '[]'::jsonb)
              from public.coach_locations cl
              join public.coach_profiles cp on cp.id = cl.coach_profile_id
              join public.users c on c.id = cp.user_id
             where cl.gym_id = g.id) as coaches
    from public.gyms g
    where (p_status is null or g.status = p_status)
      and (v_needle is null or g.search_text like public.gym_like(v_needle))
    order by g.status = 'pending' desc, lower(g.city), lower(g.name), g.id
    limit p_limit offset p_offset
  ) x;

  return jsonb_build_object('stats', v_stats, 'total', v_total, 'rows', v_rows);
end;
$$;
