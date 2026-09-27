-- Social 2.0 · Safety on the boards: block in leaderboards and challenges
--
-- Block (20261007100000) already hides two people from each other on every
-- social surface. Three kept showing one to the other:
--
--   social_leaderboard        the global / following boards (/leaderboards)
--   challenge_leaderboard     the ranking on a challenge's page
--   coach_challenge_progress  a coach's clients in challenges
--
-- Everything else that could expose someone's progress is already closed:
-- challenge_participants is readable only by its owner and their coach
-- (20261001100000), and challenge_value / challenge_sync /
-- challenge_progress_rows are not callable by anyone signed in.
-- challenge_cards shows only the caller's own progress and a participant
-- count.
--
-- The rule is a view rule, never a scoring rule: every board is computed over
-- exactly the people it was computed over before — the blocked person
-- included — and only then is the blocked person's row left out of what the
-- caller receives. Scores, rank numbers, the order of everyone still shown,
-- totals and participant counts are identical to what they were; nothing is
-- recalculated over "the visible people", and nothing historical changes.
-- (A rank sequence may therefore skip a number where a hidden row sat — it
-- says someone is there, never who.)
--
-- Also closed here: none of the three revoked EXECUTE from anon, and
-- challenge_leaderboard never asked for a session — a public challenge's
-- usernames and totals were readable without signing in. It now requires one,
-- and anon loses EXECUTE on all three.
--
-- Each body below is the latest definition with that one step added.
-- Depends on 20261007100000 (social_blocked_between).

-- ---------- the global / following boards (20260930140000) ----------
create or replace function public.social_leaderboard(
  p_metric text,
  p_period text,
  p_scope text default 'global',
  p_limit int default 10
)
returns table (
  rank int,
  user_id uuid,
  display_name text,
  username text,
  avatar_url text,
  score numeric,
  secondary_score numeric,
  is_current_user boolean
) language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  -- Fixed vocabularies: nothing from the caller reaches the SQL as text.
  if p_metric not in ('training_load', 'volume', 'workouts', 'active_days', 'streak') then
    raise exception 'unknown leaderboard metric' using errcode = '22023';
  end if;
  if p_period not in ('week', 'month', 'all') then
    raise exception 'unknown leaderboard period' using errcode = '22023';
  end if;
  if p_scope not in ('global', 'following') then
    raise exception 'unknown leaderboard scope' using errcode = '22023';
  end if;
  if auth.uid() is null then
    return;
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
    -- 'following' narrows the same visible set to the people the caller
    -- follows, plus themselves. It never widens it: someone who is private
    -- stays off the board even if you follow them.
    and (
      p_scope = 'global'
      or u.id = auth.uid()
      or public.is_following(u.id)
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

-- ---------- a challenge's ranking (20261001100000) ----------
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
      and auth.uid() is not null
      and public.can_see_challenge(p_challenge)
  ),
  ranked as (
    select s.*,
           rank() over (order by s.value desc)::int as rnk,
           row_number() over (order by s.value desc, s.username, s.user_id) as rn,
           count(*) over ()::int as total
    from scored s
  ),
  -- The same rule as social_leaderboard: ranks and the participant count are
  -- computed over everyone who joined; a blocked person's row is only left
  -- out of what this caller receives.
  visible as (
    select r.*, row_number() over (order by r.rn) as shown
    from ranked r
    where r.user_id = auth.uid() or not public.social_blocked_between(auth.uid(), r.user_id)
  )
  select v.rnk, v.username, v.value, v.completed, v.user_id = auth.uid(), v.total
  from visible v
  where v.shown <= greatest(1, least(coalesce(p_limit, 10), 100)) or v.user_id = auth.uid()
  order by v.rn;
$$;
revoke execute on function public.challenge_leaderboard(uuid, int) from public, anon;
grant execute on function public.challenge_leaderboard(uuid, int) to authenticated;

-- ---------- a coach's clients in challenges (20261001100000) ----------
create or replace function public.coach_challenge_progress()
returns table (challenge_id uuid, client_id uuid, username text, value numeric, completed boolean)
language sql stable security definer set search_path = public as $$
  select p.challenge_id, p.user_id, coalesce(u.username, '—'),
         public.challenge_value(p.challenge_id, p.user_id), p.completed_at is not null
  from public.challenge_participants p
  join public.users u on u.id = p.user_id
  where public.is_active_coach_of(p.user_id)
    and public.can_see_challenge(p.challenge_id)
    and not public.social_blocked_between(auth.uid(), p.user_id);
$$;
revoke execute on function public.coach_challenge_progress() from public, anon;
grant execute on function public.coach_challenge_progress() to authenticated;
