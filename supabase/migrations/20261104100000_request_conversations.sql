-- HealthApp schema · Coach Discovery: an accepted request gets a conversation
--
-- Accepting a contact request (20261103100000) means "let's talk", but until
-- now there was nowhere to talk: a conversation row was only created when the
-- coach started coaching (start_coaching_from_request) or a client redeemed
-- an invite (accept_invite), and messages.insert asked only "are you in this
-- conversation". This migration reuses conversations / messages as they are —
-- one row per (coach, client), unique — and adds:
--
-- 1. Who may write. conversation_pair_open(coach, client): both accounts live
--    (not suspended, no deletion pending), no block either way, and either an
--    active trainer_clients row or an accepted request that has not become a
--    relationship yet. msg_insert now asks conversation_open() — so a
--    blocked, suspended, deleting or ended pair keeps its history readable
--    (conv_select / msg_select are unchanged) but takes no new message.
--    Accepted request != relationship: messaging needs only the first.
--
-- 2. Where the conversation comes from. open_request_conversation(request):
--    either party of an accepted request, on click of "Message coach" /
--    "Message client". It returns the pair's existing conversation if there
--    is one (from an earlier coaching, or the other side opening it first)
--    and otherwise creates it — no message is sent. conv_insert stays
--    coach-and-active-only; this door is keyed by a request the caller is a
--    party to, so nobody opens a conversation by knowing a user id.
--    start_coaching_from_request() already inserts "on conflict do nothing",
--    so starting coaching reuses the thread and its messages.
--
-- 3. The notice. Nothing wrote the existing new_message category until now.
--    A message tells the other party (social_notify_ok: not across a block,
--    not to or from a suspended or deleting account) — one unread notice per
--    conversation, no message text in it (it is pushed off-device), and
--    payload.screen says which side's thread to open.
--
-- 4. Read state. mark_conversation_read() stamps read_at on what the other
--    party sent, and reads that conversation's notice. The table-wide UPDATE
--    grant (which let a participant rewrite the other side's message body)
--    narrows to read_at.
--
-- 5. Reads. coach_conversations() for the coach's inbox (the client's public
--    name, which the users policy does not show for a request-only pair) and
--    conversation_context() for a thread's header: who, whether it is open,
--    and the accepted request it came from.
--
-- Request semantics are unchanged (20261103100000): accept, decline, cancel
-- (pending only), start. A second request to a coach who already accepted
-- one stays allowed and opens no second thread: conversations are per pair.
--
-- Not here: booking, payment, attachments. Messaging never changes a
-- request's status or creates a relationship.

-- ---------- 1. who may write ----------
create or replace function public.conversation_pair_open(p_coach uuid, p_client uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_coach is not null and p_client is not null and p_coach <> p_client
     and exists (select 1 from public.users u where u.id = p_coach and u.suspended_at is null)
     and exists (select 1 from public.users u where u.id = p_client and u.suspended_at is null)
     and not exists (select 1 from public.account_deletion_requests d where d.user_id in (p_coach, p_client))
     and not public.social_blocked_between(p_coach, p_client)
     and (exists (select 1 from public.trainer_clients tc
                  where tc.coach_id = p_coach and tc.client_id = p_client and tc.status = 'active')
          or exists (select 1 from public.coaching_requests r
                     where r.coach_id = p_coach and r.client_id = p_client
                       and r.status = 'accepted' and r.trainer_client_id is null));
$$;
-- internal: answering it for any pair would tell a caller who blocked whom
revoke execute on function public.conversation_pair_open(uuid, uuid) from public, anon, authenticated;

/** The caller is in this conversation and the pair may write to it now. */
create or replace function public.conversation_open(p_conversation uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.conversations c
    where c.id = p_conversation
      and auth.uid() in (c.coach_id, c.client_id)
      and public.conversation_pair_open(c.coach_id, c.client_id));
$$;
revoke execute on function public.conversation_open(uuid) from public, anon;
grant execute on function public.conversation_open(uuid) to authenticated;

drop policy if exists msg_insert on public.messages;
create policy msg_insert on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and public.conversation_open(conversation_id));

