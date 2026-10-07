-- HealthApp schema · coaching lifecycle, part 2
--
-- The relationship is trainer_clients (core, 20260823000200), extended — not
-- duplicated. It was invited | active | ended, with one active coach per
-- client (one_active_coach_per_client), ended only by account deletion and
-- admin invite revocation, and wide open to direct writes: tc_update_coach
-- let a coach rewrite any column of their rows (status back to active, a
-- different client_id), tc_update_client_end let a client point a row at
-- another coach as long as it said "ended". This migration:
--
-- 1. States: invited → active → (paused ⇄ active) → ended. Ended is final:
--    a trigger refuses every other move, whoever writes (RPC, admin path,
--    account purge), so an ended relationship never silently comes back. A
--    new engagement is a new row (start_coaching_from_request inserts one);
--    the old one stays as history.
--
-- 2. One current coach per client: the unique index now covers active AND
--    paused (one_current_coach_per_client). A paused coach is still the
--    client's coach; a second coach cannot slip in during the break and
--    collide on resume. accept_invite, start_coaching_from_request and
--    request_coaching say ALREADY_HAS_COACH / ALREADY_COACHED for paused too.
--
-- 3. Who may move it: only coaching_transition(relationship, to, reason) —
--    the coach or the client of that row, active → paused | ended,
--    paused → active | ended — atomically (row lock + the status in the
--    WHERE). Direct insert / update / delete grants and policies are gone;
--    coach_id never changes and client_id never changes once set. Reasons
--    are general codes from a fixed list, optional, never free text: nobody
--    has to explain a medical break.
--
-- 4. History: coaching_relationship_events — every status change (from, to,
--    actor, reason code, when), written by a trigger so no path can skip it,
--    readable by the two participants (and admins). The admin audit trail
--    (audit_trainer_clients) learns paused / resumed and stops calling a
--    resume "invitation accepted". Existing rows get their start / end
--    backfilled as events.
--
-- 5. What a pause or an end does elsewhere — decided here, nothing deleted:
--      messages   paused: still open (conversation_pair_open); ended: read-only
--      data       the coach's access to the client's training data follows
--                 is_active_coach_of() — active only — so it pauses with the
--                 coaching and ends with it, as before
--      bookings   untouched either way (cancel through the booking system);
--                 clients-only services need an active relationship to book
--      reviews    eligibility counts a paused relationship like an active one
--                 (it ran); one review per client and coach, whatever toggles
--
-- 6. Notices: category coaching — paused / resumed / ended to the other side.
--    "Started" stays the coaching_request notice of 20261108100000.
--
-- 7. Reads: my_coaching_relationships() (the client's current coach + past
--    ones), coach_client_relationships(scope) (the coach's current, paused and
--    past clients), coaching_relationship_history(id), and coach_viewer_state
--    gains the reader's own relationship with that coach — the one source
--    every CTA reads. Nothing about relationships is added to a public reader.

-- ---------- 1. columns and integrity ----------
update public.trainer_clients set ended_at = coalesce(ended_at, updated_at) where status = 'ended' and ended_at is null;

alter table public.trainer_clients
  add column paused_at timestamptz,
  add column paused_by uuid references public.users (id) on delete set null,
  add column pause_reason text check (pause_reason is null or pause_reason in ('vacation', 'break', 'schedule', 'health', 'other')),
  add column ended_by uuid references public.users (id) on delete set null,
  add column end_reason text check (end_reason is null or end_reason in ('goals_reached', 'schedule', 'not_a_fit', 'break', 'other')),
  add constraint trainer_clients_paused_has_time check (status <> 'paused' or paused_at is not null),
  add constraint trainer_clients_ended_has_time check (status <> 'ended' or ended_at is not null),
  add constraint trainer_clients_paused_after_start check (paused_at is null or started_at is null or paused_at >= started_at),
  -- rows from before this migration are not re-judged (NOT VALID); every new write is
  add constraint trainer_clients_current_started check (status not in ('active', 'paused') or started_at is not null) not valid,
  add constraint trainer_clients_ended_after_start check (ended_at is null or started_at is null or ended_at >= started_at) not valid;

