-- Coach and client writes: only the columns and the relationship they are for (2026-11-21)
--
-- Found by the authorization audit of 2026-10-13, each reproduced against the
-- migrated schema before this file existed (pgTAP coach_write_scope):
--
--   1. coach_feedback. `feedback_client_read_mark` lets the client update their
--      feedback so they can mark it read, but the table grant (20260826075027)
--      was a plain `update`: the client could rewrite the coach's words, and
--      move the row to ANOTHER coach — who then read, under their own name,
--      feedback they never wrote. The client gets read_at and nothing else.
--
--   2. check_ins and set_videos. `checkins_coach_review` / `setvideos_coach_review`
--      exist so the coach can stamp a review (coach_reviewed_at, review_status),
--      but an update policy covers every column the role may update: the coach
--      could rewrite the client's weight, mood scores and note, or re-point a
--      set video. A trigger now lets anyone but the owner change the review
--      column only. The owner's own writes and service-role writes are untouched.
--
--   3. A coach's reach into a client's plan must end with the coaching. The
--      insert/update checks on programs and nutrition_plans already asked
--      is_active_coach_of(client_id); delete did not (a FOR ALL policy's USING
--      is all a delete checks), and the children — program_days,
--      program_exercises (through can_edit_program), planned_meals,
--      planned_meal_foods — only asked "did you write it". So a coach who ended
--      (or paused) the relationship could still delete the client's published
--      program or nutrition plan, or rewrite its days and meals. Reads of what
--      the coach authored are unchanged; a draft the client never saw may still
--      be deleted.
--
--   4. logged_sets. A set could be filed under another person's session.
--
--   5. nutrition_plans. Macro gram targets had no check: negatives were accepted.

-- ---------- 1. coach_feedback: the client marks it read, nothing else ----------
revoke update on table public.coach_feedback from authenticated;
grant update (read_at) on table public.coach_feedback to authenticated;

-- ---------- 2. a reviewer changes the review column only ----------
create or replace function public.review_only_by_non_owner()
returns trigger language plpgsql set search_path = public as $$
declare
  v_col text := tg_argv[0];
begin
  -- auth.uid() is null for the service role and for migrations: not a reviewer.
  if auth.uid() is not null and auth.uid() is distinct from old.user_id
     and (to_jsonb(new) - v_col) is distinct from (to_jsonb(old) - v_col) then
    raise exception 'REVIEW_ONLY' using errcode = '42501',
      detail = format('only %s may be changed on %s by someone other than its owner', v_col, tg_table_name);
  end if;
  return new;
end;
$$;
revoke execute on function public.review_only_by_non_owner() from public, anon, authenticated;

drop trigger if exists check_ins_review_only on public.check_ins;
create trigger check_ins_review_only before update on public.check_ins
  for each row execute function public.review_only_by_non_owner('coach_reviewed_at');

drop trigger if exists set_videos_review_only on public.set_videos;
create trigger set_videos_review_only before update on public.set_videos
  for each row execute function public.review_only_by_non_owner('review_status');

-- ---------- 3. a coach writes a client's plan only while coaching them ----------
create or replace function public.can_edit_program(p_program uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.programs p
    where p.id = p_program
      and (
        (p.coach_id = auth.uid() and public.is_active_coach_of(p.client_id))
        or (p.coach_id is null and p.client_id = auth.uid() and not public.has_active_coach())
      )
  );
$$;

drop policy if exists programs_coach_all on public.programs;
create policy programs_coach_read on public.programs for select to authenticated
  using (coach_id = auth.uid());
create policy programs_coach_insert on public.programs for insert to authenticated
  with check (coach_id = auth.uid() and public.is_active_coach_of(client_id));
create policy programs_coach_update on public.programs for update to authenticated
  using (coach_id = auth.uid() and public.is_active_coach_of(client_id))
  with check (coach_id = auth.uid() and public.is_active_coach_of(client_id));
create policy programs_coach_delete on public.programs for delete to authenticated
  using (coach_id = auth.uid() and (public.is_active_coach_of(client_id) or status = 'draft'));

drop policy if exists nplans_coach_all on public.nutrition_plans;
create policy nplans_coach_read on public.nutrition_plans for select to authenticated
  using (coach_id = auth.uid());
