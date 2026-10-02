-- HealthApp schema · gyms × Coach Discovery: one coach-at-a-gym, one request
--
-- 20261020100000 (Coach Discovery) and 20261023100000 (gyms) were written in
-- parallel and both modelled "a client finds a coach and asks": Discovery
-- with coach_locations.gym_name (free text) and coaching_requests (no accept
-- yet), gyms with gym_coaches and coach_requests (with an accept). This
-- keeps one of each:
--
-- 1. WHERE A COACH WORKS is coach_locations. It gains gym_id → gyms, set
--    through coach_set_locations() in the profile editor, so a gym claim is
--    reviewed with the rest of the profile (content is editable only in
--    draft). gym_name stays: it is what the public page shows, and is the
--    gym's own name whenever gym_id is set. gym_coaches goes.
--
-- 2. THE REQUEST is coaching_requests. It gains gym_id (where the client
--    found the coach, for the coach's inbox) and the status 'closed' (the
--    client got a coach some other way). coach_requests goes. Both dropped
--    tables were empty on the live project when this was written.
--
-- 3. ACCEPTING. accept_coaching_request() does what accept_invite() does:
--    an active trainer_clients row and a conversation, recorded on the
--    request as trainer_client_id. The one-active-coach rule
--    (one_active_coach_per_client) stays, decided 2026-10-02: a client who
--    has a coach cannot send a request (ALREADY_HAS_COACH from
--    request_coaching()), and if they got one while a request was pending,
--    accepting closes it instead and says so. Accepting closes the client's
--    other pending requests too.
--
-- 4. "Coaches at your gym" lists published profiles located at that gym —
--    the same visibility as the public page.
--
-- Every function below that existed starts from its latest definition:
-- coach_set_locations and request_coaching from 20261020100000, the gym
-- functions from 20261023100000.

-- ============================================================================
-- 1. coach_locations.gym_id
-- ============================================================================
alter table public.coach_locations
  add column gym_id uuid references public.gyms (id) on delete set null;
create index coach_locations_gym_idx on public.coach_locations (gym_id) where gym_id is not null;

/**
 * p_locations: [{"city": "cluj-napoca", "gym_id": "<uuid>"|null, "gym_name": "…"|null}, …]
 * A gym_id must name an active gym; its name then replaces gym_name.
 */
create or replace function public.coach_set_locations(p_locations jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_profile uuid := public.coach_my_editable_profile();
  v_items jsonb := coalesce(p_locations, '[]'::jsonb);
begin
  if jsonb_typeof(v_items) <> 'array' then
    raise exception 'INVALID_LOCATIONS' using errcode = '22023';
  end if;
  if jsonb_array_length(v_items) > 5 then
    raise exception 'TOO_MANY_LOCATIONS' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(v_items) e
             where not exists (select 1 from public.cities c
                               where c.slug = e ->> 'city' and c.active)) then
    raise exception 'UNKNOWN_CITY' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(v_items) e
             where char_length(btrim(coalesce(e ->> 'gym_name', ''))) > 120) then
    raise exception 'GYM_NAME_TOO_LONG' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(v_items) e
             where nullif(e ->> 'gym_id', '') is not null
               and (e ->> 'gym_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                    or not exists (select 1 from public.gyms g
                                   where g.id = (e ->> 'gym_id')::uuid and g.status = 'active'))) then
    raise exception 'GYM_NOT_FOUND' using errcode = '22023';
  end if;
  delete from public.coach_locations where coach_profile_id = v_profile;
  insert into public.coach_locations (coach_profile_id, city_id, gym_id, gym_name)
  select distinct on (c.id) v_profile, c.id, g.id, coalesce(g.name, nullif(btrim(e ->> 'gym_name'), ''))
  from jsonb_array_elements(v_items) e
  join public.cities c on c.slug = e ->> 'city'
  left join public.gyms g on g.id = (nullif(e ->> 'gym_id', ''))::uuid and g.status = 'active';
end;
$$;

-- ============================================================================
-- 2. coaching_requests: gym_id, 'closed'
-- ============================================================================
alter table public.coaching_requests
  add column gym_id uuid references public.gyms (id) on delete set null;
alter table public.coaching_requests drop constraint coaching_requests_status_check;
alter table public.coaching_requests add constraint coaching_requests_status_check
  check (status in ('pending', 'accepted', 'declined', 'cancelled', 'closed'));

drop table public.gym_coaches;
drop table public.coach_requests;
drop function if exists public.set_gym_coaching(uuid, boolean);
drop function if exists public.request_coach(uuid, uuid, text);
drop function if exists public.withdraw_coach_request(uuid);
drop function if exists public.respond_coach_request(uuid, boolean);
drop function if exists public.admin_remove_gym_coach(uuid, uuid);
drop function if exists public.gym_coaches_at(uuid);
drop function if exists public.my_coach_requests();
drop function if exists public.coach_request_inbox();

