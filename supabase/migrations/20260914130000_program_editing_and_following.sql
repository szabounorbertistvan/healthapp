-- HealthApp schema · program editing, solo/coached permissions, following
--
-- 1. Circuits / supersets: program_exercises.circuit — exercises in a day
--    that share a circuit number are linked ("Circuit A" = 1, "B" = 2 …) and
--    keep their `position` order inside it. Null = a plain exercise. No new
--    table: a circuit is a label on the rows that already form the day.
-- 2. Who may edit a program (PRODUCT_SPEC §4, sharpened): a coach edits the
--    programs they wrote for their active clients; a client edits only the
--    programs they own themselves (coach_id null) — and only while they have
--    no active coach. The moment a coach relationship becomes active the
--    client's own programs turn read-only for them (they keep seeing them).
--    programs_solo_all used to allow writes regardless of a coach; it is
--    split into a read policy and a write policy gated by has_active_coach().
-- 3. move_program_day(): swap a day with its neighbour atomically. The unique
--    key (program_id, week_index, day_index) forbids two rows sharing an
--    index mid-swap, so it goes through a placeholder inside one function.
--    Logged sessions point at program_days.id, never at day_index, so
--    reordering a program never touches history.
-- 4. Following: social_follows already has the unique pair, the no-self
--    check and owner-only policies. Added: social_follow_list() so anyone can
--    read who follows / is followed by a person they can see (security
--    definer — users_select hides names), and a trigger that writes one
--    'new_follower' notification per (follower, followed) ever — a follow /
--    unfollow / follow does not ping twice.

-- ---------- 1. circuits ----------
alter table public.program_exercises
  add column if not exists circuit smallint check (circuit between 1 and 26);
comment on column public.program_exercises.circuit is
  'Exercises of a day sharing a circuit number are linked as a superset/circuit (1 = A, 2 = B …). Null = standalone.';

-- ---------- 2. who edits a program ----------
/** True while the caller is a client with an active coach. */
create or replace function public.has_active_coach()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.trainer_clients
    where client_id = auth.uid() and status = 'active'
  );
$$;
grant execute on function public.has_active_coach() to authenticated;

/** May the caller write to this program? Its coach, or its solo owner while uncoached. */
create or replace function public.can_edit_program(p_program uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.programs p
    where p.id = p_program
      and (
        (p.coach_id = auth.uid())
        or (p.coach_id is null and p.client_id = auth.uid() and not public.has_active_coach())
      )
  );
$$;
grant execute on function public.can_edit_program(uuid) to authenticated;

drop policy if exists programs_solo_all on public.programs;
create policy programs_solo_read on public.programs for select to authenticated
  using (coach_id is null and client_id = auth.uid());
create policy programs_solo_insert on public.programs for insert to authenticated
  with check (coach_id is null and client_id = auth.uid() and not public.has_active_coach());
create policy programs_solo_update on public.programs for update to authenticated
  using (coach_id is null and client_id = auth.uid() and not public.has_active_coach())
  with check (coach_id is null and client_id = auth.uid() and not public.has_active_coach());
create policy programs_solo_delete on public.programs for delete to authenticated
  using (coach_id is null and client_id = auth.uid() and not public.has_active_coach());

drop policy if exists program_days_rw on public.program_days;
create policy program_days_read on public.program_days for select to authenticated
  using (exists (select 1 from public.programs p where p.id = program_id
           and (p.coach_id = auth.uid() or (p.coach_id is null and p.client_id = auth.uid()))));
create policy program_days_write on public.program_days for insert to authenticated
  with check (public.can_edit_program(program_id));
create policy program_days_update on public.program_days for update to authenticated
  using (public.can_edit_program(program_id)) with check (public.can_edit_program(program_id));
create policy program_days_delete on public.program_days for delete to authenticated
  using (public.can_edit_program(program_id));

drop policy if exists program_exercises_rw on public.program_exercises;
create policy program_exercises_read on public.program_exercises for select to authenticated
  using (exists (select 1 from public.program_days d join public.programs p on p.id = d.program_id
           where d.id = program_day_id
           and (p.coach_id = auth.uid() or (p.coach_id is null and p.client_id = auth.uid()))));
create policy program_exercises_write on public.program_exercises for insert to authenticated
  with check (exists (select 1 from public.program_days d where d.id = program_day_id and public.can_edit_program(d.program_id)));
