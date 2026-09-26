-- HealthApp schema · advanced challenges
--
-- Extends the one challenge system (20260912100000); no second one.
--
-- 1. Progress moves into the database, per member. challenge_value() folds
--    the rows people logged, on each member's own calendar (users.timezone),
--    for every type — the four existing ones with the rules they already had
--    (challenge_progress_rows + challengeProgress), and five new ones:
--      exercise_sessions   sessions in the window that trained one exercise
--      strength_gain       % gain of the best estimated 1RM of one exercise in
--                          the window over its best before the start
--                          (relevantOneRm's rule: loaded, 1..12 reps, a single
--                          at face value; ranked on e1RM×30 so it stays exact)
--      check_ins           check-ins submitted on a local day in the window
--      nutrition_days      days with food logged and calories > 0 (the
--                          nutrition trends rule)
--      habit_completions   habit ticks in the window
--    Nothing a client sends is progress: the value is always recomputed here.
--
-- 2. Completion and milestones are stamped HERE, not by the app. Until now the
--    app wrote challenge_participants.completed_at itself, and the policy let
--    a participant update any column of their own row — so anyone could mark
--    themselves complete (and collect the first-challenge badge) over
--    PostgREST. Now participants have no UPDATE at all; challenge_cards()
--    stamps each 25/50/75/100 % milestone once (primary key) and completion
--    once (`where completed_at is null`), so a refresh or two racing requests
--    cannot produce two events, and sends at most ONE notification per
--    challenge per read — the highest step newly reached.
--
-- 3. The leaderboard stops shipping per-session rollups of every participant,
--    with full_name (which falls back to the e-mail at sign-up), to anyone who
--    can see a public challenge. challenge_leaderboard() returns rank (ties
--    share it: 1, 1, 3), username, total and the participant count — the top N
--    plus the caller. challenge_progress_rows() is closed to the app, and the
--    participant list is no longer readable by strangers.
--
-- 4. Challenges gain `difficulty` and `exercise_id`. Creators may edit the
--    words of their own challenge, never its type, target or dates (people
--    joined on those). Platform challenges (creator_id null) stay uneditable
--    and cannot be created from the app.
--
-- 5. Joining checks the member's local "today", not the database's UTC one.

-- ---------- 1. the model ----------
alter table public.challenges drop constraint if exists challenges_type_check;
alter table public.challenges add constraint challenges_type_check
  check (type in ('workouts', 'training_load', 'volume', 'active_days',
                  'exercise_sessions', 'strength_gain', 'check_ins', 'nutrition_days', 'habit_completions'));

alter table public.challenges
  add column if not exists difficulty text check (difficulty is null or difficulty in ('easy', 'medium', 'hard')),
  add column if not exists exercise_id uuid references public.exercises (id);

alter table public.challenges drop constraint if exists challenges_exercise_matches_type;
alter table public.challenges add constraint challenges_exercise_matches_type
  check ((type in ('exercise_sessions', 'strength_gain')) = (exercise_id is not null));

comment on column public.challenges.exercise_id is
  'The lift an exercise_sessions / strength_gain challenge is about; null for every other type.';

alter type public.notification_category add value if not exists 'challenge_milestone';

create table if not exists public.challenge_milestones (
  participant_id uuid not null references public.challenge_participants (id) on delete cascade,
  milestone smallint not null check (milestone in (25, 50, 75, 100)),
  reached_at timestamptz not null default now(),
  primary key (participant_id, milestone)
);
alter table public.challenge_milestones enable row level security;
drop policy if exists challenge_milestones_own on public.challenge_milestones;
create policy challenge_milestones_own on public.challenge_milestones for select to authenticated
  using (exists (select 1 from public.challenge_participants p
                 where p.id = participant_id and p.user_id = auth.uid()));
grant select on table public.challenge_milestones to authenticated;
grant select, insert, update, delete on table public.challenge_milestones to service_role;

-- ---------- 2. what the app may write ----------
revoke insert, update on table public.challenges from authenticated;
grant insert (title_en, title_ro, description_en, description_ro, type, target_value,
              start_date, end_date, creator_id, visibility, difficulty, exercise_id)
  on table public.challenges to authenticated;
grant update (title_en, title_ro, description_en, description_ro, difficulty)
  on table public.challenges to authenticated;