-- 2. one current coach per client: active or paused
drop index if exists public.one_active_coach_per_client;
create unique index one_current_coach_per_client on public.trainer_clients (client_id) where status in ('active', 'paused');

/** The lifecycle, for every writer: no ended relationship ever moves again; identities are fixed. */
create or replace function public.trainer_clients_lifecycle_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.coach_id is distinct from old.coach_id
     or (old.client_id is not null and new.client_id is distinct from old.client_id) then
    raise exception 'RELATIONSHIP_IDENTITY_IMMUTABLE' using errcode = '42501';
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'invited' and new.status in ('active', 'ended'))
    or (old.status = 'active' and new.status in ('paused', 'ended'))
    or (old.status = 'paused' and new.status in ('active', 'ended'))) then
    raise exception 'INVALID_TRANSITION' using errcode = '55000';
  end if;
  -- a privileged path that ends or pauses without saying when (account purge, an admin, a fixture): now
  if new.status = 'ended' and new.ended_at is null then
    new.ended_at := now();
  end if;
  if new.status = 'paused' and new.paused_at is null then
    new.paused_at := now();
  end if;
  return new;
end;
$$;
create trigger trainer_clients_lifecycle before update on public.trainer_clients
  for each row execute function public.trainer_clients_lifecycle_guard();

-- 3. no direct writes: every move is a function that checks who may make it
drop policy if exists tc_insert on public.trainer_clients;
drop policy if exists tc_update_coach on public.trainer_clients;
drop policy if exists tc_update_client_end on public.trainer_clients;
revoke insert, update, delete on table public.trainer_clients from anon, authenticated;

-- ---------- 4. history ----------
create table public.coaching_relationship_events (
  id bigint generated always as identity primary key,
  relationship_id uuid not null references public.trainer_clients (id) on delete cascade,
  from_status public.relationship_status,
  to_status public.relationship_status not null,
  actor_id uuid references public.users (id) on delete set null,
  reason text check (reason is null or char_length(reason) <= 40),
  created_at timestamptz not null default now(),
  check (from_status is distinct from to_status)
);
create index coaching_relationship_events_rel_idx on public.coaching_relationship_events (relationship_id, created_at);
alter table public.coaching_relationship_events enable row level security;
create policy coaching_relationship_events_select on public.coaching_relationship_events for select to authenticated
  using (public.is_admin() or exists (select 1 from public.trainer_clients tc
                                     where tc.id = relationship_id and auth.uid() in (tc.coach_id, tc.client_id)));
revoke all on table public.coaching_relationship_events from anon, authenticated;
grant select on table public.coaching_relationship_events to authenticated;

create or replace function public.trainer_clients_record_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.coaching_relationship_events (relationship_id, from_status, to_status, actor_id, reason)
    values (new.id, case when tg_op = 'UPDATE' then old.status end, new.status, auth.uid(),
            case new.status when 'paused' then new.pause_reason when 'ended' then new.end_reason end);
  end if;
  return null;
end;
$$;
revoke execute on function public.trainer_clients_record_event() from public, anon, authenticated;
create trigger trainer_clients_events after insert or update of status on public.trainer_clients
  for each row execute function public.trainer_clients_record_event();

-- what already happened, as far as the rows tell
insert into public.coaching_relationship_events (relationship_id, from_status, to_status, created_at)
select id, 'invited', 'active', started_at from public.trainer_clients where started_at is not null;
insert into public.coaching_relationship_events (relationship_id, from_status, to_status, created_at)
select id, case when started_at is null then 'invited' else 'active' end::public.relationship_status, 'ended', ended_at
from public.trainer_clients where status = 'ended' and ended_at is not null;

