-- HealthApp schema · the set behind each lift's best estimated 1RM
--
-- The Progress page's personal-records list used to take the best of the sets
-- flagged is_pr. Those flags are the PR judge's verdict at log time, under its
-- own unbounded rule (packages/shared/prs isPersonalRecord), against whatever
-- sets existed then — abandoned sessions included. So the list could show a
-- smaller number than the exercise page for the same lift (82.2 vs 84.6 kg on
-- a real account: the flag sat on 72.5×4 while 72.5×5 was unflagged).
--
-- The exercise page's rule is relevantOneRm() in
-- packages/shared/src/exercise-analytics.ts:
--   completed sessions only · weight > 0 · 1..12 whole reps ·
--   one rep at face value, otherwise Epley  w · (1 + reps/30)
-- This function applies that rule to pick ONE set per exercise and returns the
-- set, not a number: the app computes the value with relevantOneRm(), so the
-- formula still lives in one place. The ranking key is relevantOneRm × 30,
-- which is exact numeric (no division):
--   reps = 1  →  30 · w
--   reps > 1  →  w · (30 + reps)
-- Ties go to the earliest session, then the set id, so the answer is stable.
--
-- is_pr is NOT touched. Changing the judge would silently rewrite flags that
-- are already stored (and the celebration the logger showed at the time).
--
-- Why SQL at all: a lifetime of sets is more than PostgREST's 1000-row cap,
-- and a truncated read would quietly drop a lift's best.
--
-- Privacy: security invoker, and it answers for auth.uid() only — there is no
-- user argument, so a coach (who may read a client's sets through
-- sets_coach_read) still gets only their own. RLS on logged_sets,
-- logged_sessions and exercises applies inside.

create or replace function public.exercise_best_sets()
returns table (
  exercise_id uuid,
  weight_kg numeric,
  reps int,
  completed_at timestamptz,
  name_en text,
  name_ro text
)
language sql stable security invoker set search_path = public as $$
  select distinct on (ls.exercise_id)
    ls.exercise_id,
    ls.weight_kg,
    ls.reps,
    s.completed_at,
    e.name_en,
    e.name_ro
  from public.logged_sets ls
  join public.logged_sessions s on s.id = ls.session_id
  -- left: a lift whose library row this person cannot read still has a best.
  left join public.exercises e on e.id = ls.exercise_id
  where ls.user_id = auth.uid()
    and s.completed_at is not null
    and ls.weight_kg > 0
    and ls.reps between 1 and 12
  order by
    ls.exercise_id,
    case when ls.reps = 1 then ls.weight_kg * 30 else ls.weight_kg * (30 + ls.reps) end desc,
    s.completed_at asc,
    ls.id asc;
$$;

comment on function public.exercise_best_sets() is
  'Per exercise, the caller''s completed set with the highest relevantOneRm (packages/shared/exercise-analytics). Returns the set; the app computes the value.';

revoke execute on function public.exercise_best_sets() from public, anon;
grant execute on function public.exercise_best_sets() to authenticated;
