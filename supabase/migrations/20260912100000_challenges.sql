-- HealthApp schema · challenges
--
-- A challenge is a target over a date window — N workouts, N training-load
-- points, N kg of volume, N active days. Nothing about progress is stored:
-- it is a fold over logged_sessions / logged_sets / food_logs / habit_logs
-- inside the window, done in @healthapp/shared (challengeProgress). The only
-- state a participant carries is when they joined and, once the target is
-- met, when — `completed_at` is stamped by the app the first time it sees the
-- target reached, so a later deletion of a session cannot un-complete a
-- challenge. That column is also the hook a future feed / badge engine reads
-- ("user completed challenge"); neither exists yet, so nothing else is built.
--
-- Leaderboards need every participant's progress, and RLS (rightly) lets a
-- user read only their own sets. challenge_progress_rows() is security
-- definer for that one purpose: it returns PER-SESSION ROLLUPS (set count,
-- volume, duration, mean RPE, exercise count) and active days for the
-- participants of a challenge the caller may see — never a set, a weight or
-- an exercise name. The load score itself is computed in TypeScript from
-- those rollups (trainingLoadFromStats) so the formula lives in one place.

create table public.challenges (
  id uuid primary key default gen_random_uuid(),
  title_en text not null,
  title_ro text not null,
  description_en text,
  description_ro text,
  type text not null check (type in ('workouts', 'training_load', 'volume', 'active_days')),
  target_value numeric(12,2) not null check (target_value > 0),
  start_date date not null,
  end_date date not null check (end_date >= start_date),
  -- null = platform (seed) challenge; a user-created one belongs to its creator
  creator_id uuid references public.users (id) on delete set null,
  visibility text not null default 'public' check (visibility in ('public', 'private')),
  created_at timestamptz not null default now()
);
create index challenges_window_idx on public.challenges (end_date desc, start_date);

create table public.challenge_participants (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  -- stamped by the app the first time progress >= target; never cleared
  completed_at timestamptz,
  unique (challenge_id, user_id)
);
create index challenge_participants_user_idx on public.challenge_participants (user_id);
create index challenge_participants_challenge_idx on public.challenge_participants (challenge_id);

comment on column public.challenge_participants.completed_at is
  'When the participant first reached the target. Persisted so a deleted session cannot revoke a finished challenge; the future social feed / badge engine reads this as the "completed challenge" event.';

-- ---------- visibility helper ----------
-- Who may see a challenge: everyone for public ones; the creator, a
-- participant, or the active coach of a participant for private ones.
create or replace function public.can_see_challenge(p_challenge uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.challenges c
    where c.id = p_challenge
      and (
        c.visibility = 'public'
        or c.creator_id = auth.uid()
        or exists (
          select 1 from public.challenge_participants p
          where p.challenge_id = c.id
            and (p.user_id = auth.uid() or public.is_active_coach_of(p.user_id))
        )
      )
  );
$$;

-- ---------- RLS ----------
alter table public.challenges enable row level security;
alter table public.challenge_participants enable row level security;

create policy challenges_select on public.challenges for select to authenticated
  using (public.can_see_challenge(id));
create policy challenges_owner_insert on public.challenges for insert to authenticated
  with check (creator_id = auth.uid());
create policy challenges_owner_update on public.challenges for update to authenticated
  using (creator_id = auth.uid()) with check (creator_id = auth.uid());
create policy challenges_owner_delete on public.challenges for delete to authenticated
  using (creator_id = auth.uid());

-- A participant row is visible to its owner, their active coach, and — for
-- the leaderboard — everyone who can see the challenge itself.
create policy participants_select on public.challenge_participants for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_active_coach_of(user_id)
    or public.can_see_challenge(challenge_id)
  );
-- Joining: only yourself, only a challenge you can see, only before it ends.
create policy participants_join on public.challenge_participants for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.can_see_challenge(challenge_id)
    and exists (select 1 from public.challenges c where c.id = challenge_id and c.end_date >= current_date)
  );
-- completed_at is the only thing the app writes back; the join itself is immutable.
create policy participants_own_update on public.challenge_participants for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy participants_leave on public.challenge_participants for delete to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on table public.challenges to authenticated;
grant select, insert, update, delete on table public.challenge_participants to authenticated;
grant execute on function public.can_see_challenge(uuid) to authenticated;

