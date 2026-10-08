-- Custom exercises stop being world-readable (launch audit 2026-10-08, §4).
--
-- `exercises_select using (true)` let every signed-in user list every other
-- user's custom exercises: their names, notes and videos turned up in any
-- coach's picker. The library itself (owner_id null) stays readable by all.
--
-- A custom exercise is still readable wherever something the reader can
-- already see points at it, so no existing screen loses a name:
--   * a program_exercises row  — a client's coach-built program, a copied or
--     shared (Discover) routine;
--   * a logged_sets row        — the coach reading an active client's log;
--   * a challenges row         — an exercise challenge the reader can see.
-- Each subquery runs under the referencing table's own policies, so this
-- follows those rules instead of restating them. None of those policies reads
-- `exercises`, so there is no recursion. Security-definer RPCs (feed, share
-- cards, public coach programs, admin) were never affected by this policy.

drop policy if exists exercises_select on public.exercises;
create policy exercises_select on public.exercises for select to authenticated
  using (
    owner_id is null
    or owner_id = auth.uid()
    or public.is_admin()
    or exists (select 1 from public.program_exercises pe where pe.exercise_id = exercises.id)
    or exists (select 1 from public.logged_sets ls where ls.exercise_id = exercises.id)
    or exists (select 1 from public.challenges c where c.exercise_id = exercises.id)
  );

-- The two reverse lookups above had no index leading on exercise_id.
create index if not exists program_exercises_exercise_idx on public.program_exercises (exercise_id);
create index if not exists logged_sets_exercise_idx on public.logged_sets (exercise_id);
