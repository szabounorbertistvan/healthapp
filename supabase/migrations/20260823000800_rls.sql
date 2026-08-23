-- BuddyGym schema · 08 Row Level Security
-- Direct translation of the permission matrix (PRODUCT_SPEC.md §4).
-- Principles: client sees only own data; coach sees only active clients via
-- is_active_coach_of(); ended coach loses access to new data automatically
-- (the relationship is no longer active); engine tables (snapshots, streaks,
-- badges awards, notifications) are written by service role only — no insert
-- policy means no client write.

alter table public.users              enable row level security;
alter table public.trainer_clients    enable row level security;
alter table public.goals              enable row level security;
alter table public.exercises          enable row level security;
alter table public.programs           enable row level security;
alter table public.program_days       enable row level security;
alter table public.program_exercises  enable row level security;
alter table public.logged_sessions    enable row level security;
alter table public.logged_sets        enable row level security;
alter table public.exercise_videos    enable row level security;
alter table public.set_videos         enable row level security;
alter table public.workout_events     enable row level security;
alter table public.foods              enable row level security;
alter table public.nutrition_plans    enable row level security;
alter table public.planned_meals      enable row level security;
alter table public.planned_meal_foods enable row level security;
alter table public.food_logs          enable row level security;
alter table public.measurements       enable row level security;
alter table public.check_ins          enable row level security;
alter table public.progress_photos    enable row level security;
alter table public.adherence_snapshots enable row level security;
alter table public.conversations      enable row level security;
alter table public.messages           enable row level security;
alter table public.coach_feedback     enable row level security;
alter table public.habits             enable row level security;
alter table public.habit_logs         enable row level security;
alter table public.streaks            enable row level security;
alter table public.badges             enable row level security;
alter table public.user_badges        enable row level security;
alter table public.notifications      enable row level security;

-- ---------- users ----------
create policy users_select on public.users for select to authenticated
  using (id = auth.uid() or public.is_connected_to(id));
create policy users_update on public.users for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- ---------- trainer_clients ----------
create policy tc_select on public.trainer_clients for select to authenticated
  using (coach_id = auth.uid() or client_id = auth.uid());
create policy tc_insert on public.trainer_clients for insert to authenticated
  with check (coach_id = auth.uid() and status = 'invited');
-- coach may end/cancel own relationships; accept happens via accept_invite() RPC
create policy tc_update_coach on public.trainer_clients for update to authenticated
  using (coach_id = auth.uid()) with check (coach_id = auth.uid());
create policy tc_update_client_end on public.trainer_clients for update to authenticated
  using (client_id = auth.uid()) with check (client_id = auth.uid() and status = 'ended');

-- ---------- goals ----------
create policy goals_owner on public.goals for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy goals_coach_read on public.goals for select to authenticated
  using (public.is_active_coach_of(user_id));

-- ---------- exercises (library readable by everyone; customs writable by owner) ----------
create policy exercises_select on public.exercises for select to authenticated
  using (true);
create policy exercises_owner_write on public.exercises for insert to authenticated
  with check (owner_id = auth.uid() and source = 'custom');
create policy exercises_owner_update on public.exercises for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy exercises_owner_delete on public.exercises for delete to authenticated
  using (owner_id = auth.uid());

-- ---------- programs ----------
create policy programs_coach_all on public.programs for all to authenticated
  using (coach_id = auth.uid()) with check (coach_id = auth.uid() and public.is_active_coach_of(client_id));
create policy programs_solo_all on public.programs for all to authenticated
  using (coach_id is null and client_id = auth.uid())
  with check (coach_id is null and client_id = auth.uid());
-- clients see only PUBLISHED coach programs (drafts invisible, spec B1)
create policy programs_client_read on public.programs for select to authenticated
  using (client_id = auth.uid() and status = 'published');

create policy program_days_rw on public.program_days for all to authenticated
  using (exists (select 1 from public.programs p where p.id = program_id
           and (p.coach_id = auth.uid() or (p.coach_id is null and p.client_id = auth.uid()))))
  with check (exists (select 1 from public.programs p where p.id = program_id
           and (p.coach_id = auth.uid() or (p.coach_id is null and p.client_id = auth.uid()))));
