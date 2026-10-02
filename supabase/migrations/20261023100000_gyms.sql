-- HealthApp schema · gyms: "my gym", the gym leaderboard, coaches at your gym
--
-- Three features on one new noun. No map yet, and no map provider is
-- assumed: a gym is a row of our own, with optional coordinates and an
-- optional link out (google_place_id / osm_id are reserved for whichever
-- provider is chosen later, so a map can be added without reshaping this).
--
-- 1. GYMS. Admin-curated. An admin creates a gym `active`; anyone signed in
--    may *suggest* one, which waits as `pending` until an admin approves it
--    on /admin/gyms. Only active gyms can be picked, claimed or ranked.
--    Readable: active gyms by anyone signed in, a pending one by whoever
--    suggested it (and admins). No direct writes; every writer is an RPC.
--
-- 2. MY GYM. users.home_gym_id + users.gym_board. Written only through
--    set_home_gym(). Who goes to which gym is a physical whereabouts, so the
--    board is opt-in (gym_board defaults to false) and users_select already
--    shows the row only to the person themselves and their coach/clients.
--
-- 3. GYM LEADERBOARD. social_leaderboard() accepts p_scope = 'gym': the same
--    visible set as 'global' (leaderboard_visibility, suspension, deletion,
--    block), narrowed to the caller's own home gym and to people who opted
--    in. Reciprocal: a caller without a gym, or who has not opted in, gets
--    an empty board. You can only see the board of the gym you set as yours.
--
-- 4. COACHES AT YOUR GYM. A coach claims up to five gyms (gym_coaches). The
--    claim is self-declared, like the coach role itself; an admin can remove
--    one. A client without an active coach can send a coaching request
--    (coach_requests) to a coach listed at a gym; the coach accepts or
--    declines. Accepting does what accept_invite() does — an active
--    trainer_clients row and a conversation — so from there on it is the
--    existing relationship, with RLS unchanged. Requests are capped (three
--    pending per client, ten sent a day) because they reach a stranger.

-- ============================================================================
-- 1. gyms
-- ============================================================================
create table public.gyms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 120),
  city text not null check (length(btrim(city)) between 1 and 80),
  address text check (address is null or length(address) <= 200),
  lat double precision check (lat is null or lat between -90 and 90),
  lng double precision check (lng is null or lng between -180 and 180),
  -- A link out ("open in maps"); never fetched by the database.
  maps_url text check (maps_url is null or (length(maps_url) <= 500 and maps_url ~ '^https://')),
  google_place_id text unique check (google_place_id is null or length(google_place_id) <= 300),
  osm_id text unique check (osm_id is null or length(osm_id) <= 40),
  status text not null default 'active' check (status in ('pending', 'active')),
  suggested_by uuid references public.users (id) on delete set null,
  approved_by uuid references public.users (id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((lat is null) = (lng is null)),
  search_text text generated always as (public.search_normalize(name || ' ' || city || ' ' || coalesce(address, ''))) stored
);
create trigger gyms_updated before update on public.gyms
  for each row execute function public.handle_updated_at();
create index gyms_active_city_idx on public.gyms (lower(city), lower(name)) where status = 'active';
create index gyms_pending_idx on public.gyms (created_at desc) where status = 'pending';
create index gyms_suggested_by_idx on public.gyms (suggested_by) where status = 'pending';

alter table public.gyms enable row level security;
create policy gyms_select on public.gyms for select to authenticated
  using (status = 'active' or suggested_by = auth.uid() or public.is_admin());
revoke all on table public.gyms from anon;
revoke insert, update, delete on table public.gyms from authenticated;
grant select on table public.gyms to authenticated;

-- ============================================================================
-- 2. my gym
-- ============================================================================
alter table public.users
  add column home_gym_id uuid references public.gyms (id) on delete set null,
  add column gym_board boolean not null default false;
