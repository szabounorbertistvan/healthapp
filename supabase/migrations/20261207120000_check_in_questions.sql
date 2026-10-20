-- Check-in questions a coach writes, answered with the weekly check-in (2026-12-07)
--
-- The weekly check-in asks five fixed 1..10 scales (sleep, energy, stress,
-- hunger, recovery) plus weight and a note. A coach now adds their own
-- questions on top — "How many steps a day?", "Any pain this week?" — for all
-- their clients or for one.
--
--   check_in_questions  owned by the coach. client_id null = every client of
--                       theirs; set = that client only. kind decides the answer:
--                       scale (1..10), number, yes_no, text. At most 12 active
--                       per coach; deactivated, never deleted once answered, so
--                       old answers keep their question.
--   check_in_answers    one per (check-in, question). prompt and kind are copied
--                       from the question when answered (a trigger), so editing
--                       the wording later never rewrites what was asked.
--
-- Who sees what: the coach owns their questions; a client reads the active
-- questions of their CURRENT active coach that are meant for them; answers
-- belong to the check-in's owner (write while it is the current week's) and
-- are read by them and by their active coach (is_active_coach_of) — the same
-- rule the check-in itself follows.

create table public.check_in_questions (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.users (id) on delete cascade,
  client_id uuid references public.users (id) on delete cascade,
  prompt text not null check (length(btrim(prompt)) between 1 and 200),
  kind text not null check (kind in ('scale', 'number', 'yes_no', 'text')),
  position int not null default 0 check (position between 0 and 100),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (client_id is null or client_id <> coach_id)
);
create index check_in_questions_coach_idx on public.check_in_questions (coach_id, active, position);
create index check_in_questions_client_idx on public.check_in_questions (client_id) where client_id is not null;
create trigger check_in_questions_updated before update on public.check_in_questions
  for each row execute function public.handle_updated_at();

create table public.check_in_answers (
  id uuid primary key default gen_random_uuid(),
  check_in_id uuid not null references public.check_ins (id) on delete cascade,
  question_id uuid references public.check_in_questions (id) on delete set null,
  prompt text not null,
  kind text not null check (kind in ('scale', 'number', 'yes_no', 'text')),
  value_num numeric(10,2),
  value_bool boolean,
  value_text text check (value_text is null or length(value_text) between 1 and 1000),
  created_at timestamptz not null default now(),
  unique (check_in_id, question_id),
  check (
    (kind = 'scale'  and value_num between 1 and 10 and value_num = trunc(value_num) and value_bool is null and value_text is null) or
    (kind = 'number' and value_num is not null and value_num between -100000 and 100000 and value_bool is null and value_text is null) or
    (kind = 'yes_no' and value_bool is not null and value_num is null and value_text is null) or
    (kind = 'text'   and value_text is not null and value_num is null and value_bool is null)
  )
);
create index check_in_answers_check_in_idx on public.check_in_answers (check_in_id);

alter table public.check_in_questions enable row level security;
alter table public.check_in_answers enable row level security;

-- is this coach the caller's current active coach?
create or replace function public.is_my_active_coach(p_coach uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.trainer_clients tc
                  where tc.coach_id = p_coach and tc.client_id = auth.uid() and tc.status = 'active');
$$;
revoke execute on function public.is_my_active_coach(uuid) from public, anon;
grant execute on function public.is_my_active_coach(uuid) to authenticated;

create policy ciq_coach_all on public.check_in_questions for all to authenticated
  using (coach_id = auth.uid())
  with check (coach_id = auth.uid() and (client_id is null or public.is_active_coach_of(client_id)));
create policy ciq_client_read on public.check_in_questions for select to authenticated
  using (active and (client_id is null or client_id = auth.uid()) and public.is_my_active_coach(coach_id));

create policy cia_owner_read on public.check_in_answers for select to authenticated
  using (exists (select 1 from public.check_ins c where c.id = check_in_id and c.user_id = auth.uid()));
