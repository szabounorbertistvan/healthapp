-- Workouts nobody tapped "Finish" on count, at the time of their last set.
--
-- Every statistic — the week score, the streak (workout_days / social_streak),
-- the per-day history, PRs pages, the fitness score, training load, badges,
-- challenges, leaderboards, the coach's dashboard — counts a logged_session
-- only once it carries completed_at. That filter is right (a session still
-- being logged is not a workout yet) but nothing ever closed a session the
-- person simply walked away from: logSet() keys the session on the program
-- day *and the date*, so tomorrow's sets open a new row and yesterday's stays
-- open for ever — invisible to all of the above, with its sets still on
-- record. One real account had three of them (8, 7 and 15 sets).
--
-- Rather than teach ~40 SQL functions and ~20 web reads a second notion of
-- "done" (and keep the app, the web and the SQL mirrors agreeing on it), the
-- engine closes such a session the way the person would have:
--
--   close_stale_sessions() stamps completed_at on every open session that
--     · has at least one logged set,
--     · whose last set arrived more than 4 hours ago, and
--     · whose day has ended on the person's own calendar (users.timezone,
--       Europe/Bucharest when unset or unknown — workout_days' default),
--   at its last set's time (client_ts when the set carries one, else the
--   server's received_at; never before started_at, never in the future), so
--   the session lands on the day it was trained and its duration is the time
--   actually spent logging.
--
-- Today's session is never touched, however long the break: the person can
-- still finish it themselves. Empty sessions (no sets) stay open — there is
-- nothing to count. Logging into a closed session still reopens it (logSet),
-- and the next pass closes it again.
--
-- The update fires the existing triggers, as a tap on Finish would:
-- audit_logged_sessions writes WORKOUT_COMPLETED and logged_sessions_award_badges
-- re-checks badges (both swallow their own failures where they should).
--
-- Engine-only: no EXECUTE for anyone but the owner. It runs once now (the
-- backfill) and hourly from pg_cron where the extension exists. The person can
-- also close one from the app's notice (finishOpenSession(), under RLS).

-- the cron pass reads open sessions only
create index if not exists logged_sessions_open_idx
  on public.logged_sessions (started_at) where completed_at is null;

create or replace function public.close_stale_sessions(p_idle interval default interval '4 hours')
returns int language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  with open_sessions as (
    select s.id, s.started_at,
           case when exists (select 1 from public.timezone_names z where z.name = u.timezone)
                then u.timezone else 'Europe/Bucharest' end as tz
    from public.logged_sessions s
    join public.users u on u.id = s.user_id
    where s.completed_at is null
  ),
  last_set as (
    select o.id, o.started_at, o.tz,
           max(ls.received_at) as last_received,
           max(coalesce(ls.client_ts, ls.received_at)) as last_at
    from open_sessions o
    join public.logged_sets ls on ls.session_id = o.id
    group by o.id, o.started_at, o.tz
  ),
  stale as (
    select id, greatest(started_at, least(now(), last_at)) as done_at
    from last_set
    where last_received < now() - p_idle
      and (started_at at time zone tz)::date < (now() at time zone tz)::date
  ),
  closed as (
    update public.logged_sessions s
    set completed_at = st.done_at
    from stale st
    where s.id = st.id and s.completed_at is null
    returning 1
  )
  select count(*)::int into n from closed;
  return n;
end;
$$;
revoke execute on function public.close_stale_sessions(interval) from public, anon, authenticated;

comment on function public.close_stale_sessions(interval) is
  'Engine: closes open sessions with sets from a day that has ended, at their last set''s time (20261211110000).';

-- the backfill: every session already left open
select public.close_stale_sessions();

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('close-stale-sessions', '17 * * * *',
      $cron$ select public.close_stale_sessions(); $cron$);
  end if;
end;
$$;