create index users_home_gym_idx on public.users (home_gym_id) where home_gym_id is not null;
comment on column public.users.home_gym_id is 'The gym this person trains at. Written by set_home_gym() only.';
comment on column public.users.gym_board is 'Opt-in: appear on the leaderboard of home_gym_id. Off by default.';
-- Not added to the column-level update grant: set_home_gym() is the writer.

-- ============================================================================
-- 3. coaches at a gym
-- ============================================================================
create table public.gym_coaches (
  gym_id uuid not null references public.gyms (id) on delete cascade,
  coach_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (gym_id, coach_id)
);
create index gym_coaches_coach_idx on public.gym_coaches (coach_id);
alter table public.gym_coaches enable row level security;
-- The coach's own claims; who coaches where is read through gym_coaches_at().
create policy gym_coaches_own on public.gym_coaches for select to authenticated
  using (coach_id = auth.uid() or public.is_admin());
revoke all on table public.gym_coaches from anon;
revoke insert, update, delete on table public.gym_coaches from authenticated;
grant select on table public.gym_coaches to authenticated;

-- ============================================================================
-- 4. coaching requests
-- ============================================================================
create table public.coach_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.users (id) on delete cascade,
  coach_id uuid not null references public.users (id) on delete cascade,
  -- Where the client found the coach; kept for context, not required.
  gym_id uuid references public.gyms (id) on delete set null,
  note text check (note is null or length(note) <= 500),
  -- pending → accepted | declined | withdrawn (by the client) | closed (the
  -- client got a coach some other way, so the request no longer applies)
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'withdrawn', 'closed')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (client_id <> coach_id)
);
create unique index coach_requests_one_pending on public.coach_requests (client_id, coach_id) where status = 'pending';
create index coach_requests_coach_idx on public.coach_requests (coach_id, created_at desc) where status = 'pending';
create index coach_requests_client_idx on public.coach_requests (client_id, created_at desc);
alter table public.coach_requests enable row level security;
create policy coach_requests_parties on public.coach_requests for select to authenticated
  using (client_id = auth.uid() or coach_id = auth.uid() or public.is_admin());
revoke all on table public.coach_requests from anon;
revoke insert, update, delete on table public.coach_requests from authenticated;
grant select on table public.coach_requests to authenticated;

-- ============================================================================
-- 5. RPCs — everyone
-- ============================================================================

-- LIKE wildcards in what the caller typed are literal.
create or replace function public.gym_like(p_text text)
returns text language sql immutable set search_path = public as $$
  select '%' || replace(replace(replace(public.search_normalize(btrim(coalesce(p_text, ''))), '\', '\\'), '%', '\%'), '_', '\_') || '%';
$$;
revoke execute on function public.gym_like(text) from public, anon;
grant execute on function public.gym_like(text) to authenticated;

/**
 * Gyms to pick from: active ones matching the query (name, city, address,
 * accent-insensitive), the caller's own pending suggestions, and the
 * caller's city first. An empty query lists the caller's city.
 */
create or replace function public.search_gyms(p_query text default null, p_limit int default 20)
returns table (
  id uuid, name text, city text, address text, lat double precision, lng double precision,
  maps_url text, status text, members int, coaches int
) language sql stable security definer set search_path = public as $$
  with me as (select public.search_normalize(u.city) as city from public.users u where u.id = auth.uid())
  select g.id, g.name, g.city, g.address, g.lat, g.lng, g.maps_url, g.status,
         (select count(*) from public.users u where u.home_gym_id = g.id)::int,
         (select count(*) from public.gym_coaches gc where gc.gym_id = g.id and public.is_listed_user(gc.coach_id))::int
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
revoke execute on function public.search_gyms(text, int) from public, anon;
grant execute on function public.search_gyms(text, int) to authenticated;

/** The caller's gym state in one round trip: home gym, board opt-in, gyms coached at. */
create or replace function public.my_gyms()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'home', (select jsonb_build_object('id', g.id, 'name', g.name, 'city', g.city, 'address', g.address,
                                       'maps_url', g.maps_url, 'lat', g.lat, 'lng', g.lng)
             from public.gyms g where g.id = u.home_gym_id),
    'board', u.gym_board,
    'coaching', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'city', g.city) order by lower(g.name))
      from public.gym_coaches gc join public.gyms g on g.id = gc.gym_id
      where gc.coach_id = u.id), '[]'::jsonb),
    'pending', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'city', g.city) order by g.created_at desc)
      from public.gyms g where g.suggested_by = u.id and g.status = 'pending'), '[]'::jsonb)
  )
  from public.users u where u.id = auth.uid();
