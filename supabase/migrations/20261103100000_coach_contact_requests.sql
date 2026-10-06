-- HealthApp schema · Coach Discovery: contact / consultation requests
--
-- coaching_requests (20261020100000, gyms 20261024100000) already is the
-- request: client -> coach, an optional service, a message, one pending per
-- pair (unique index), never yourself (check), only to a published coach who
-- takes clients, a 24 h cap, cancel and decline. This migration makes it the
-- first conversion step without making anyone a client:
--
-- 1. Two optional fields the form asks for: goal (300) and preferred_format
--    (online / in_person / hybrid). An index on (client_id, status).
--
-- 2. Accepting is "interested, let's talk" (decided 2026-10-05, two steps):
--    accept_coaching_request() only moves pending -> accepted and tells the
--    client. It no longer creates a relationship or closes anything.
--    start_coaching_from_request() is the second, explicit step on an
--    accepted request: what accept used to do (an active trainer_clients row
--    and a conversation, the one-active-coach rule, the client's other
--    pending requests closed). The request records which relationship it
--    became (trainer_client_id). Nobody becomes a client by accident.
--
-- 3. Contacting no longer requires having no coach: someone coached by A may
--    write to B. ALREADY_HAS_COACH now comes from step two.
--
-- 4. Notifications go through the existing table and Activity Center, one
--    new category, coaching_request, with payload.event:
--      sent -> the coach   accepted / declined -> the client   cancelled -> the coach
--    and payload.screen pointing at the request pages. social_notify_ok()
--    decides who may be told (not yourself, not across a block, not a
--    suspended or deleting account), as for every social notice.
--
-- 5. Two reads, all states, the minimum each side needs:
--      coach_requests(status)  the coach's, newest first: the client's public
--                              name, username and avatar — no e-mail, no city,
--                              no training or health data — and what the
--                              request itself carries.
--      my_coaching_requests()  the client's sent requests, with the coach's
--                              public name, page and avatar.
--    coach_viewer_state() gains last_request, so the profile's CTA can say
--    Contact / Request sent / Request accepted / Contact again.
--
-- Not here: messaging, booking, payment, automatic relationships.

-- ---------- 1. fields ----------
alter table public.coaching_requests
  add column goal text check (goal is null or char_length(goal) between 1 and 300),
  add column preferred_format text check (preferred_format is null or preferred_format in ('online', 'in_person', 'hybrid'));
create index coaching_requests_client_status_idx on public.coaching_requests (client_id, status, created_at desc);

-- ---------- 4. the notice ----------
alter type public.notification_category add value if not exists 'coaching_request';