create policy program_days_client_read on public.program_days for select to authenticated
  using (exists (select 1 from public.programs p where p.id = program_id
           and p.client_id = auth.uid() and p.status = 'published'));

create policy program_exercises_rw on public.program_exercises for all to authenticated
  using (exists (select 1 from public.program_days d join public.programs p on p.id = d.program_id
           where d.id = program_day_id
           and (p.coach_id = auth.uid() or (p.coach_id is null and p.client_id = auth.uid()))))
  with check (exists (select 1 from public.program_days d join public.programs p on p.id = d.program_id
           where d.id = program_day_id
           and (p.coach_id = auth.uid() or (p.coach_id is null and p.client_id = auth.uid()))));
create policy program_exercises_client_read on public.program_exercises for select to authenticated
  using (exists (select 1 from public.program_days d join public.programs p on p.id = d.program_id
           where d.id = program_day_id and p.client_id = auth.uid() and p.status = 'published'));

-- ---------- logged workouts ----------
create policy sessions_owner on public.logged_sessions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy sessions_coach_read on public.logged_sessions for select to authenticated
  using (public.is_active_coach_of(user_id));

create policy sets_owner on public.logged_sets for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy sets_coach_read on public.logged_sets for select to authenticated
  using (public.is_active_coach_of(user_id));

create policy exvideos_select on public.exercise_videos for select to authenticated using (true);
create policy exvideos_owner on public.exercise_videos for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy setvideos_owner on public.set_videos for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy setvideos_coach on public.set_videos for select to authenticated
  using (public.is_active_coach_of(user_id));
create policy setvideos_coach_review on public.set_videos for update to authenticated
  using (public.is_active_coach_of(user_id)) with check (public.is_active_coach_of(user_id));

create policy events_owner_insert on public.workout_events for insert to authenticated
  with check (user_id = auth.uid());
create policy events_owner_read on public.workout_events for select to authenticated
  using (user_id = auth.uid());

-- ---------- foods (shared cache readable by all; customs owned) ----------
create policy foods_select on public.foods for select to authenticated using (true);
create policy foods_custom_insert on public.foods for insert to authenticated
  with check (source = 'custom' and owner_id = auth.uid());
create policy foods_custom_update on public.foods for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy foods_custom_delete on public.foods for delete to authenticated
  using (owner_id = auth.uid());

-- ---------- nutrition plans ----------
create policy nplans_coach_all on public.nutrition_plans for all to authenticated
  using (coach_id = auth.uid()) with check (coach_id = auth.uid() and public.is_active_coach_of(client_id));
create policy nplans_solo_all on public.nutrition_plans for all to authenticated
  using (coach_id is null and client_id = auth.uid())
  with check (coach_id is null and client_id = auth.uid());
create policy nplans_client_read on public.nutrition_plans for select to authenticated
  using (client_id = auth.uid() and status = 'published');

create policy pmeals_rw on public.planned_meals for all to authenticated
  using (exists (select 1 from public.nutrition_plans n where n.id = plan_id
           and (n.coach_id = auth.uid() or (n.coach_id is null and n.client_id = auth.uid()))))
  with check (exists (select 1 from public.nutrition_plans n where n.id = plan_id
           and (n.coach_id = auth.uid() or (n.coach_id is null and n.client_id = auth.uid()))));
create policy pmeals_client_read on public.planned_meals for select to authenticated
  using (exists (select 1 from public.nutrition_plans n where n.id = plan_id
           and n.client_id = auth.uid() and n.status = 'published'));

create policy pmfoods_rw on public.planned_meal_foods for all to authenticated
  using (exists (select 1 from public.planned_meals m join public.nutrition_plans n on n.id = m.plan_id
           where m.id = planned_meal_id
           and (n.coach_id = auth.uid() or (n.coach_id is null and n.client_id = auth.uid()))))
  with check (exists (select 1 from public.planned_meals m join public.nutrition_plans n on n.id = m.plan_id
           where m.id = planned_meal_id
           and (n.coach_id = auth.uid() or (n.coach_id is null and n.client_id = auth.uid()))));