-- ---------- 3b / 6. the move, and its notice ----------
create or replace function public.coaching_notify(p_recipient uuid, p_actor uuid, p_event text, p_relationship uuid, p_screen text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_name text;
begin
  if not public.social_notify_ok(p_recipient, p_actor) then
    return;
  end if;
  select public.public_display_name(u.username, u.full_name) into v_name from public.users u where u.id = p_actor;
  insert into public.notifications (user_id, category, title, body, payload)
  values (p_recipient, 'coaching',
          case p_event when 'paused' then 'Coaching paused' when 'resumed' then 'Coaching resumed' else 'Coaching ended' end,
          case p_event when 'paused' then v_name || ' paused your coaching'
                       when 'resumed' then v_name || ' resumed your coaching'
                       else v_name || ' ended your coaching' end,
          jsonb_build_object('relationship_id', p_relationship, 'actor_id', p_actor, 'event', p_event, 'screen', p_screen));
end;
$$;
revoke execute on function public.coaching_notify(uuid, uuid, text, uuid, text) from public, anon, authenticated;

/**
 * Pause, resume or end a coaching relationship — the coach's or the client's
 * own, and only along the lifecycle. Atomic: the row is locked and its
 * current status is part of the decision, so two calls cannot both succeed.
 * The other side is told. Returns the new status.
 */
create or replace function public.coaching_transition(p_relationship uuid, p_to text, p_reason text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_row public.trainer_clients;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_other uuid;
begin
  if auth.uid() is null then
    raise exception 'NOT_SIGNED_IN' using errcode = '42501';
  end if;
  if p_to is null or p_to not in ('paused', 'active', 'ended') then
    raise exception 'INVALID_TRANSITION' using errcode = '22023';
  end if;
  select * into v_row from public.trainer_clients
   where id = p_relationship and auth.uid() in (coach_id, client_id)
   for update;
  if not found then
    raise exception 'RELATIONSHIP_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not ((v_row.status = 'active' and p_to in ('paused', 'ended'))
       or (v_row.status = 'paused' and p_to in ('active', 'ended'))) then
    raise exception 'INVALID_TRANSITION' using errcode = '55000';
  end if;
  if v_reason is not null and not (
       (p_to = 'paused' and v_reason in ('vacation', 'break', 'schedule', 'health', 'other'))
    or (p_to = 'ended' and v_reason in ('goals_reached', 'schedule', 'not_a_fit', 'break', 'other'))) then
    raise exception 'INVALID_REASON' using errcode = '22023';
  end if;

  if p_to = 'paused' then
    update public.trainer_clients set status = 'paused', paused_at = now(), paused_by = auth.uid(), pause_reason = v_reason
     where id = v_row.id;
  elsif p_to = 'active' then
    update public.trainer_clients set status = 'active', paused_at = null, paused_by = null, pause_reason = null
     where id = v_row.id;
  else
    update public.trainer_clients set status = 'ended', ended_at = now(), ended_by = auth.uid(), end_reason = v_reason
     where id = v_row.id;
  end if;

  v_other := case when auth.uid() = v_row.coach_id then v_row.client_id else v_row.coach_id end;
  perform public.coaching_notify(v_other, auth.uid(),
    case p_to when 'paused' then 'paused' when 'active' then 'resumed' else 'ended' end, v_row.id,
    case when v_other = v_row.client_id then 'coach' else 'coach_relationship' end);
  return p_to;
end;
$$;
revoke execute on function public.coaching_transition(uuid, text, text) from public, anon;
grant execute on function public.coaching_transition(uuid, text, text) to authenticated;

-- ---------- 7. the reads ----------
/** The client's coaching relationships — the current one first, then the past ones. Started ones only. */
create or replace function public.my_coaching_relationships()
returns table (
  id uuid, status text, coach_id uuid, coach_name text, coach_avatar text, coach_slug text,
  started_at timestamptz, paused_at timestamptz, paused_by_me boolean, pause_reason text,
  ended_at timestamptz, ended_by_me boolean, end_reason text,
  conversation_id uuid, completed_bookings int, my_review jsonb
) language sql stable security definer set search_path = public as $$
  select tc.id, tc.status::text, u.id, public.public_display_name(u.username, u.full_name), u.avatar_url,
         (select cp.slug from public.coach_profiles cp where cp.user_id = tc.coach_id and cp.status = 'published'),
         tc.started_at, tc.paused_at, tc.paused_by = auth.uid(), tc.pause_reason,
         tc.ended_at, tc.ended_by = auth.uid(), tc.end_reason,
         (select c.id from public.conversations c where c.coach_id = tc.coach_id and c.client_id = tc.client_id),
         (select count(*)::int from public.bookings b
           where b.client_id = tc.client_id and b.coach_id = tc.coach_id and b.status = 'completed'
             and b.start_at >= tc.started_at and b.start_at <= coalesce(tc.ended_at, now())),
         (select jsonb_build_object('rating', r.rating, 'status', r.status) from public.coach_reviews r
           where r.reviewer_id = tc.client_id and r.coach_id = tc.coach_id and r.status <> 'deleted')
  from public.trainer_clients tc
  join public.users u on u.id = tc.coach_id
  where tc.client_id = auth.uid() and tc.started_at is not null
  order by (tc.status in ('active', 'paused')) desc, coalesce(tc.ended_at, tc.started_at) desc
  limit 100;
$$;
revoke execute on function public.my_coaching_relationships() from public, anon;
grant execute on function public.my_coaching_relationships() to authenticated;

/**
 * The coach's clients by relationship: current (active + paused), paused,
 * past (ended) or all. Public name and avatar only — a paused or past client
 * is not "connected" any more, and nothing of their training is here.
 */
create or replace function public.coach_client_relationships(p_scope text default 'all')
returns table (
  id uuid, status text, client_id uuid, client_name text, client_avatar text,
  started_at timestamptz, paused_at timestamptz, paused_by_me boolean, pause_reason text,
  ended_at timestamptz, ended_by_me boolean, end_reason text,
  conversation_id uuid, completed_bookings int, next_booking_at timestamptz
) language sql stable security definer set search_path = public as $$
  select tc.id, tc.status::text, u.id, public.public_display_name(u.username, u.full_name), u.avatar_url,
         tc.started_at, tc.paused_at, tc.paused_by = auth.uid(), tc.pause_reason,
         tc.ended_at, tc.ended_by = auth.uid(), tc.end_reason,
         (select c.id from public.conversations c where c.coach_id = tc.coach_id and c.client_id = tc.client_id),
         (select count(*)::int from public.bookings b
           where b.client_id = tc.client_id and b.coach_id = tc.coach_id and b.status = 'completed'
             and b.start_at >= tc.started_at and b.start_at <= coalesce(tc.ended_at, now())),
         (select min(b.start_at) from public.bookings b
           where b.client_id = tc.client_id and b.coach_id = tc.coach_id
             and b.status in ('pending', 'confirmed') and b.start_at > now())
  from public.trainer_clients tc
  join public.users u on u.id = tc.client_id
  where tc.coach_id = auth.uid() and tc.started_at is not null
    and case coalesce(p_scope, 'all')
          when 'current' then tc.status in ('active', 'paused')
          when 'paused' then tc.status = 'paused'
          when 'past' then tc.status = 'ended'
          else true end
  order by (tc.status in ('active', 'paused')) desc, coalesce(tc.ended_at, tc.started_at) desc
  limit 500;
$$;
revoke execute on function public.coach_client_relationships(text) from public, anon;
grant execute on function public.coach_client_relationships(text) to authenticated;

/** One relationship's timeline, for its two participants: who did what, when. */
create or replace function public.coaching_relationship_history(p_relationship uuid)
returns table (from_status text, to_status text, actor text, reason text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select e.from_status::text, e.to_status::text,
         case when e.actor_id is null then 'system' when e.actor_id = auth.uid() then 'me' else 'other' end,
         e.reason, e.created_at
  from public.coaching_relationship_events e
  join public.trainer_clients tc on tc.id = e.relationship_id
  where e.relationship_id = p_relationship and auth.uid() in (tc.coach_id, tc.client_id)
  order by e.created_at, e.id;
$$;
revoke execute on function public.coaching_relationship_history(uuid) from public, anon;
grant execute on function public.coaching_relationship_history(uuid) to authenticated;

-- ---------- the functions that read the lifecycle ----------
-- request_coaching (20261103100000): someone this coach coaches — active or paused — is ALREADY_COACHED
create or replace function public.request_coaching(
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
             where tc.coach_id = v_coach and tc.client_id = v_user and tc.status in ('active', 'paused')) then
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

-- accept_invite (20260823000900): a paused coach is still a coach
create or replace function public.accept_invite(p_code text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_row public.trainer_clients;
begin
  select * into v_row from public.trainer_clients
  where invite_code = upper(p_code) and status = 'invited'
  for update;

  if not found then
    raise exception 'INVALID_CODE';
  end if;
  if v_row.invite_expires_at < now() then
    raise exception 'EXPIRED';
  end if;
  if v_row.coach_id = auth.uid() then
    raise exception 'INVALID_CODE'; -- coach cannot accept own invite
  end if;
  if exists (select 1 from public.trainer_clients
             where client_id = auth.uid() and status in ('active', 'paused')) then
    raise exception 'ALREADY_HAS_COACH';
  end if;

  update public.trainer_clients
  set client_id = auth.uid(), status = 'active', started_at = now(),
      invite_code = null, invite_expires_at = null
  where id = v_row.id;

  insert into public.conversations (coach_id, client_id)
  values (v_row.coach_id, auth.uid())
  on conflict (coach_id, client_id) do nothing;

  return v_row.id;
end;
$$;

-- start_coaching_from_request (20261108100000): the same rule; a new engagement is always a new row
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
  perform 1 from public.users where id = v_row.client_id for update;
  if exists (select 1 from public.trainer_clients where client_id = v_row.client_id and status in ('active', 'paused')) then
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
  perform public.coach_request_notify(v_row.client_id, auth.uid(), 'started', v_row.id);
  return v_tc;
end;
$$;

-- conversation_pair_open (20261104100000): messaging stays open while coaching is paused
create or replace function public.conversation_pair_open(p_coach uuid, p_client uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_coach is not null and p_client is not null and p_coach <> p_client
     and exists (select 1 from public.users u where u.id = p_coach and u.suspended_at is null)
     and exists (select 1 from public.users u where u.id = p_client and u.suspended_at is null)
     and not exists (select 1 from public.account_deletion_requests d where d.user_id in (p_coach, p_client))
     and not public.social_blocked_between(p_coach, p_client)
     and (exists (select 1 from public.trainer_clients tc
                  where tc.coach_id = p_coach and tc.client_id = p_client and tc.status in ('active', 'paused'))
          or exists (select 1 from public.coaching_requests r
                     where r.coach_id = p_coach and r.client_id = p_client
                       and r.status = 'accepted' and r.trainer_client_id is null));
$$;

-- coach_conversations (20261104100000): a thread can be with a paused client
create or replace function public.coach_conversations()
returns table (
  id uuid, client_id uuid, client_name text, client_avatar text,
  last_message text, last_at timestamptz, unread integer, relationship text, open boolean
) language sql stable security definer set search_path = public as $$
  select c.id, u.id, public.public_display_name(u.username, u.full_name), u.avatar_url,
         m.body, coalesce(m.created_at, c.created_at),
         (select count(*)::int from public.messages x
           where x.conversation_id = c.id and x.sender_id = c.client_id and x.read_at is null),
         case
           when exists (select 1 from public.trainer_clients tc
                        where tc.coach_id = c.coach_id and tc.client_id = c.client_id and tc.status = 'active') then 'active'
           when exists (select 1 from public.trainer_clients tc
                        where tc.coach_id = c.coach_id and tc.client_id = c.client_id and tc.status = 'paused') then 'paused'
           when exists (select 1 from public.coaching_requests r
                        where r.coach_id = c.coach_id and r.client_id = c.client_id
                          and r.status = 'accepted' and r.trainer_client_id is null) then 'request'
           else 'ended'
         end,
         public.conversation_pair_open(c.coach_id, c.client_id)
  from public.conversations c
  join public.users u on u.id = c.client_id
  left join lateral (select x.body, x.created_at from public.messages x
                     where x.conversation_id = c.id order by x.created_at desc limit 1) m on true
  where c.coach_id = auth.uid()
    and not public.social_blocked_between(c.coach_id, c.client_id)
  order by coalesce(m.created_at, c.created_at) desc
  limit 200;
$$;

-- conversation_context (20261104100000): a thread can be with a paused client
create or replace function public.conversation_context(p_conversation uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', c.id,
    'side', case when c.coach_id = auth.uid() then 'coach' else 'client' end,
    'other_id', o.id,
    'other_name', public.public_display_name(o.username, o.full_name),
    'other_avatar', o.avatar_url,
    'coach_slug', (select cp.slug from public.coach_profiles cp where cp.user_id = c.coach_id and cp.status = 'published'),
    'open', public.conversation_pair_open(c.coach_id, c.client_id),
    'relationship', case
       when exists (select 1 from public.trainer_clients tc
                    where tc.coach_id = c.coach_id and tc.client_id = c.client_id and tc.status = 'active') then 'active'
           when exists (select 1 from public.trainer_clients tc
                        where tc.coach_id = c.coach_id and tc.client_id = c.client_id and tc.status = 'paused') then 'paused'
       when exists (select 1 from public.coaching_requests r
                    where r.coach_id = c.coach_id and r.client_id = c.client_id
                      and r.status = 'accepted' and r.trainer_client_id is null) then 'request'
       else 'ended' end,
    'request', (select jsonb_build_object('id', r.id, 'service_name', sv.name, 'message', r.message, 'goal', r.goal,
                                          'preferred_format', r.preferred_format, 'created_at', r.created_at,
                                          'resolved_at', r.resolved_at, 'started', r.trainer_client_id is not null)
                from public.coaching_requests r
                left join public.coach_services sv on sv.id = r.service_id
                where r.coach_id = c.coach_id and r.client_id = c.client_id and r.status = 'accepted'
                order by r.created_at desc limit 1)
  )
  from public.conversations c
  join public.users o on o.id = case when c.coach_id = auth.uid() then c.client_id else c.coach_id end
  where c.id = p_conversation and auth.uid() in (c.coach_id, c.client_id);
$$;

-- coach_review_eligibility (20261106100000): a paused relationship ran like an active one
create or replace function public.coach_review_eligibility(p_reviewer uuid, p_coach uuid)
returns table (basis text, trainer_client_id uuid, booking_id uuid)
language sql stable security definer set search_path = public as $$
  (select 'coaching'::text, tc.id, null::uuid
   from public.trainer_clients tc
   where tc.client_id = p_reviewer and tc.coach_id = p_coach and tc.started_at is not null
     and ((tc.status in ('active', 'paused') and tc.started_at <= now() - interval '7 days') or tc.status = 'ended')
   order by (tc.status in ('active', 'paused')) desc, tc.started_at desc
   limit 1)
  union all
  (select 'booking'::text, null::uuid, b.id
   from public.bookings b
   where b.client_id = p_reviewer and b.coach_id = p_coach and b.status = 'completed'
   order by b.start_at desc
   limit 1)
  limit 1;
$$;

-- coach_viewer_state (20261103100000): + the reader's relationship; a paused other coach counts as a coach
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
                               where tc.client_id = auth.uid() and tc.status in ('active', 'paused') and tc.coach_id <> cp.user_id),
    -- the reader's own coaching with this coach, newest (current first): the CTA's source of truth (20261109110000)
    'relationship', (select jsonb_build_object('id', tc.id, 'status', tc.status, 'started_at', tc.started_at,
                                               'paused_at', tc.paused_at, 'ended_at', tc.ended_at)
                     from public.trainer_clients tc
                     where tc.coach_id = cp.user_id and tc.client_id = auth.uid() and tc.started_at is not null
                     order by (tc.status in ('active', 'paused')) desc, tc.started_at desc limit 1),
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

-- coach_requests (20261103100000): + relationship_status — "started" alone said nothing once coaching ended
drop function public.coach_requests(text);
create function public.coach_requests(p_status text default null)
returns table (
  id uuid, status text, client_id uuid, client_name text, client_username text, client_avatar text,
  service_name text, message text, goal text, preferred_format text, gym_name text,
  created_at timestamptz, resolved_at timestamptz, started boolean, relationship_status text
) language sql stable security definer set search_path = public as $$
  select r.id, r.status, u.id, public.public_display_name(u.username, u.full_name), u.username, u.avatar_url,
         sv.name, r.message, r.goal, r.preferred_format, g.name,
         r.created_at, r.resolved_at, r.trainer_client_id is not null,
         (select tc.status::text from public.trainer_clients tc where tc.id = r.trainer_client_id)
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

-- my_coaching_requests (20261103100000): + relationship_status — "started" alone said nothing once coaching ended
drop function public.my_coaching_requests();
create function public.my_coaching_requests()
returns table (
  id uuid, status text, coach_name text, coach_slug text, coach_avatar text,
  service_name text, message text, goal text, preferred_format text,
  created_at timestamptz, resolved_at timestamptz, started boolean, relationship_status text
) language sql stable security definer set search_path = public as $$
  select r.id, r.status, public.public_display_name(u.username, u.full_name),
         -- the coach's page only while it is public
         case when cp.status = 'published' then cp.slug end, u.avatar_url,
         sv.name, r.message, r.goal, r.preferred_format,
         r.created_at, r.resolved_at, r.trainer_client_id is not null,
         (select tc.status::text from public.trainer_clients tc where tc.id = r.trainer_client_id)
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

-- coach_marketplace_overview (20261108100000): + paused clients
create or replace function public.coach_marketplace_overview()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'profile', (select jsonb_build_object(
                  'id', cp.id, 'slug', cp.slug, 'status', cp.status, 'verification_status', cp.verification_status,
                  'accepting_clients', cp.accepting_clients, 'review_count', cp.review_count, 'review_avg', cp.review_avg,
                  'review_note', cp.review_note,
                  'revision_status', (select r.status from public.coach_profile_revisions r where r.coach_profile_id = cp.id))
                from public.coach_profiles cp where cp.user_id = auth.uid()),
    'requests', jsonb_build_object(
      'pending', (select count(*)::int from public.coaching_requests r where r.coach_id = auth.uid() and r.status = 'pending'),
      'accepted', (select count(*)::int from public.coaching_requests r
                   where r.coach_id = auth.uid() and r.status = 'accepted' and r.trainer_client_id is null)),
    'bookings', jsonb_build_object(
      'pending', (select count(*)::int from public.bookings b where b.coach_id = auth.uid() and b.status = 'pending' and b.start_at > now()),
      'upcoming', (select count(*)::int from public.bookings b where b.coach_id = auth.uid() and b.status = 'confirmed' and b.start_at > now()),
      'needs_outcome', (select count(*)::int from public.bookings b where b.coach_id = auth.uid() and b.status = 'confirmed' and b.start_at <= now()),
      'next', (select jsonb_build_object('start_at', b.start_at, 'end_at', b.end_at, 'timezone', b.timezone,
                                         'service_name', b.service_name, 'status', b.status,
                                         'client_name', public.public_display_name(u.username, u.full_name))
               from public.bookings b join public.users u on u.id = b.client_id
               where b.coach_id = auth.uid() and b.status in ('pending', 'confirmed') and b.start_at > now()
               order by b.start_at limit 1)),
    'clients', jsonb_build_object(
      'active', (select count(*)::int from public.trainer_clients tc where tc.coach_id = auth.uid() and tc.status = 'active'),
      'invited', (select count(*)::int from public.trainer_clients tc where tc.coach_id = auth.uid() and tc.status = 'invited'),
      'paused', (select count(*)::int from public.trainer_clients tc where tc.coach_id = auth.uid() and tc.status = 'paused')),
    'messages', jsonb_build_object(
      'unread', (select count(*)::int from public.messages m join public.conversations c on c.id = m.conversation_id
                 where c.coach_id = auth.uid() and m.sender_id = c.client_id and m.read_at is null),
      'conversations_unread', (select count(distinct c.id)::int from public.messages m join public.conversations c on c.id = m.conversation_id
                               where c.coach_id = auth.uid() and m.sender_id = c.client_id and m.read_at is null)),
    'services', (select jsonb_build_object('active', count(*) filter (where sv.active)::int,
                                           'bookable', count(*) filter (where sv.active and sv.bookable)::int)
                 from public.coach_services sv join public.coach_profiles cp on cp.id = sv.coach_profile_id
                 where cp.user_id = auth.uid()),
    'availability', jsonb_build_object(
      'blocks', (select count(*)::int from public.coach_availability a where a.coach_id = auth.uid() and a.active)),
    'reviews', jsonb_build_object(
      'latest', coalesce((select jsonb_agg(x order by x.created_at desc) from (
                  select r.id, r.rating, r.body, r.created_at, r.coach_response is not null as answered,
                         public.public_display_name(u.username, u.full_name) as reviewer_name
                  from public.coach_reviews r join public.users u on u.id = r.reviewer_id
                  where r.coach_id = auth.uid() and r.status = 'published'
                  order by r.created_at desc limit 3) x), '[]'::jsonb))
  )
  where auth.uid() is not null;
$$;

-- audit_trainer_clients (20260920100000): a resume is not "invitation accepted"; pauses are audited
create or replace function public.audit_trainer_clients()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.audit_log('INVITATION_CREATED', 'invitation', new.id::text, new.client_id,
      jsonb_build_object('expires_at', new.invite_expires_at), new.coach_id);
  elsif tg_op = 'UPDATE' and old.status is distinct from new.status then
    if new.status = 'active' and old.status = 'paused' then
      perform public.audit_log('RELATIONSHIP_RESUMED', 'relationship', new.id::text,
        case when auth.uid() = new.coach_id then new.client_id else new.coach_id end, '{}'::jsonb);
    elsif new.status = 'paused' then
      perform public.audit_log('RELATIONSHIP_PAUSED', 'relationship', new.id::text,
        case when auth.uid() = new.coach_id then new.client_id else new.coach_id end,
        jsonb_build_object('reason', new.pause_reason));
    elsif new.status = 'active' then
      perform public.audit_log('INVITATION_ACCEPTED', 'invitation', new.id::text, new.coach_id,
        '{}'::jsonb, new.client_id);
    elsif new.status = 'ended' and old.status = 'invited' then
      perform public.audit_log('INVITATION_REVOKED', 'invitation', new.id::text, new.client_id, '{}'::jsonb);
    elsif new.status = 'ended' then
      perform public.audit_log('RELATIONSHIP_ENDED', 'invitation', new.id::text,
        case when auth.uid() = new.coach_id then new.client_id else new.coach_id end, '{}'::jsonb);
    end if;
  end if;
  return new;
end;
$$;
