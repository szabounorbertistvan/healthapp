-- A coach comments on a client's workout or on one set (2026-12-07)
--
-- coach_feedback has carried reference_type 'session' and 'set' since the first
-- migration, but only 'check_in' was ever written (reviewCheckIn). The insert
-- policy asks only that the writer is the client's active coach — it never
-- asked whether reference_id is one of THAT client's rows, so a coach could
-- attach a comment to anybody's session id. Now:
--
--   coach_feedback_guard   before insert: the reference must exist and belong
--                          to client_id (a session, a set of theirs, a check-in
--                          of theirs). set_video stays refused: nothing writes
--                          set videos yet. body is trimmed, 1..4000 characters (the column's own bound).
--   coach_feedback_notify  after insert, for 'session' and 'set': one notice to
--                          the client, category coach_feedback (20261207100000),
--                          through social_notify_ok (no notice across a block).
--                          The check-in reply keeps showing on Today as before
--                          and sends no notice, as it never has.
--   coach_feedback_delete  the coach may take back their own comment within a
--                          day (a typo, the wrong client); after that it is a
--                          record, as the original design said.
--
-- Reads are unchanged: feedback_select lets coach and client read their rows.

create or replace function public.coach_feedback_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_ok boolean;
begin
  new.body := btrim(new.body);
  if length(new.body) < 1 or length(new.body) > 4000 then
    raise exception 'FEEDBACK_LENGTH' using errcode = '23514';
  end if;

  v_ok := case new.reference_type
    when 'session' then exists (select 1 from public.logged_sessions s
                                 where s.id = new.reference_id and s.user_id = new.client_id)
    when 'set' then exists (select 1 from public.logged_sets ls
                             where ls.id = new.reference_id and ls.user_id = new.client_id)
    when 'check_in' then exists (select 1 from public.check_ins c
                                  where c.id = new.reference_id and c.user_id = new.client_id)
    else false
  end;
  if not v_ok then
    raise exception 'FEEDBACK_REFERENCE' using errcode = '23503';
  end if;
  return new;
end;
$$;
revoke execute on function public.coach_feedback_guard() from public, anon, authenticated;

drop trigger if exists coach_feedback_guard on public.coach_feedback;
create trigger coach_feedback_guard before insert on public.coach_feedback
  for each row execute function public.coach_feedback_guard();

create or replace function public.coach_feedback_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_session uuid;
  v_name text;
begin
  if new.reference_type not in ('session', 'set') then
    return null;
  end if;
  if not public.social_notify_ok(new.client_id, new.coach_id) then
    return null;
  end if;
  v_session := case new.reference_type
    when 'session' then new.reference_id
    else (select ls.session_id from public.logged_sets ls where ls.id = new.reference_id)
  end;
  select public.public_display_name(u.username, u.full_name) into v_name from public.users u where u.id = new.coach_id;
  insert into public.notifications (user_id, category, title, body, payload)
  values (new.client_id, 'coach_feedback', 'Coach feedback',
          coalesce(v_name, 'Your coach') || ' commented on your workout',
          jsonb_build_object('feedback_id', new.id, 'reference_type', new.reference_type,
                             'reference_id', new.reference_id, 'session_id', v_session,
                             'actor_id', new.coach_id, 'screen', 'session'));
  return null;
end;
$$;
revoke execute on function public.coach_feedback_notify() from public, anon, authenticated;

drop trigger if exists coach_feedback_notify on public.coach_feedback;
create trigger coach_feedback_notify after insert on public.coach_feedback
  for each row execute function public.coach_feedback_notify();

drop policy if exists feedback_coach_delete on public.coach_feedback;
create policy feedback_coach_delete on public.coach_feedback for delete to authenticated
  using (coach_id = auth.uid() and created_at > now() - interval '1 day');
grant delete on table public.coach_feedback to authenticated;

-- the coach's comments on one session (the session and its sets), newest first;
-- RLS answers who may read, this only gathers them in one round trip
create index if not exists coach_feedback_coach_idx on public.coach_feedback (coach_id, created_at desc);