create policy nplans_coach_insert on public.nutrition_plans for insert to authenticated
  with check (coach_id = auth.uid() and public.is_active_coach_of(client_id));
create policy nplans_coach_update on public.nutrition_plans for update to authenticated
  using (coach_id = auth.uid() and public.is_active_coach_of(client_id))
  with check (coach_id = auth.uid() and public.is_active_coach_of(client_id));
create policy nplans_coach_delete on public.nutrition_plans for delete to authenticated
  using (coach_id = auth.uid() and (public.is_active_coach_of(client_id) or status = 'draft'));

-- The plan's author (or its solo owner) reads its meals as before; writing
-- them needs what writing the plan needs.
create or replace function public.can_edit_nutrition_plan(p_plan uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.nutrition_plans n
    where n.id = p_plan
      and ((n.coach_id = auth.uid() and public.is_active_coach_of(n.client_id))
           or (n.coach_id is null and n.client_id = auth.uid()))
  );
$$;
revoke execute on function public.can_edit_nutrition_plan(uuid) from public, anon;
grant execute on function public.can_edit_nutrition_plan(uuid) to authenticated;

drop policy if exists pmeals_rw on public.planned_meals;
create policy pmeals_author_read on public.planned_meals for select to authenticated
  using (exists (select 1 from public.nutrition_plans n where n.id = plan_id
           and (n.coach_id = auth.uid() or (n.coach_id is null and n.client_id = auth.uid()))));
create policy pmeals_insert on public.planned_meals for insert to authenticated
  with check (public.can_edit_nutrition_plan(plan_id));
create policy pmeals_update on public.planned_meals for update to authenticated
  using (public.can_edit_nutrition_plan(plan_id)) with check (public.can_edit_nutrition_plan(plan_id));
create policy pmeals_delete on public.planned_meals for delete to authenticated
  using (public.can_edit_nutrition_plan(plan_id));

drop policy if exists pmfoods_rw on public.planned_meal_foods;
create policy pmfoods_author_read on public.planned_meal_foods for select to authenticated
  using (exists (select 1 from public.planned_meals m join public.nutrition_plans n on n.id = m.plan_id
           where m.id = planned_meal_id
             and (n.coach_id = auth.uid() or (n.coach_id is null and n.client_id = auth.uid()))));
create policy pmfoods_insert on public.planned_meal_foods for insert to authenticated
  with check (exists (select 1 from public.planned_meals m where m.id = planned_meal_id
                and public.can_edit_nutrition_plan(m.plan_id)));
create policy pmfoods_update on public.planned_meal_foods for update to authenticated
  using (exists (select 1 from public.planned_meals m where m.id = planned_meal_id
           and public.can_edit_nutrition_plan(m.plan_id)))
  with check (exists (select 1 from public.planned_meals m where m.id = planned_meal_id
                and public.can_edit_nutrition_plan(m.plan_id)));
create policy pmfoods_delete on public.planned_meal_foods for delete to authenticated
  using (exists (select 1 from public.planned_meals m where m.id = planned_meal_id
           and public.can_edit_nutrition_plan(m.plan_id)));

-- ---------- 4. a set belongs to a session of the same person ----------
-- sets_owner checked only logged_sets.user_id, so anyone could file a set of
-- theirs under SOMEONE ELSE's session id (they are visible in shared workout
-- posts). social_posts_guard totals a shared workout from every set in the
-- session, so the victim's post showed the stranger's volume and PRs.
drop policy if exists sets_owner on public.logged_sets;
create policy sets_owner on public.logged_sets for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid()
    and exists (select 1 from public.logged_sessions s where s.id = session_id and s.user_id = auth.uid()));

-- ---------- 5. macro targets are never negative ----------
-- kcal_target had its range check from the start; the three gram targets had
-- none, and createNutritionPlan checked only kcal, so a negative or absurd
-- target could be saved. Mirrors isValidDailyTargets (packages/shared/src/macros.ts).
-- NOT VALID: new and updated rows are checked; rows already stored are not
-- rescanned, so this cannot fail on production data written before it.
alter table public.nutrition_plans
  add constraint nutrition_plans_macro_targets_check
  check (protein_target_g between 0 and 1000 and carbs_target_g between 0 and 1000 and fat_target_g between 0 and 1000)
  not valid;
