-- Test data · seven more days on the E2E test program, one per exercise type,
-- so every brand athlete photo (lib/exercise-types.ts) has a day to appear on.
--
-- Run in the dashboard SQL editor (service role / postgres — program_days and
-- program_exercises are coach-owned rows, RLS keeps the anon key out).
-- Idempotent: a day is only added when the program has no day of that name.
-- Exercises are looked up by name_en in the system library (Free Exercise DB
-- import, owner_id null); a missing name is skipped, not an error.
do $$
declare
  v_program uuid;
  v_next int;
  v_day uuid;
  v_ex uuid;
  d record;
  e record;
  v_pos int;
begin
  select id into v_program
  from public.programs
  where name ilike 'E2E TEST%'
  order by created_at
  limit 1;
  if v_program is null then
    raise exception 'No program named "E2E TEST…" found';
  end if;

  for d in
    select * from (values
      (1, 'Piept',    array['chest'],                 array['Barbell Bench Press - Medium Grip', 'Incline Dumbbell Press', 'Triceps Pushdown']),
      (2, 'Spate',    array['lats', 'middle back'],   array['Pullups', 'Bent Over Barbell Row', 'Seated Cable Rows']),
      (3, 'Umeri',    array['shoulders'],             array['Dumbbell Shoulder Press', 'Side Lateral Raise']),
      (4, 'Brațe',    array['biceps', 'triceps'],     array['Barbell Curl', 'Hammer Curls', 'Triceps Pushdown']),
      (5, 'Picioare', array['quadriceps', 'hamstrings'], array['Barbell Squat', 'Romanian Deadlift', 'Leg Press']),
      (6, 'Fesieri',  array['glutes'],                array['Barbell Hip Thrust', 'Barbell Glute Bridge', 'Glute Kickback']),
      (7, 'Cardio',   array[]::text[],                array['Rope Jumping', 'Mountain Climbers', 'Rowing, Stationary'])
    ) as t(ord, name, muscles, exercises)
    order by ord
  loop
    continue when exists (select 1 from public.program_days where program_id = v_program and name = d.name);

    select coalesce(max(day_index), -1) + 1 into v_next
    from public.program_days where program_id = v_program and week_index = 1;

    insert into public.program_days (program_id, week_index, day_index, name, muscle_groups)
    values (v_program, 1, v_next, d.name, d.muscles)
    returning id into v_day;

    v_pos := 0;
    for e in select unnest(d.exercises) as name_en loop
      select id into v_ex from public.exercises
      where owner_id is null and name_en = e.name_en
      limit 1;
      if v_ex is null then
        raise notice 'skipping unknown exercise %', e.name_en;
        continue;
      end if;
      insert into public.program_exercises
        (program_day_id, exercise_id, position, target_sets, target_reps, target_weight_kg, target_rpe, rest_seconds)
      values
        (v_day, v_ex, v_pos, 3 + (v_pos = 0)::int, case when d.name = 'Cardio' then '45s' else '8-12' end,
         null, case when d.name = 'Cardio' then null else 2 end, case when d.name = 'Cardio' then 30 else 90 end);
      v_pos := v_pos + 1;
    end loop;
    raise notice 'added day % with % exercises', d.name, v_pos;
  end loop;
end $$;