-- ---------- 2. the conversation an accepted request opens ----------
create or replace function public.open_request_conversation(p_request uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_row public.coaching_requests;
  v_id uuid;
begin
  if not public.social_actor_active() then
    raise exception 'NOT_SIGNED_IN' using errcode = '42501';
  end if;
  select * into v_row from public.coaching_requests
   where id = p_request and auth.uid() in (coach_id, client_id);
  if not found then
    raise exception 'REQUEST_NOT_FOUND' using errcode = 'P0002';
  end if;
  -- One conversation per pair: an existing one is always the answer. Its
  -- history is the caller's to read already (conv_select); whether they may
  -- still write is conversation_open()'s call, not this function's.
  select c.id into v_id from public.conversations c
   where c.coach_id = v_row.coach_id and c.client_id = v_row.client_id;
  if v_id is not null then
    return v_id;
  end if;
  if v_row.status <> 'accepted' or not public.conversation_pair_open(v_row.coach_id, v_row.client_id) then
    raise exception 'CONVERSATION_CLOSED' using errcode = '55000';
  end if;
  insert into public.conversations (coach_id, client_id)
  values (v_row.coach_id, v_row.client_id)
  on conflict (coach_id, client_id) do nothing
  returning id into v_id;
  if v_id is null then -- the other side opened it in the same instant
    select c.id into v_id from public.conversations c
     where c.coach_id = v_row.coach_id and c.client_id = v_row.client_id;
  end if;
  return v_id;
end;
$$;
revoke execute on function public.open_request_conversation(uuid) from public, anon;
grant execute on function public.open_request_conversation(uuid) to authenticated;

-- ---------- 3. the notice ----------
create or replace function public.message_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_coach uuid;
  v_client uuid;
  v_to uuid;
  v_name text;
begin
  select c.coach_id, c.client_id into v_coach, v_client from public.conversations c where c.id = new.conversation_id;
  v_to := case when new.sender_id = v_coach then v_client else v_coach end;
  if not public.social_notify_ok(v_to, new.sender_id) then
    return null;
  end if;
  -- one unread notice per conversation: the thread itself shows how many
  if exists (select 1 from public.notifications n
             where n.user_id = v_to and n.category = 'new_message' and n.read_at is null
               and n.payload ->> 'conversation_id' = new.conversation_id::text) then
    return null;
  end if;
  select public.public_display_name(u.username, u.full_name) into v_name from public.users u where u.id = new.sender_id;
  insert into public.notifications (user_id, category, title, body, payload)
  values (v_to, 'new_message', 'New message', coalesce(v_name, 'Someone') || ' sent you a message',
          jsonb_build_object('conversation_id', new.conversation_id, 'actor_id', new.sender_id,
                             'screen', case when v_to = v_coach then 'coach_thread' else 'client_thread' end));
  return null;
end;
$$;
revoke execute on function public.message_notify() from public, anon, authenticated;

drop trigger if exists messages_notify on public.messages;
create trigger messages_notify after insert on public.messages
  for each row execute function public.message_notify();

-- ---------- 4. read state ----------
create or replace function public.mark_conversation_read(p_conversation uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  if not exists (select 1 from public.conversations c
                 where c.id = p_conversation and auth.uid() in (c.coach_id, c.client_id)) then
    return 0;
  end if;
  update public.messages set read_at = now()
   where conversation_id = p_conversation and sender_id <> auth.uid() and read_at is null;
  get diagnostics v_count = row_count;
  update public.notifications set read_at = now()
   where user_id = auth.uid() and category = 'new_message' and read_at is null
     and payload ->> 'conversation_id' = p_conversation::text;
  return v_count;
end;
$$;
revoke execute on function public.mark_conversation_read(uuid) from public, anon;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

revoke update on table public.messages from authenticated;
grant update (read_at) on table public.messages to authenticated;

-- ---------- 5. reads ----------
/**
 * The coach's inbox: conversations where the caller is the coach, newest
 * activity first. relationship: active (coaching), request (an accepted
 * request, not started), ended (history only). open: may still write.
 */
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
revoke execute on function public.coach_conversations() from public, anon;
grant execute on function public.coach_conversations() to authenticated;

/**
 * A thread's header, for a participant only (null otherwise): which side the
 * caller is on, the other party's public name, whether the pair may write,
 * and the accepted request the conversation came from — shown above the
 * thread so nobody has to write their request a second time.
 */
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
revoke execute on function public.conversation_context(uuid) from public, anon;
grant execute on function public.conversation_context(uuid) to authenticated;