create policy program_exercises_update on public.program_exercises for update to authenticated
  using (exists (select 1 from public.program_days d where d.id = program_day_id and public.can_edit_program(d.program_id)))
  with check (exists (select 1 from public.program_days d where d.id = program_day_id and public.can_edit_program(d.program_id)));
create policy program_exercises_delete on public.program_exercises for delete to authenticated
  using (exists (select 1 from public.program_days d where d.id = program_day_id and public.can_edit_program(d.program_id)));

-- ---------- 3. reorder days ----------
-- Swap `p_day` with the day before (-1) or after (+1) it in the same week.
-- Runs as the caller: the updates go through the policies above, so a
-- coached client or a stranger changes nothing. Returns true when a swap
-- happened, false at the edge of the list.
create or replace function public.move_program_day(p_day uuid, p_direction int)
returns boolean language plpgsql security invoker set search_path = public as $$
declare
  v_me public.program_days;
  v_other public.program_days;
  v_n int;
begin
  if p_direction not in (-1, 1) then
    raise exception 'direction must be -1 or 1' using errcode = '22023';
  end if;
  select * into v_me from public.program_days where id = p_day;
  if not found then return false; end if;
  if not public.can_edit_program(v_me.program_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into v_other from public.program_days
  where program_id = v_me.program_id and week_index = v_me.week_index
    and (case when p_direction < 0 then day_index < v_me.day_index else day_index > v_me.day_index end)
  order by (case when p_direction < 0 then -day_index else day_index end)
  limit 1;
  if not found then return false; end if;

  -- three moves through a placeholder the unique key never sees twice
  update public.program_days set day_index = -1 where id = v_me.id;
  update public.program_days set day_index = v_me.day_index where id = v_other.id;
  update public.program_days set day_index = v_other.day_index where id = v_me.id;
  get diagnostics v_n = row_count;
  return v_n = 1;
end;
$$;
grant execute on function public.move_program_day(uuid, int) to authenticated;

-- ---------- 4. following ----------
-- Who follows / is followed by a person: name, handle, avatar, whether the
-- caller follows them, newest first, cursor on created_at.
create or replace function public.social_follow_list(
  p_user uuid,
  p_which text,
  p_limit int default 20,
  p_before timestamptz default null
)
returns table (id uuid, name text, username text, avatar_url text, is_following boolean, followed_at timestamptz)
language plpgsql stable security definer set search_path = public as $
#variable_conflict use_column
begin
  if p_which not in ('followers', 'following') then
    raise exception 'unknown list' using errcode = '22023';
  end if;
  if auth.uid() is null then return; end if;
  return query
  select u.id, coalesce(u.username, u.full_name), u.username, u.avatar_url,
         public.is_following(u.id), f.created_at
  from public.social_follows f
  join public.users u on u.id = (case when p_which = 'followers' then f.follower_id else f.following_id end)
  where (case when p_which = 'followers' then f.following_id else f.follower_id end) = p_user
    and (p_before is null or f.created_at < p_before)
  order by f.created_at desc, f.id desc
  limit greatest(1, least(p_limit, 50));
end;
$$;
grant execute on function public.social_follow_list(uuid, text, int, timestamptz) to authenticated;

-- "Maria started following you." — once per pair, ever.
create or replace function public.notify_new_follower()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name text;
begin
  if exists (
    select 1 from public.notifications n
    where n.user_id = new.following_id and n.category = 'new_follower'
      and n.payload ->> 'follower_id' = new.follower_id::text
  ) then
    return new;
  end if;
  select coalesce(u.username, u.full_name, 'Someone') into v_name from public.users u where u.id = new.follower_id;
  insert into public.notifications (user_id, category, title, body, payload)
  values (new.following_id, 'new_follower', 'New follower', v_name || ' started following you',
          jsonb_build_object('follower_id', new.follower_id));
  return new;
end;
$$;
drop trigger if exists social_follows_notify on public.social_follows;
create trigger social_follows_notify after insert on public.social_follows
  for each row execute function public.notify_new_follower();

-- ---------- 5. habits: the owner may archive any habit of theirs ----------
-- habits_owner's with-check also demanded created_by = auth.uid(), so a client
-- could not archive (active = false) a habit their coach had added for them.
-- The habit is theirs to keep or drop; the coach keeps their own policy.
create policy habits_owner_update on public.habits for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