-- request_coaching from 20261020100000, plus p_gym and the one-coach rule.
drop function public.request_coaching(uuid, uuid, text);
create function public.request_coaching(
  p_coach_profile uuid,
  p_service uuid default null,
  p_message text default null,
  p_gym uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_coach uuid;
  v_accepting boolean;
  v_message text := nullif(btrim(coalesce(p_message, '')), '');
  v_id uuid;
begin
  if v_user is null then
    raise exception 'NOT_SIGNED_IN' using errcode = '42501';
  end if;
  if not exists (select 1 from public.users u where u.id = v_user
                 and u.suspended_at is null and u.username is not null)
     or exists (select 1 from public.account_deletion_requests d where d.user_id = v_user) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '42501';
  end if;

  -- the same visibility as the public page, plus "not across a block"
  select cp.user_id, cp.accepting_clients into v_coach, v_accepting
  from public.coach_profiles cp
  join public.users u on u.id = cp.user_id
  where cp.id = p_coach_profile
    and cp.status = 'published'
    and u.suspended_at is null
    and not exists (select 1 from public.account_deletion_requests d where d.user_id = cp.user_id)
    and not public.social_blocked_between(v_user, cp.user_id);
  if v_coach is null then
    raise exception 'COACH_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_coach = v_user then
    raise exception 'CANNOT_REQUEST_SELF' using errcode = '22023';
  end if;
  if not v_accepting then
    raise exception 'NOT_ACCEPTING_CLIENTS' using errcode = '55000';
  end if;
  if p_service is not null and not exists (
       select 1 from public.coach_services sv
       where sv.id = p_service and sv.coach_profile_id = p_coach_profile and sv.active) then
    raise exception 'UNKNOWN_SERVICE' using errcode = '22023';
  end if;
  if exists (select 1 from public.trainer_clients tc
             where tc.coach_id = v_coach and tc.client_id = v_user and tc.status = 'active') then
    raise exception 'ALREADY_COACHED' using errcode = '55000';
  end if;
  -- One active coach per client (one_active_coach_per_client): someone who
  -- has one cannot ask another, so no coach accepts what cannot happen.
  if exists (select 1 from public.trainer_clients tc
             where tc.client_id = v_user and tc.status = 'active') then
    raise exception 'ALREADY_HAS_COACH' using errcode = '55000';
  end if;
  if char_length(v_message) > 2000 then
    raise exception 'MESSAGE_TOO_LONG' using errcode = '22023';
  end if;
  if (select count(*) from public.coaching_requests r
      where r.client_id = v_user and r.created_at > now() - interval '24 hours') >= 10 then
    raise exception 'REQUEST_RATE' using errcode = 'P0001';
  end if;

  begin
    insert into public.coaching_requests (client_id, coach_id, service_id, message, gym_id)
    values (v_user, v_coach, p_service, v_message,
            (select g.id from public.gyms g where g.id = p_gym and g.status = 'active'))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'REQUEST_PENDING' using errcode = '23505';
  end;
  return v_id;
end;
$$;
revoke execute on function public.request_coaching(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.request_coaching(uuid, uuid, text, uuid) to authenticated;

/**
 * The coach accepts. Returns 'accepted', or 'already_has_coach' when the
 * client found a coach while this was pending — the request is then closed
 * (a return, not a raise, so the close is kept).
 */
create or replace function public.accept_coaching_request(p_request uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_row public.coaching_requests;
  v_tc uuid;
begin
  if not public.social_actor_active() then
    raise exception 'NOT_SIGNED_IN' using errcode = '42501';
  end if;
  select * into v_row from public.coaching_requests
   where id = p_request and coach_id = auth.uid() and status = 'pending'
   for update;
  if not found or not public.is_listed_user(v_row.client_id) then
    raise exception 'REQUEST_NOT_PENDING' using errcode = '55000';
  end if;

  -- Serialize with accept_invite() and another coach accepting at the same time.
  perform 1 from public.users where id = v_row.client_id for update;
  if exists (select 1 from public.trainer_clients where client_id = v_row.client_id and status = 'active') then
    update public.coaching_requests set status = 'closed', resolved_at = now() where id = v_row.id;
    return 'already_has_coach';
  end if;

  insert into public.trainer_clients (coach_id, client_id, status, started_at)
  values (v_row.coach_id, v_row.client_id, 'active', now())
  returning id into v_tc;
  insert into public.conversations (coach_id, client_id)
  values (v_row.coach_id, v_row.client_id)
  on conflict (coach_id, client_id) do nothing;

  update public.coaching_requests
     set status = 'accepted', resolved_at = now(), trainer_client_id = v_tc
   where id = v_row.id;
  update public.coaching_requests set status = 'closed', resolved_at = now()
   where client_id = v_row.client_id and status = 'pending';
  return 'accepted';
end;
$$;
revoke execute on function public.accept_coaching_request(uuid) from public, anon;
grant execute on function public.accept_coaching_request(uuid) to authenticated;

/** The coach's inbox: pending requests from people who are still listed. */
create function public.coach_request_inbox()
returns table (
  id uuid, client_id uuid, client_name text, client_username text, client_avatar text, client_city text,
  gym_name text, service_name text, message text, created_at timestamptz
) language sql stable security definer set search_path = public as $$
  select r.id, u.id, public.public_display_name(u.username, u.full_name), u.username, u.avatar_url, u.city,
         g.name, sv.name, r.message, r.created_at
  from public.coaching_requests r
  join public.users u on u.id = r.client_id
  left join public.gyms g on g.id = r.gym_id
  left join public.coach_services sv on sv.id = r.service_id
  where r.coach_id = auth.uid() and r.status = 'pending' and public.is_listed_user(u.id)
  order by r.created_at;
$$;
revoke execute on function public.coach_request_inbox() from public, anon;
grant execute on function public.coach_request_inbox() to authenticated;

/** The caller's own pending requests, with the coach's public name and page. */
create function public.my_coach_requests()
returns table (id uuid, coach_name text, coach_slug text, coach_avatar text, gym_name text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.id, public.public_display_name(u.username, u.full_name), cp.slug, u.avatar_url, g.name, r.created_at
  from public.coaching_requests r
  join public.users u on u.id = r.coach_id
  left join public.coach_profiles cp on cp.user_id = r.coach_id
  left join public.gyms g on g.id = r.gym_id
  where r.client_id = auth.uid() and r.status = 'pending'
  order by r.created_at desc;
$$;
revoke execute on function public.my_coach_requests() from public, anon;
grant execute on function public.my_coach_requests() to authenticated;

-- ============================================================================
-- 3. coaches at a gym
-- ============================================================================

/** Published coach profiles located at a gym, as the public page shows them. */
create function public.gym_coaches_at(p_gym uuid)
returns table (
  coach_profile_id uuid, slug text, display_name text, avatar_url text, headline text,
  accepting_clients boolean, request_pending boolean
) language sql stable security definer set search_path = public as $$
  select cp.id, cp.slug, public.public_display_name(u.username, u.full_name), u.avatar_url, cp.headline,
         cp.accepting_clients,
         exists (select 1 from public.coaching_requests r
                 where r.client_id = auth.uid() and r.coach_id = cp.user_id and r.status = 'pending')
  from public.coach_locations cl
  join public.coach_profiles cp on cp.id = cl.coach_profile_id and cp.status = 'published'
  join public.users u on u.id = cp.user_id
  join public.gyms g on g.id = cl.gym_id and g.status = 'active'
  where auth.uid() is not null
    and cl.gym_id = p_gym
    and cp.user_id <> auth.uid()
    and public.is_listed_user(u.id)
  order by cp.accepting_clients desc, cp.published_at, cp.id;
$$;
revoke execute on function public.gym_coaches_at(uuid) from public, anon;
grant execute on function public.gym_coaches_at(uuid) to authenticated;

-- The published, listed coaches located at a gym (for the counts below).
create or replace function public.gym_coach_count(p_gym uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int
  from public.coach_locations cl
  join public.coach_profiles cp on cp.id = cl.coach_profile_id and cp.status = 'published'
  where cl.gym_id = p_gym and public.is_listed_user(cp.user_id);
$$;
revoke execute on function public.gym_coach_count(uuid) from public, anon;
grant execute on function public.gym_coach_count(uuid) to authenticated;

-- search_gyms from 20261023100000; coaches counted from coach_locations.
create or replace function public.search_gyms(p_query text default null, p_limit int default 20)
returns table (
  id uuid, name text, city text, address text, lat double precision, lng double precision,
  maps_url text, status text, members int, coaches int
) language sql stable security definer set search_path = public as $$
  with me as (select public.search_normalize(u.city) as city from public.users u where u.id = auth.uid())
  select g.id, g.name, g.city, g.address, g.lat, g.lng, g.maps_url, g.status,
         (select count(*) from public.users u where u.home_gym_id = g.id)::int,
         public.gym_coach_count(g.id)
  from public.gyms g
  left join me on true
  where auth.uid() is not null
    and (g.status = 'active' or g.suggested_by = auth.uid())
    and (
      case
        when nullif(btrim(coalesce(p_query, '')), '') is null
          then me.city is not null and public.search_normalize(g.city) = me.city
        else g.search_text like public.gym_like(p_query)
      end
    )
  order by (me.city is not null and public.search_normalize(g.city) = me.city) desc, lower(g.name), g.id
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

-- my_gyms from 20261023100000; no more `coaching` (the profile editor owns it).
create or replace function public.my_gyms()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'home', (select jsonb_build_object('id', g.id, 'name', g.name, 'city', g.city, 'address', g.address,
                                       'maps_url', g.maps_url, 'lat', g.lat, 'lng', g.lng)
             from public.gyms g where g.id = u.home_gym_id),
    'board', u.gym_board,
    'pending', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'city', g.city) order by g.created_at desc)
      from public.gyms g where g.suggested_by = u.id and g.status = 'pending'), '[]'::jsonb)
  )
  from public.users u where u.id = auth.uid();
$$;

-- admin_gyms from 20261023100000; coaches from coach_locations (any status,
-- with it), open requests from coaching_requests.
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

-- admin_delete_gym from 20261023100000: coach_locations keep their gym_name
-- (on delete set null clears gym_id), so a published page does not change.