revoke insert, update on table public.challenge_participants from authenticated;
grant insert (challenge_id, user_id) on table public.challenge_participants to authenticated;
drop policy if exists participants_own_update on public.challenge_participants;

-- Only your own rows and your active clients'. The count and the board come
-- from the functions below; nobody lists who else joined.
drop policy if exists participants_select on public.challenge_participants;
create policy participants_select on public.challenge_participants for select to authenticated
  using (user_id = auth.uid() or public.is_active_coach_of(user_id));

/** The signed-in member's calendar day (users.timezone), for "has it ended?". */
create or replace function public.my_local_today()
returns date language sql stable security definer set search_path = public as $$
  select (now() at time zone coalesce(
    (select u.timezone from public.users u where u.id = auth.uid()), 'Europe/Bucharest'))::date;
$$;
grant execute on function public.my_local_today() to authenticated;

drop policy if exists participants_join on public.challenge_participants;
create policy participants_join on public.challenge_participants for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.can_see_challenge(challenge_id)
    and exists (select 1 from public.challenges c
                where c.id = challenge_id and c.end_date >= public.my_local_today())
  );

-- ---------- 3. progress ----------
/**
 * One member's progress in one challenge, in the challenge's unit, exact.
 * Internal: callable only by the security-definer functions below, which
 * decide whose value the caller may learn.
 */
create or replace function public.challenge_value(p_challenge uuid, p_user uuid)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare
  c public.challenges;
  tz text;
  v numeric;
  base_key numeric;
  cur_key numeric;
begin
  select * into c from public.challenges where id = p_challenge;
  if not found then return null; end if;
  select coalesce(u.timezone, 'Europe/Bucharest') into tz from public.users u where u.id = p_user;
  tz := coalesce(tz, 'Europe/Bucharest');

  if c.type = 'workouts' then
    select count(*) into v from public.logged_sessions s
    where s.user_id = p_user and s.completed_at is not null
      and (s.started_at at time zone tz)::date between c.start_date and c.end_date;

  elsif c.type = 'volume' then
    select coalesce(sum(greatest(ls.weight_kg, 0) * ls.reps), 0) into v
    from public.logged_sessions s join public.logged_sets ls on ls.session_id = s.id
    where s.user_id = p_user and s.completed_at is not null and ls.reps > 0
      and (s.started_at at time zone tz)::date between c.start_date and c.end_date;

  elsif c.type = 'training_load' then
    -- The same per-session rollup challenge_progress_rows produced, scored by
    -- training_load_score() (trainingLoadFromStats in SQL).
    select coalesce(sum(public.training_load_score(
             r.volume_kg::double precision, r.sets, r.duration_min, r.mean_rpe::double precision, r.exercises)), 0)
      into v
    from (
      select
        count(ls.id) filter (where ls.reps > 0)::int as sets,
        coalesce(sum(greatest(ls.weight_kg, 0) * ls.reps) filter (where ls.reps > 0), 0) as volume_kg,
        nullif(round(extract(epoch from (s.completed_at - s.started_at)) / 60)::int, 0) as duration_min,
        avg(public.effective_rpe(ls.rpe, ls.rir)) filter (where ls.reps > 0) as mean_rpe,
        count(distinct ls.exercise_id) filter (where ls.reps > 0)::int as exercises
      from public.logged_sessions s
      left join public.logged_sets ls on ls.session_id = s.id
      where s.user_id = p_user and s.completed_at is not null
        and (s.started_at at time zone tz)::date between c.start_date and c.end_date
      group by s.id, s.started_at, s.completed_at
    ) r;

  elsif c.type = 'active_days' then
    select count(*) into v from (
      select (s.started_at at time zone tz)::date as d from public.logged_sessions s
      where s.user_id = p_user and s.completed_at is not null
        and (s.started_at at time zone tz)::date between c.start_date and c.end_date
      union
      select f.date from public.food_logs f
      where f.user_id = p_user and f.date between c.start_date and c.end_date
      union
      select h.date from public.habit_logs h
      where h.user_id = p_user and h.date between c.start_date and c.end_date
    ) days;

  elsif c.type = 'exercise_sessions' then
    select count(distinct s.id) into v
    from public.logged_sessions s join public.logged_sets ls on ls.session_id = s.id
    where s.user_id = p_user and s.completed_at is not null
      and ls.exercise_id = c.exercise_id and ls.reps > 0
      and (s.started_at at time zone tz)::date between c.start_date and c.end_date;

  elsif c.type = 'strength_gain' then
    -- e1RM × 30, exact: a single at face value, otherwise weight × (30 + reps).
    select max(case when ls.reps = 1 then ls.weight_kg * 30 else ls.weight_kg * (30 + ls.reps) end)
      into base_key
    from public.logged_sessions s join public.logged_sets ls on ls.session_id = s.id
    where s.user_id = p_user and s.completed_at is not null
      and ls.exercise_id = c.exercise_id and ls.weight_kg > 0 and ls.reps between 1 and 12
      and (s.started_at at time zone tz)::date < c.start_date;
    select max(case when ls.reps = 1 then ls.weight_kg * 30 else ls.weight_kg * (30 + ls.reps) end)
      into cur_key
    from public.logged_sessions s join public.logged_sets ls on ls.session_id = s.id
    where s.user_id = p_user and s.completed_at is not null
      and ls.exercise_id = c.exercise_id and ls.weight_kg > 0 and ls.reps between 1 and 12
      and (s.started_at at time zone tz)::date between c.start_date and c.end_date;
    -- No lift before the start (or none yet inside) means no gain to report.
    v := case when base_key is null or cur_key is null or base_key <= 0 then 0
              else greatest(0, (cur_key - base_key) * 100 / base_key) end;

  elsif c.type = 'check_ins' then
    select count(*) into v from public.check_ins ci
    where ci.user_id = p_user
      and (ci.submitted_at at time zone tz)::date between c.start_date and c.end_date;

  elsif c.type = 'nutrition_days' then
    select count(*) into v from (
      select f.date from public.food_logs f
      where f.user_id = p_user and f.date between c.start_date and c.end_date
      group by f.date having sum(f.kcal) > 0
    ) days;

  elsif c.type = 'habit_completions' then
    select count(*) into v from public.habit_logs h
    where h.user_id = p_user and h.date between c.start_date and c.end_date;
  end if;

  return coalesce(v, 0);