-- ---------- progress rows for a challenge ----------
-- kind = 'session': one row per completed session in the window with its
-- rollup; kind = 'day': one row per active day (food or habit log) so the
-- active_days type can be counted without reading those tables directly.
create or replace function public.challenge_progress_rows(p_challenge uuid)
returns table (
  user_id uuid,
  full_name text,
  username text,
  kind text,
  day date,
  sets int,
  volume_kg numeric,
  duration_min int,
  mean_rpe numeric,
  exercises int
) language sql stable security definer set search_path = public as $$
  with c as (
    select id, start_date, end_date from public.challenges where id = p_challenge
  ),
  members as (
    select p.user_id, u.full_name, u.username, u.timezone
    from public.challenge_participants p
    join public.users u on u.id = p.user_id
    where p.challenge_id = p_challenge
      and public.can_see_challenge(p_challenge)
  ),
  sessions as (
    select
      s.user_id,
      s.id as session_id,
      (s.started_at at time zone m.timezone)::date as day,
      s.started_at,
      s.completed_at
    from public.logged_sessions s
    join members m on m.user_id = s.user_id
    cross join c
    where s.completed_at is not null
      and (s.started_at at time zone m.timezone)::date between c.start_date and c.end_date
  )
  select
    m.user_id, m.full_name, m.username,
    'session' as kind,
    ss.day,
    count(ls.id) filter (where ls.reps > 0)::int as sets,
    coalesce(sum(greatest(ls.weight_kg, 0) * ls.reps) filter (where ls.reps > 0), 0) as volume_kg,
    nullif(round(extract(epoch from (ss.completed_at - ss.started_at)) / 60)::int, 0) as duration_min,
    avg(least(10, greatest(1, coalesce(ls.rpe, 10 - ls.rir)))) filter (where ls.reps > 0) as mean_rpe,
    count(distinct ls.exercise_id) filter (where ls.reps > 0)::int as exercises
  from sessions ss
  join members m on m.user_id = ss.user_id
  left join public.logged_sets ls on ls.session_id = ss.session_id
  group by m.user_id, m.full_name, m.username, ss.session_id, ss.day, ss.started_at, ss.completed_at

  union all

  select m.user_id, m.full_name, m.username, 'day', d.day, null, null, null, null, null
  from members m
  cross join c
  join lateral (
    select f.date as day from public.food_logs f
    where f.user_id = m.user_id and f.date between c.start_date and c.end_date
    union
    select h.date from public.habit_logs h
    where h.user_id = m.user_id and h.date between c.start_date and c.end_date
  ) d on true;
$$;
grant execute on function public.challenge_progress_rows(uuid) to authenticated;

-- ---------- platform challenges ----------
-- Four public challenges for the current month, one per type. creator_id null
-- marks them as platform-owned: nobody can edit or delete them through RLS.
insert into public.challenges
  (title_en, title_ro, description_en, description_ro, type, target_value, start_date, end_date, visibility)
values
  ('10 Workouts', '10 antrenamente',
   'Complete ten training sessions this month.',
   'Finalizează zece sesiuni de antrenament luna aceasta.',
   'workouts', 10, date_trunc('month', current_date)::date,
   (date_trunc('month', current_date) + interval '1 month - 1 day')::date, 'public'),
  ('500 Training Load', '500 puncte încărcare',
   'Accumulate 500 training-load points across your sessions.',
   'Acumulează 500 de puncte de încărcare din sesiunile tale.',
   'training_load', 500, date_trunc('month', current_date)::date,
   (date_trunc('month', current_date) + interval '1 month - 1 day')::date, 'public'),
  ('100,000 kg Volume', '100.000 kg volum',
   'Lift a combined 100,000 kg this month.',
   'Ridică în total 100.000 kg luna aceasta.',
   'volume', 100000, date_trunc('month', current_date)::date,
   (date_trunc('month', current_date) + interval '1 month - 1 day')::date, 'public'),
  ('20 Active Days', '20 de zile active',
   'Log something — a set, a meal or a habit — on twenty different days.',
   'Înregistrează ceva — un set, o masă sau un obicei — în douăzeci de zile diferite.',
   'active_days', 20, date_trunc('month', current_date)::date,
   (date_trunc('month', current_date) + interval '1 month - 1 day')::date, 'public');