create or replace function public.coach_request_notify(p_recipient uuid, p_actor uuid, p_event text, p_request uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_name text;
begin
  if not public.social_notify_ok(p_recipient, p_actor) then
    return;
  end if;
  select public.public_display_name(u.username, u.full_name) into v_name from public.users u where u.id = p_actor;
  insert into public.notifications (user_id, category, title, body, payload)
  values (p_recipient, 'coaching_request',
          case p_event when 'sent' then 'New coaching request' when 'accepted' then 'Request accepted'
                       when 'declined' then 'Request declined' else 'Request cancelled' end,
          case p_event when 'sent' then v_name || ' would like to work with you'
                       when 'accepted' then v_name || ' accepted your request'
                       when 'declined' then v_name || ' declined your request'
                       else v_name || ' cancelled their request' end,
          jsonb_build_object('request_id', p_request, 'actor_id', p_actor, 'event', p_event,
                             'screen', case when p_event in ('sent', 'cancelled') then 'coach_requests' else 'my_requests' end));
end;
$$;
revoke execute on function public.coach_request_notify(uuid, uuid, text, uuid) from public, anon, authenticated;

-- ---------- 3. the request (20261024100000, plus goal / format, minus the one-coach refusal) ----------
drop function public.request_coaching(uuid, uuid, text, uuid);
create function public.request_coaching(
  p_coach_profile uuid,
  p_service uuid default null,
  p_message text default null,
  p_gym uuid default null,
  p_goal text default null,
  p_format text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_coach uuid;
  v_accepting boolean;
  v_message text := nullif(btrim(coalesce(p_message, '')), '');
  v_goal text := nullif(btrim(coalesce(p_goal, '')), '');
  v_format text := nullif(btrim(coalesce(p_format, '')), '');
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
  -- Contacting is not coaching (20261103100000): someone who already has a
  -- coach may still ask another one. The one-active-coach rule is checked
  -- when a coach actually starts coaching (start_coaching_from_request).
  if char_length(coalesce(v_goal, '')) > 300 then
    raise exception 'GOAL_TOO_LONG' using errcode = '22023';
  end if;
  if v_format is not null and v_format not in ('online', 'in_person', 'hybrid') then
    raise exception 'INVALID_FORMAT' using errcode = '22023';
  end if;
  if char_length(v_message) > 2000 then
    raise exception 'MESSAGE_TOO_LONG' using errcode = '22023';
  end if;
  if (select count(*) from public.coaching_requests r
      where r.client_id = v_user and r.created_at > now() - interval '24 hours') >= 10 then
    raise exception 'REQUEST_RATE' using errcode = 'P0001';
  end if;

  begin
    insert into public.coaching_requests (client_id, coach_id, service_id, message, gym_id, goal, preferred_format)
    values (v_user, v_coach, p_service, v_message,
            (select g.id from public.gyms g where g.id = p_gym and g.status = 'active'), v_goal, v_format)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'REQUEST_PENDING' using errcode = '23505';
  end;
  perform public.coach_request_notify(v_coach, v_user, 'sent', v_id);
  return v_id;
end;
$$;
revoke execute on function public.request_coaching(uuid, uuid, text, uuid, text, text) from public, anon;
grant execute on function public.request_coaching(uuid, uuid, text, uuid, text, text) to authenticated;

create or replace function public.cancel_coaching_request(p_request uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_coach uuid;
begin
  update public.coaching_requests
     set status = 'cancelled', resolved_at = now()
   where id = p_request and client_id = auth.uid() and status = 'pending'
  returning coach_id into v_coach;
  if v_coach is null then
    raise exception 'REQUEST_NOT_PENDING' using errcode = '55000';
  end if;
  perform public.coach_request_notify(v_coach, auth.uid(), 'cancelled', p_request);
end;
$$;

create or replace function public.decline_coaching_request(p_request uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_client uuid;
begin
  update public.coaching_requests
     set status = 'declined', resolved_at = now(),
         decline_reason = left(nullif(btrim(coalesce(p_reason, '')), ''), 500)
   where id = p_request and coach_id = auth.uid() and status = 'pending'
  returning client_id into v_client;
  if v_client is null then
    raise exception 'REQUEST_NOT_PENDING' using errcode = '55000';
  end if;
  perform public.coach_request_notify(v_client, auth.uid(), 'declined', p_request);
end;
$$;

-- ---------- 2. accept = interested; starting is its own step ----------
create or replace function public.accept_coaching_request(p_request uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_client uuid;
begin
  if not public.social_actor_active() then
    raise exception 'NOT_SIGNED_IN' using errcode = '42501';
  end if;
  update public.coaching_requests
     set status = 'accepted', resolved_at = now()
   where id = p_request and coach_id = auth.uid() and status = 'pending'
     and public.is_listed_user(client_id)
  returning client_id into v_client;
  if v_client is null then
    raise exception 'REQUEST_NOT_PENDING' using errcode = '55000';
  end if;
  perform public.coach_request_notify(v_client, auth.uid(), 'accepted', p_request);
  return 'accepted';
end;
$$;

/**
 * The coach starts coaching someone whose request they accepted: an active
 * trainer_clients row and a conversation — what accept_invite() does. Keeps
 * one active coach per client (ALREADY_HAS_COACH), refuses a second start,
 * and closes the client's other pending requests (they have a coach now).
 */
create or replace function public.start_coaching_from_request(p_request uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_row public.coaching_requests;
  v_tc uuid;
begin
  if not public.social_actor_active() then
    raise exception 'NOT_SIGNED_IN' using errcode = '42501';
  end if;
  select * into v_row from public.coaching_requests
   where id = p_request and coach_id = auth.uid() and status = 'accepted'
   for update;
  if not found or not public.is_listed_user(v_row.client_id) then
    raise exception 'REQUEST_NOT_ACCEPTED' using errcode = '55000';
  end if;
  if v_row.trainer_client_id is not null then
    raise exception 'ALREADY_COACHED' using errcode = '55000';
  end if;
  -- serialize with accept_invite() and another coach starting at the same time
  perform 1 from public.users where id = v_row.client_id for update;
  if exists (select 1 from public.trainer_clients where client_id = v_row.client_id and status = 'active') then
    raise exception 'ALREADY_HAS_COACH' using errcode = '55000';
  end if;

  insert into public.trainer_clients (coach_id, client_id, status, started_at)
  values (v_row.coach_id, v_row.client_id, 'active', now())
  returning id into v_tc;
  insert into public.conversations (coach_id, client_id)
  values (v_row.coach_id, v_row.client_id)
  on conflict (coach_id, client_id) do nothing;
  update public.coaching_requests set trainer_client_id = v_tc where id = v_row.id;
  update public.coaching_requests set status = 'closed', resolved_at = now()
   where client_id = v_row.client_id and status = 'pending';
  return v_tc;
end;
$$;
revoke execute on function public.start_coaching_from_request(uuid) from public, anon;
grant execute on function public.start_coaching_from_request(uuid) to authenticated;

-- ---------- 5. the reads ----------
create or replace function public.coach_requests(p_status text default null)
returns table (
  id uuid, status text, client_id uuid, client_name text, client_username text, client_avatar text,
  service_name text, message text, goal text, preferred_format text, gym_name text,
  created_at timestamptz, resolved_at timestamptz, started boolean
) language sql stable security definer set search_path = public as $$
  select r.id, r.status, u.id, public.public_display_name(u.username, u.full_name), u.username, u.avatar_url,
         sv.name, r.message, r.goal, r.preferred_format, g.name,
         r.created_at, r.resolved_at, r.trainer_client_id is not null
  from public.coaching_requests r
  join public.users u on u.id = r.client_id
  left join public.coach_services sv on sv.id = r.service_id
  left join public.gyms g on g.id = r.gym_id
  where r.coach_id = auth.uid()
    and (p_status is null or r.status = p_status)
    and public.is_listed_user(u.id)
    and not public.social_blocked_between(auth.uid(), u.id)
  order by (r.status = 'pending') desc, r.created_at desc
  limit 200;
$$;
revoke execute on function public.coach_requests(text) from public, anon;
grant execute on function public.coach_requests(text) to authenticated;

create or replace function public.my_coaching_requests()
returns table (
  id uuid, status text, coach_name text, coach_slug text, coach_avatar text,
  service_name text, message text, goal text, preferred_format text,
  created_at timestamptz, resolved_at timestamptz, started boolean
) language sql stable security definer set search_path = public as $$
  select r.id, r.status, public.public_display_name(u.username, u.full_name),
         -- the coach's page only while it is public
         case when cp.status = 'published' then cp.slug end, u.avatar_url,
         sv.name, r.message, r.goal, r.preferred_format,
         r.created_at, r.resolved_at, r.trainer_client_id is not null
  from public.coaching_requests r
  join public.users u on u.id = r.coach_id
  left join public.coach_profiles cp on cp.user_id = r.coach_id
  left join public.coach_services sv on sv.id = r.service_id
  where r.client_id = auth.uid()
  order by (r.status = 'pending') desc, r.created_at desc
  limit 100;
$$;
revoke execute on function public.my_coaching_requests() from public, anon;
grant execute on function public.my_coaching_requests() to authenticated;

create or replace function public.coach_viewer_state(p_profile uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'is_self', cp.user_id = auth.uid(),
    'is_following', public.is_following(cp.user_id),
    'is_saved', exists (select 1 from public.coach_saves sv where sv.user_id = auth.uid() and sv.coach_profile_id = cp.id),
    'follows_me', exists (select 1 from public.social_follows f
                          where f.follower_id = cp.user_id and f.following_id = auth.uid()),
    'is_client', exists (select 1 from public.trainer_clients tc
                         where tc.coach_id = cp.user_id and tc.client_id = auth.uid() and tc.status = 'active'),
    'has_other_coach', exists (select 1 from public.trainer_clients tc
                               where tc.client_id = auth.uid() and tc.status = 'active' and tc.coach_id <> cp.user_id),
    -- the reader's latest request to this coach, whatever its state: the CTA reads it (20261103100000)
    'last_request', (select jsonb_build_object('id', r.id, 'status', r.status, 'service_id', r.service_id,
                                               'created_at', r.created_at, 'started', r.trainer_client_id is not null)
                     from public.coaching_requests r
                     where r.client_id = auth.uid() and r.coach_id = cp.user_id
                     order by r.created_at desc limit 1),
    'pending_request', (select jsonb_build_object('id', r.id, 'service_id', r.service_id, 'created_at', r.created_at)
                        from public.coaching_requests r
                        where r.client_id = auth.uid() and r.coach_id = cp.user_id and r.status = 'pending')
  )
  from public.coach_profiles cp
  join public.users u on u.id = cp.user_id
  where cp.id = p_profile
    and auth.uid() is not null
    -- the same door as coach_public_visible(): published, account live, no block
    and cp.status = 'published'
    and u.suspended_at is null
    and not exists (select 1 from public.account_deletion_requests d where d.user_id = cp.user_id)
    and not public.social_blocked_between(auth.uid(), cp.user_id);
$$;
-- create or replace keeps the earlier grants of cancel / decline / accept / viewer state.

-- /coaches/requests is the client's page: "requests" is a reserved coach slug too
create or replace function public.coach_slug_reserved(p_slug text)
returns boolean language sql stable security definer set search_path = public as $$
  select p_slug = any (array[
           'online', 'in-person', 'near-me', 'search', 'new', 'edit', 'top', 'all',
           'apply', 'become-a-coach', 'city', 'cities', 'country', 'countries',
           'specialization', 'specializations', 'services', 'verified', 'saved', 'requests'])
      or exists (select 1 from public.cities c where c.slug = p_slug)
      or exists (select 1 from public.countries c where c.slug = p_slug)
      or exists (select 1 from public.specializations s where s.slug = p_slug);
$$;