end;
$$;
revoke execute on function public.challenge_value(uuid, uuid) from public, anon, authenticated;

/**
 * Stamp the caller's milestones and completion in one challenge, once each,
 * and notify the highest step newly reached. Internal to challenge_cards().
 */
create or replace function public.challenge_sync(p_challenge uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  c public.challenges;
  part public.challenge_participants;
  v numeric;
  m smallint;
  got smallint;
  top smallint;
  stamped timestamptz;
begin
  select * into c from public.challenges where id = p_challenge;
  select * into part from public.challenge_participants
   where challenge_id = p_challenge and user_id = auth.uid();
  if c.id is null or part.id is null then return; end if;

  v := public.challenge_value(p_challenge, auth.uid());
  foreach m in array array[25, 50, 75, 100]::smallint[] loop
    -- v / target ≥ m / 100, without the division
    if v * 100 >= m * c.target_value then
      got := null;
      insert into public.challenge_milestones (participant_id, milestone)
      values (part.id, m)
      on conflict (participant_id, milestone) do nothing
      returning milestone into got;
      if got is not null and got < 100 then top := got; end if;
    end if;
  end loop;

  if v >= c.target_value then
    update public.challenge_participants
       set completed_at = now()
     where id = part.id and completed_at is null
    returning completed_at into stamped;
    if stamped is not null then top := 100; end if;
  end if;

  if top is not null then
    insert into public.notifications (user_id, category, title, body, payload)
    values (auth.uid(), 'challenge_milestone',
            case when top = 100 then 'Challenge completed' else 'Challenge milestone' end,
            top || '% · ' || c.title_en,
            jsonb_build_object('challenge_id', c.id, 'milestone', top,
                               'title_en', c.title_en, 'title_ro', c.title_ro));
  end if;
end;
$$;
revoke execute on function public.challenge_sync(uuid) from public, anon, authenticated;

-- ---------- 4. reads ----------
/**
 * Every challenge the caller can see (or one), with the participant count and
 * — for the ones they joined — their progress, completion and milestones,
 * synced on the way. One round trip for the whole list.
 */
create or replace function public.challenge_cards(p_challenge uuid default null)
returns table (
  id uuid, title_en text, title_ro text, description_en text, description_ro text,
  type text, target_value numeric, start_date date, end_date date, visibility text,
  difficulty text, exercise_id uuid, exercise_name_en text, exercise_name_ro text,
  is_platform boolean, is_mine boolean, participant_count int,
  joined boolean, value numeric, completed_at timestamptz, milestones smallint[], local_today date
) language plpgsql volatile security definer set search_path = public as $$
#variable_conflict use_column
declare
  r record;
  part public.challenge_participants;
begin
  if auth.uid() is null then return; end if;
  for r in
    select ch.* from public.challenges ch
    where (p_challenge is null or ch.id = p_challenge)
      and public.can_see_challenge(ch.id)
    order by ch.end_date desc, ch.id
  loop
    select * into part from public.challenge_participants cp
     where cp.challenge_id = r.id and cp.user_id = auth.uid();
    if part.id is not null then
      perform public.challenge_sync(r.id);
      select * into part from public.challenge_participants cp where cp.id = part.id;
    end if;

    id := r.id; title_en := r.title_en; title_ro := r.title_ro;
    description_en := r.description_en; description_ro := r.description_ro;
    type := r.type; target_value := r.target_value; start_date := r.start_date; end_date := r.end_date;
    visibility := r.visibility; difficulty := r.difficulty; exercise_id := r.exercise_id;
    select x.name_en, x.name_ro into exercise_name_en, exercise_name_ro
      from public.exercises x where x.id = r.exercise_id;
    if r.exercise_id is null then exercise_name_en := null; exercise_name_ro := null; end if;
    is_platform := r.creator_id is null;
    is_mine := r.creator_id = auth.uid();
    select count(*)::int into participant_count from public.challenge_participants cp where cp.challenge_id = r.id;
    joined := part.id is not null;
    value := case when part.id is not null then public.challenge_value(r.id, auth.uid()) end;
    completed_at := part.completed_at;
    select coalesce(array_agg(cm.milestone order by cm.milestone), '{}') into milestones
      from public.challenge_milestones cm where cm.participant_id = part.id;
    local_today := public.my_local_today();
    return next;
    part := null;
  end loop;
end;
$$;
grant execute on function public.challenge_cards(uuid) to authenticated;

/**
 * Rank, username, total and participant count — the top p_limit plus the
 * caller. Competition ranking (ties share a rank: 1, 1, 3), the same as
 * rankParticipants() in packages/shared. Never a full name, never a session.
 */
create or replace function public.challenge_leaderboard(p_challenge uuid, p_limit int default 10)
returns table (rank int, username text, value numeric, completed boolean, is_me boolean, participant_count int)
language sql stable security definer set search_path = public as $$
  with scored as (
    select p.user_id,
           coalesce(u.username, '—') as username,
           public.challenge_value(p_challenge, p.user_id) as value,
           p.completed_at is not null as completed
    from public.challenge_participants p
    join public.users u on u.id = p.user_id
    where p.challenge_id = p_challenge
      and public.can_see_challenge(p_challenge)
  ),
  ranked as (
    select s.*,
           rank() over (order by s.value desc)::int as rnk,
           row_number() over (order by s.value desc, s.username, s.user_id) as rn,
           count(*) over ()::int as total
    from scored s
  )
  select r.rnk, r.username, r.value, r.completed, r.user_id = auth.uid(), r.total
  from ranked r
  where r.rn <= greatest(1, least(coalesce(p_limit, 10), 100)) or r.user_id = auth.uid()
  order by r.rn;
$$;
grant execute on function public.challenge_leaderboard(uuid, int) to authenticated;

/** A coach's active clients in challenges: whose, how far, done or not. */
create or replace function public.coach_challenge_progress()
returns table (challenge_id uuid, client_id uuid, username text, value numeric, completed boolean)
language sql stable security definer set search_path = public as $$
  select p.challenge_id, p.user_id, coalesce(u.username, '—'),
         public.challenge_value(p.challenge_id, p.user_id), p.completed_at is not null
  from public.challenge_participants p
  join public.users u on u.id = p.user_id
  where public.is_active_coach_of(p.user_id)
    and public.can_see_challenge(p.challenge_id);
$$;
grant execute on function public.coach_challenge_progress() to authenticated;

-- The per-session rollups of every participant are no longer the app's to read.
revoke execute on function public.challenge_progress_rows(uuid) from public, anon, authenticated;