create policy cia_coach_read on public.check_in_answers for select to authenticated
  using (exists (select 1 from public.check_ins c where c.id = check_in_id and public.is_active_coach_of(c.user_id)));
create policy cia_owner_write on public.check_in_answers for insert to authenticated
  with check (exists (select 1 from public.check_ins c where c.id = check_in_id and c.user_id = auth.uid()
                        and c.coach_reviewed_at is null));
create policy cia_owner_update on public.check_in_answers for update to authenticated
  using (exists (select 1 from public.check_ins c where c.id = check_in_id and c.user_id = auth.uid()
                   and c.coach_reviewed_at is null))
  with check (exists (select 1 from public.check_ins c where c.id = check_in_id and c.user_id = auth.uid()
                        and c.coach_reviewed_at is null));

revoke all on public.check_in_questions, public.check_in_answers from anon;
revoke all on public.check_in_questions, public.check_in_answers from authenticated;
grant select, insert, delete on public.check_in_questions to authenticated;
grant update (prompt, kind, position, active, client_id) on public.check_in_questions to authenticated;
grant select on public.check_in_answers to authenticated;
grant insert (check_in_id, question_id, value_num, value_bool, value_text) on public.check_in_answers to authenticated;
grant update (value_num, value_bool, value_text) on public.check_in_answers to authenticated;

-- ---------- guards ----------
create or replace function public.check_in_questions_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.prompt := btrim(new.prompt);
  if new.active and (tg_op = 'INSERT' or not old.active) and
     (select count(*) from public.check_in_questions q
       where q.coach_id = new.coach_id and q.active and q.id <> new.id) >= 12 then
    raise exception 'CHECK_IN_QUESTION_LIMIT' using errcode = '23514';
  end if;
  -- a question someone already answered keeps its kind: the answers were given to it
  if tg_op = 'UPDATE' and new.kind <> old.kind
     and exists (select 1 from public.check_in_answers a where a.question_id = old.id) then
    raise exception 'CHECK_IN_QUESTION_ANSWERED' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke execute on function public.check_in_questions_guard() from public, anon, authenticated;
create trigger check_in_questions_guard before insert or update on public.check_in_questions
  for each row execute function public.check_in_questions_guard();

-- an answered question is deactivated, not deleted
create or replace function public.check_in_questions_keep_answered()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.check_in_answers a where a.question_id = old.id) then
    raise exception 'CHECK_IN_QUESTION_ANSWERED' using errcode = '23514';
  end if;
  return old;
end;
$$;
revoke execute on function public.check_in_questions_keep_answered() from public, anon, authenticated;
create trigger check_in_questions_keep_answered before delete on public.check_in_questions
  for each row execute function public.check_in_questions_keep_answered();

-- the answer copies the question it answers, and only a question meant for this client counts
create or replace function public.check_in_answers_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_q public.check_in_questions%rowtype;
  v_owner uuid;
begin
  if tg_op = 'UPDATE' then
    new.check_in_id := old.check_in_id;
    new.question_id := old.question_id;
    new.prompt := old.prompt;
    new.kind := old.kind;
    return new;
  end if;
  select user_id into v_owner from public.check_ins where id = new.check_in_id;
  select * into v_q from public.check_in_questions where id = new.question_id;
  if not found or not v_q.active or (v_q.client_id is not null and v_q.client_id <> v_owner)
     or not exists (select 1 from public.trainer_clients tc
                     where tc.coach_id = v_q.coach_id and tc.client_id = v_owner and tc.status = 'active') then
    raise exception 'CHECK_IN_QUESTION_UNKNOWN' using errcode = '23503';
  end if;
  new.prompt := v_q.prompt;
  new.kind := v_q.kind;
  new.value_text := nullif(btrim(new.value_text), '');
  return new;
end;
$$;
revoke execute on function public.check_in_answers_guard() from public, anon, authenticated;
create trigger check_in_answers_guard before insert or update on public.check_in_answers
  for each row execute function public.check_in_answers_guard();