create policy pmfoods_client_read on public.planned_meal_foods for select to authenticated
  using (exists (select 1 from public.planned_meals m join public.nutrition_plans n on n.id = m.plan_id
           where m.id = planned_meal_id and n.client_id = auth.uid() and n.status = 'published'));

create policy food_logs_owner on public.food_logs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy food_logs_coach_read on public.food_logs for select to authenticated
  using (public.is_active_coach_of(user_id));

-- ---------- progress ----------
create policy measurements_owner on public.measurements for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy measurements_coach_read on public.measurements for select to authenticated
  using (public.is_active_coach_of(user_id));

create policy checkins_owner on public.check_ins for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy checkins_coach_read on public.check_ins for select to authenticated
  using (public.is_active_coach_of(user_id));
create policy checkins_coach_review on public.check_ins for update to authenticated
  using (public.is_active_coach_of(user_id)) with check (public.is_active_coach_of(user_id));

create policy photos_owner on public.progress_photos for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy photos_coach_read on public.progress_photos for select to authenticated
  using (public.is_active_coach_of(user_id));

-- computed by service role only; read-only for owner + coach
create policy adherence_read on public.adherence_snapshots for select to authenticated
  using (user_id = auth.uid() or public.is_active_coach_of(user_id));

-- ---------- coaching ----------
create policy conv_select on public.conversations for select to authenticated
  using (coach_id = auth.uid() or client_id = auth.uid());
create policy conv_insert on public.conversations for insert to authenticated
  with check (coach_id = auth.uid() and public.is_active_coach_of(client_id));

create policy msg_select on public.messages for select to authenticated
  using (exists (select 1 from public.conversations c where c.id = conversation_id
           and (c.coach_id = auth.uid() or c.client_id = auth.uid())));
create policy msg_insert on public.messages for insert to authenticated
  with check (sender_id = auth.uid()
    and exists (select 1 from public.conversations c where c.id = conversation_id
           and (c.coach_id = auth.uid() or c.client_id = auth.uid())));
create policy msg_mark_read on public.messages for update to authenticated
  using (exists (select 1 from public.conversations c where c.id = conversation_id
           and (c.coach_id = auth.uid() or c.client_id = auth.uid())))
  with check (exists (select 1 from public.conversations c where c.id = conversation_id
           and (c.coach_id = auth.uid() or c.client_id = auth.uid())));

create policy feedback_coach_insert on public.coach_feedback for insert to authenticated
  with check (coach_id = auth.uid() and public.is_active_coach_of(client_id));
create policy feedback_select on public.coach_feedback for select to authenticated
  using (coach_id = auth.uid() or client_id = auth.uid());
create policy feedback_client_read_mark on public.coach_feedback for update to authenticated
  using (client_id = auth.uid()) with check (client_id = auth.uid());

-- ---------- engagement ----------
create policy habits_owner on public.habits for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and created_by = auth.uid());
create policy habits_coach on public.habits for all to authenticated
  using (created_by = auth.uid() and public.is_active_coach_of(user_id))
  with check (created_by = auth.uid() and public.is_active_coach_of(user_id));
create policy habits_coach_read on public.habits for select to authenticated
  using (public.is_active_coach_of(user_id));

create policy habit_logs_owner on public.habit_logs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy habit_logs_coach_read on public.habit_logs for select to authenticated
  using (public.is_active_coach_of(user_id));

create policy streaks_read on public.streaks for select to authenticated
  using (user_id = auth.uid() or public.is_active_coach_of(user_id));

create policy badges_read on public.badges for select to authenticated using (true);
create policy user_badges_read on public.user_badges for select to authenticated
  using (user_id = auth.uid() or public.is_active_coach_of(user_id));

create policy notifications_read on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy notifications_mark_read on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