$$;
revoke execute on function public.my_gyms() from public, anon;
grant execute on function public.my_gyms() to authenticated;

/** Set or clear (p_gym null) the caller's gym, and whether they appear on its board. */
create or replace function public.set_home_gym(p_gym uuid, p_board boolean default false)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_SIGNED_IN' using errcode = '42501';
  end if;
  if p_gym is not null and not exists (select 1 from public.gyms g where g.id = p_gym and g.status = 'active') then
    raise exception 'GYM_NOT_FOUND' using errcode = 'P0002';
  end if;
  update public.users
     set home_gym_id = p_gym,
         gym_board = p_gym is not null and coalesce(p_board, false)
   where id = auth.uid();
end;
$$;
revoke execute on function public.set_home_gym(uuid, boolean) from public, anon;
grant execute on function public.set_home_gym(uuid, boolean) to authenticated;

/** Suggest a gym that is not listed. Waits for an admin; five pending per person. */
create or replace function public.suggest_gym(p_name text, p_city text, p_address text default null, p_maps_url text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_city text := nullif(btrim(coalesce(p_city, '')), '');
  v_url text := nullif(btrim(coalesce(p_maps_url, '')), '');
  v_id uuid;
begin
  if not public.social_actor_active() then
    raise exception 'NOT_SIGNED_IN' using errcode = '42501';
  end if;
  if v_name is null or length(v_name) < 2 or length(v_name) > 120 then
    raise exception 'GYM_NAME' using errcode = '22023';
  end if;
  if v_city is null or length(v_city) > 80 then
    raise exception 'GYM_CITY' using errcode = '22023';
  end if;
  if v_url is not null and (v_url !~ '^https://' or length(v_url) > 500) then
    raise exception 'GYM_URL' using errcode = '22023';
  end if;
  if (select count(*) from public.gyms g where g.suggested_by = auth.uid() and g.status = 'pending') >= 5 then
    raise exception 'GYM_RATE' using errcode = 'P0001';
  end if;
  insert into public.gyms (name, city, address, maps_url, status, suggested_by)
  values (v_name, v_city, left(nullif(btrim(coalesce(p_address, '')), ''), 200), v_url, 'pending', auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.suggest_gym(text, text, text, text) from public, anon;
grant execute on function public.suggest_gym(text, text, text, text) to authenticated;

/** A coach lists themselves at a gym (up to five), or stops. */
create or replace function public.set_gym_coaching(p_gym uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.social_actor_active() then
    raise exception 'NOT_SIGNED_IN' using errcode = '42501';
  end if;
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'coach') then
    raise exception 'COACH_ONLY' using errcode = '42501';
  end if;
  if not coalesce(p_on, false) then
    delete from public.gym_coaches where gym_id = p_gym and coach_id = auth.uid();
    return;
  end if;
  if not exists (select 1 from public.gyms g where g.id = p_gym and g.status = 'active') then
    raise exception 'GYM_NOT_FOUND' using errcode = 'P0002';
  end if;
  if (select count(*) from public.gym_coaches gc where gc.coach_id = auth.uid() and gc.gym_id <> p_gym) >= 5 then
    raise exception 'GYM_COACH_LIMIT' using errcode = 'P0001';
  end if;
  insert into public.gym_coaches (gym_id, coach_id) values (p_gym, auth.uid())
  on conflict do nothing;
end;
$$;
revoke execute on function public.set_gym_coaching(uuid, boolean) from public, anon;
grant execute on function public.set_gym_coaching(uuid, boolean) to authenticated;

/**
 * The coaches listed at a gym, as a client looking for one sees them: name,
 * username, avatar, city, bio — what the public profile already shows — and
 * whether the caller has a request pending with them. Suspended, deleting
 * and blocked accounts are not listed; the caller is never listed.
 */
create or replace function public.gym_coaches_at(p_gym uuid)
returns table (
  coach_id uuid, display_name text, username text, avatar_url text, city text, bio text,
  request_pending boolean
) language sql stable security definer set search_path = public as $$
  select u.id, coalesce(u.username, u.full_name), u.username, u.avatar_url, u.city, u.bio,
         exists (select 1 from public.coach_requests r
                 where r.client_id = auth.uid() and r.coach_id = u.id and r.status = 'pending')
  from public.gym_coaches gc
  join public.gyms g on g.id = gc.gym_id and g.status = 'active'
  join public.users u on u.id = gc.coach_id and u.role = 'coach'
  where auth.uid() is not null
    and gc.gym_id = p_gym
    and u.id <> auth.uid()
    and public.is_listed_user(u.id)
  order by gc.created_at, u.id;
$$;
revoke execute on function public.gym_coaches_at(uuid) from public, anon;
grant execute on function public.gym_coaches_at(uuid) to authenticated;

/** A client without a coach asks one listed at a gym to coach them. */
create or replace function public.request_coach(p_coach uuid, p_gym uuid default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not public.social_actor_active() then
    raise exception 'NOT_SIGNED_IN' using errcode = '42501';
  end if;
  if p_coach = auth.uid() then
    raise exception 'COACH_NOT_FOUND' using errcode = 'P0002';
  end if;
  -- Only a coach who listed themselves at an active gym takes requests: the
  -- listing is their consent to be found.
  if not exists (
    select 1 from public.users u
    join public.gym_coaches gc on gc.coach_id = u.id
    join public.gyms g on g.id = gc.gym_id and g.status = 'active'
    where u.id = p_coach and u.role = 'coach' and public.is_listed_user(u.id)
  ) then
    raise exception 'COACH_NOT_FOUND' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.trainer_clients where client_id = auth.uid() and status = 'active') then
    raise exception 'ALREADY_HAS_COACH' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.coach_requests r
             where r.client_id = auth.uid() and r.coach_id = p_coach and r.status = 'pending') then
    raise exception 'REQUEST_PENDING' using errcode = 'P0001';
  end if;
  if (select count(*) from public.coach_requests r where r.client_id = auth.uid() and r.status = 'pending') >= 3
     or (select count(*) from public.coach_requests r
         where r.client_id = auth.uid() and r.created_at >= now() - interval '1 day') >= 10 then
    raise exception 'REQUEST_RATE' using errcode = 'P0001';
  end if;
  insert into public.coach_requests (client_id, coach_id, gym_id, note)
  values (auth.uid(), p_coach,
          (select g.id from public.gyms g where g.id = p_gym and g.status = 'active'),
          left(nullif(btrim(coalesce(p_note, '')), ''), 500))
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.request_coach(uuid, uuid, text) from public, anon;
grant execute on function public.request_coach(uuid, uuid, text) to authenticated;

/** The client takes back a pending request. */
create or replace function public.withdraw_coach_request(p_request uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.coach_requests
     set status = 'withdrawn', responded_at = now()
   where id = p_request and client_id = auth.uid() and status = 'pending';
  if not found then
    raise exception 'REQUEST_NOT_FOUND' using errcode = 'P0002';
  end if;
end;
$$;
revoke execute on function public.withdraw_coach_request(uuid) from public, anon;
grant execute on function public.withdraw_coach_request(uuid) to authenticated;

/** The caller's own pending requests, with the coach's name (users_select would hide it). */
create or replace function public.my_coach_requests()
returns table (id uuid, coach_id uuid, coach_name text, coach_username text, coach_avatar text, gym_name text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.id, u.id, coalesce(u.username, u.full_name), u.username, u.avatar_url, g.name, r.created_at
  from public.coach_requests r
  join public.users u on u.id = r.coach_id
  left join public.gyms g on g.id = r.gym_id
  where r.client_id = auth.uid() and r.status = 'pending'
  order by r.created_at desc;
$$;
revoke execute on function public.my_coach_requests() from public, anon;
grant execute on function public.my_coach_requests() to authenticated;

/** The coach's inbox: pending requests from people who are still listed. */
create or replace function public.coach_request_inbox()
returns table (
  id uuid, client_id uuid, client_name text, client_username text, client_avatar text, client_city text,
  gym_name text, note text, created_at timestamptz
) language sql stable security definer set search_path = public as $$
  select r.id, u.id, coalesce(u.username, u.full_name), u.username, u.avatar_url, u.city, g.name, r.note, r.created_at
  from public.coach_requests r
  join public.users u on u.id = r.client_id
  left join public.gyms g on g.id = r.gym_id
  where r.coach_id = auth.uid() and r.status = 'pending' and public.is_listed_user(u.id)
  order by r.created_at;
$$;
revoke execute on function public.coach_request_inbox() from public, anon;
grant execute on function public.coach_request_inbox() to authenticated;

/**
 * The coach answers. Accepting does what accept_invite() does: an active
 * relationship and a conversation. If the client found a coach in the
 * meantime the request is closed and ALREADY_HAS_COACH raised. On accept the
 * client's other pending requests are closed — they have a coach now.
 */
create or replace function public.respond_coach_request(p_request uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_row public.coach_requests;
begin
  if not public.social_actor_active() then
    raise exception 'NOT_SIGNED_IN' using errcode = '42501';
  end if;
  select * into v_row from public.coach_requests
   where id = p_request and coach_id = auth.uid() and status = 'pending'
   for update;
  if not found then
    raise exception 'REQUEST_NOT_FOUND' using errcode = 'P0002';
  end if;

  if not coalesce(p_accept, false) then
    update public.coach_requests set status = 'declined', responded_at = now() where id = v_row.id;
    return;
  end if;

  if not public.is_listed_user(v_row.client_id) then
    raise exception 'REQUEST_NOT_FOUND' using errcode = 'P0002';
  end if;
  -- Serialize with accept_invite() and a second coach accepting at the same time.
  perform 1 from public.users where id = v_row.client_id for update;
  if exists (select 1 from public.trainer_clients where client_id = v_row.client_id and status = 'active') then
    update public.coach_requests set status = 'closed', responded_at = now() where id = v_row.id;
    raise exception 'ALREADY_HAS_COACH' using errcode = 'P0001';
  end if;

  insert into public.trainer_clients (coach_id, client_id, status, started_at)
  values (v_row.coach_id, v_row.client_id, 'active', now());
  insert into public.conversations (coach_id, client_id)
  values (v_row.coach_id, v_row.client_id)
  on conflict (coach_id, client_id) do nothing;

  update public.coach_requests set status = 'accepted', responded_at = now() where id = v_row.id;
  update public.coach_requests set status = 'closed', responded_at = now()
   where client_id = v_row.client_id and status = 'pending';
end;
$$;
revoke execute on function public.respond_coach_request(uuid, boolean) from public, anon;
grant execute on function public.respond_coach_request(uuid, boolean) to authenticated;

-- ============================================================================
-- 6. RPCs — admin
-- ============================================================================

/** /admin/gyms: counters plus one page of gyms, pending first. */
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
    'coaches', (select count(distinct coach_id) from public.gym_coaches),
    'requests', (select count(*) from public.coach_requests where status = 'pending')
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
           (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', coalesce(c.username, c.full_name)) order by gc.created_at), '[]'::jsonb)
              from public.gym_coaches gc join public.users c on c.id = gc.coach_id where gc.gym_id = g.id) as coaches
    from public.gyms g
    where (p_status is null or g.status = p_status)
      and (v_needle is null or g.search_text like public.gym_like(v_needle))
    order by g.status = 'pending' desc, lower(g.city), lower(g.name), g.id
    limit p_limit offset p_offset
  ) x;

  return jsonb_build_object('stats', v_stats, 'total', v_total, 'rows', v_rows);
end;
$$;
revoke execute on function public.admin_gyms(text, text, int, int) from public, anon;
grant execute on function public.admin_gyms(text, text, int, int) to authenticated;

/** Create (p_id null) or edit a gym. An admin's gym is active at once. */
create or replace function public.admin_save_gym(
  p_id uuid, p_name text, p_city text, p_address text default null,
  p_lat double precision default null, p_lng double precision default null, p_maps_url text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_city text := nullif(btrim(coalesce(p_city, '')), '');
  v_address text := left(nullif(btrim(coalesce(p_address, '')), ''), 200);
  v_url text := nullif(btrim(coalesce(p_maps_url, '')), '');
  v_id uuid;
begin
  perform public.admin_assert();
  if v_name is null or length(v_name) < 2 or length(v_name) > 120 then
    raise exception 'GYM_NAME' using errcode = '22023';
  end if;
  if v_city is null or length(v_city) > 80 then
    raise exception 'GYM_CITY' using errcode = '22023';
  end if;
  if v_url is not null and (v_url !~ '^https://' or length(v_url) > 500) then
    raise exception 'GYM_URL' using errcode = '22023';
  end if;
  if (p_lat is null) <> (p_lng is null)
     or (p_lat is not null and (p_lat not between -90 and 90 or p_lng not between -180 and 180)) then
    raise exception 'GYM_COORDS' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.gyms (name, city, address, lat, lng, maps_url, status, approved_by, approved_at)
    values (v_name, v_city, v_address, p_lat, p_lng, v_url, 'active', auth.uid(), now())
    returning id into v_id;
  else
    update public.gyms
       set name = v_name, city = v_city, address = v_address, lat = p_lat, lng = p_lng, maps_url = v_url
     where id = p_id
     returning id into v_id;
    if v_id is null then
      raise exception 'GYM_NOT_FOUND' using errcode = 'P0002';
    end if;
  end if;
  perform public.audit_log('ADMIN_ACTION', 'gym', v_id::text, null,
    jsonb_build_object('kind', case when p_id is null then 'gym_create' else 'gym_edit' end, 'name', v_name));
  return v_id;
end;
$$;
revoke execute on function public.admin_save_gym(uuid, text, text, text, double precision, double precision, text) from public, anon;
grant execute on function public.admin_save_gym(uuid, text, text, text, double precision, double precision, text) to authenticated;

/** Approve a suggested gym. */
create or replace function public.admin_approve_gym(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_name text;
begin
  perform public.admin_assert();
  update public.gyms set status = 'active', approved_by = auth.uid(), approved_at = now()
   where id = p_id and status = 'pending'
   returning name into v_name;
  if v_name is null then
    raise exception 'GYM_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform public.audit_log('ADMIN_ACTION', 'gym', p_id::text, null,
    jsonb_build_object('kind', 'gym_approve', 'name', v_name));
end;
$$;
revoke execute on function public.admin_approve_gym(uuid) from public, anon;
grant execute on function public.admin_approve_gym(uuid) to authenticated;

/** Delete a gym (or reject a suggestion). Members lose it as home gym; coach claims go. */
create or replace function public.admin_delete_gym(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_name text;
begin
  perform public.admin_assert();
  delete from public.gyms where id = p_id returning name into v_name;
  if v_name is null then
    raise exception 'GYM_NOT_FOUND' using errcode = 'P0002';
  end if;
  -- on delete set null clears home_gym_id; the opt-in goes with it.
  update public.users set gym_board = false where gym_board and home_gym_id is null;
  perform public.audit_log('ADMIN_ACTION', 'gym', p_id::text, null,
    jsonb_build_object('kind', 'gym_delete', 'name', v_name));
end;
$$;
revoke execute on function public.admin_delete_gym(uuid) from public, anon;
grant execute on function public.admin_delete_gym(uuid) to authenticated;

/** Remove one coach's claim on a gym. */
create or replace function public.admin_remove_gym_coach(p_gym uuid, p_coach uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_assert();
  delete from public.gym_coaches where gym_id = p_gym and coach_id = p_coach;
  if not found then
    raise exception 'GYM_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform public.audit_log('ADMIN_ACTION', 'gym', p_gym::text, p_coach,
    jsonb_build_object('kind', 'gym_coach_remove'));
end;
$$;
revoke execute on function public.admin_remove_gym_coach(uuid, uuid) from public, anon;
grant execute on function public.admin_remove_gym_coach(uuid, uuid) to authenticated;

-- ============================================================================
-- 7. the gym leaderboard
-- ============================================================================
-- social_leaderboard from 20261015100000, plus p_scope = 'gym'.
create or replace function public.social_leaderboard(
  p_metric text,
  p_period text,
  p_scope text default 'global',
  p_limit int default 10
)
returns table (
  rank int, user_id uuid, display_name text, username text, avatar_url text,
  score numeric, secondary_score numeric, is_current_user boolean
) language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_gym uuid;
begin
  -- Fixed vocabularies: nothing from the caller reaches the SQL as text.
  if p_metric not in ('training_load', 'volume', 'workouts', 'active_days', 'streak') then
    raise exception 'unknown leaderboard metric' using errcode = '22023';
  end if;
  if p_period not in ('week', 'month', 'all') then
    raise exception 'unknown leaderboard period' using errcode = '22023';
  end if;
  if p_scope not in ('global', 'following', 'gym') then
    raise exception 'unknown leaderboard scope' using errcode = '22023';
  end if;
  if auth.uid() is null then
    return;
  end if;
  if p_scope = 'gym' then
    -- Reciprocal: only someone on the board sees it, so nobody watches who
    -- trains at a gym without being shown there themselves.
    select u.home_gym_id into v_gym from public.users u where u.id = auth.uid() and u.gym_board;
    if v_gym is null then
      return;
    end if;
  end if;

  return query
  with people as (
    -- Everyone the caller may see on a board: the setting, or themselves.
    select u.id, coalesce(u.username, u.full_name) as display_name, u.username, u.avatar_url,
           u.created_at, coalesce(u.timezone, 'Europe/Bucharest') as tz,
           (now() at time zone coalesce(u.timezone, 'Europe/Bucharest'))::date as today
    from public.users u
    where (
      u.id = auth.uid()
      or u.leaderboard_visibility = 'public'
      or (u.leaderboard_visibility = 'followers' and public.is_following(u.id))
    )
    -- Not eligible at all while suspended or being deleted: not ranked, not
    -- shown. (A block is different — see `visible` below.)
    and (
      u.id = auth.uid()
      or (u.suspended_at is null
          and not exists (select 1 from public.account_deletion_requests d where d.user_id = u.id))
    )
    -- 'following' narrows the same visible set to the people the caller
    -- follows, plus themselves. It never widens it: someone who is private
    -- stays off the board even if you follow them.
    and (
      p_scope <> 'following'
      or u.id = auth.uid()
      or public.is_following(u.id)
    )
    -- 'gym' (20261023100000) narrows it the same way, to the caller's own
    -- gym and to people there who opted in to its board.
    and (
      p_scope <> 'gym'
      or u.id = auth.uid()
      or (u.home_gym_id = v_gym and u.gym_board)
    )
  ),
  windows as (
    -- Each person's window on their own calendar: Monday → today, the 1st → today, or open.
    select p.*,
           case p_period
             when 'week' then date_trunc('week', p.today::timestamp)::date
             when 'month' then date_trunc('month', p.today::timestamp)::date
             else null
           end as period_start
    from people p
  ),
  sessions as (
    -- One row per completed session with the same rollup challenge_progress_rows()
    -- uses, scored by the mirrored formula. Every session, not only the window:
    -- a streak needs the days before it.
    select
      w.id as uid,
      (s.started_at at time zone w.tz)::date as day,
      w.period_start, w.today,
      public.training_load_score(
        coalesce(sum(greatest(ls.weight_kg, 0) * ls.reps) filter (where ls.reps > 0), 0)::double precision,
        count(ls.id) filter (where ls.reps > 0)::int,
        nullif(round(extract(epoch from (s.completed_at - s.started_at)) / 60)::int, 0),
        avg(public.effective_rpe(ls.rpe, ls.rir)) filter (where ls.reps > 0)::double precision,
        count(distinct ls.exercise_id) filter (where ls.reps > 0)::int
      ) as load,
      coalesce(sum(greatest(ls.weight_kg, 0) * ls.reps) filter (where ls.reps > 0), 0) as volume_kg
    from public.logged_sessions s
    join windows w on w.id = s.user_id
    left join public.logged_sets ls on ls.session_id = s.id
    where s.completed_at is not null
    group by w.id, s.id, s.started_at, s.completed_at, w.tz, w.period_start, w.today
  ),
  inside as (
    select * from sessions
    where (period_start is null or day >= period_start) and day <= today
  ),
  -- streak: gaps and islands over every active day, keep the runs touching the window
  days as (
    select distinct uid, day, period_start, today from sessions
  ),
  runs as (
    select uid, day, period_start, today,
           day - (row_number() over (partition by uid order by day))::int as grp
    from days
  ),
  streaks as (
    select uid, min(day) as s, max(day) as e, count(*)::int as len, period_start, today
    from runs group by uid, grp, period_start, today
  ),
  streak_score as (
    select uid, max(len) as best
    from streaks
    where (period_start is null or e >= period_start) and s <= today
    group by uid
  ),
  totals as (
    select
      i.uid,
      sum(i.load)::numeric as load,
      round(sum(i.volume_kg))::numeric as volume,
      count(*)::numeric as workouts,
      count(distinct i.day)::numeric as active_days
    from inside i
    group by i.uid
  ),
  scored as (
    select
      p.id, p.display_name, p.username, p.avatar_url, p.created_at,
      case p_metric
        when 'training_load' then coalesce(t.load, 0)
        when 'volume' then coalesce(t.volume, 0)
        when 'workouts' then coalesce(t.workouts, 0)
        when 'active_days' then coalesce(t.active_days, 0)
        else coalesce(ss.best, 0)::numeric
      end as score,
      case p_metric
        when 'training_load' then coalesce(t.volume, 0)
        when 'volume' then coalesce(t.workouts, 0)
        when 'workouts' then coalesce(t.volume, 0)
        when 'active_days' then coalesce(t.workouts, 0)
        else coalesce(t.active_days, 0)
      end as secondary
    from people p
    left join totals t on t.uid = p.id
    left join streak_score ss on ss.uid = p.id
  ),
  ranked as (
    -- Only people with something on the board; a quiet week is not a last place.
    select
      row_number() over (order by sc.score desc, sc.secondary desc, sc.created_at asc, sc.id asc)::int as rank,
      sc.*
    from scored sc
    where sc.score > 0
  ),
  -- Block (20261007100000) is applied here and only here: after the ranking,
  -- to what this caller receives. Everyone is ranked as before, so every
  -- visible person keeps their own rank number, score and place in the
  -- order; the blocked person's row simply is not handed over, and the top
  -- p_limit is filled from the next visible rows.
  visible as (
    select r.*, row_number() over (order by r.rank) as shown
    from ranked r
    where r.id = auth.uid() or not public.social_blocked_between(auth.uid(), r.id)
  )
  select v.rank, v.id, v.display_name, v.username, v.avatar_url, v.score, v.secondary, v.id = auth.uid()
  from visible v
  where v.shown <= greatest(1, least(p_limit, 50)) or v.id = auth.uid()
  order by v.rank;
end;
$$;

revoke execute on function public.social_leaderboard(text, text, text, int) from public, anon;
grant execute on function public.social_leaderboard(text, text, text, int) to authenticated;
