-- Timed exercises, the coach's per-exercise cue, and three missing library rows.
--
-- 1. program_exercises.measure — 'reps' (default) or 'time'. For a timed row
--    target_reps keeps its shape ("30" or "30-45") and is read as SECONDS, so
--    validation, ranges and every copy path stay as they are.
-- 2. logged_sets.duration_seconds — how long a timed set was held. Such a set
--    is logged with reps = 0, which keeps it out of e1RM / PR / volume math
--    (all weight × reps) without a branch in any of them.
-- 3. program_exercises.notes has existed since 20260823000300 but nothing
--    wrote it; the builder now does (the coach's personal cue for this client
--    on this exercise — not the library's how-to). No schema change needed.
-- 4. copy_program / duplicate_program_exercise carry `measure`.
-- 5. Library: bodyweight Glute Bridge, Reverse Lunge, Assisted Reverse Lunge.

alter table public.program_exercises
  add column if not exists measure text not null default 'reps'
    check (measure in ('reps', 'time'));
comment on column public.program_exercises.measure is
  'reps = target_reps is a rep count; time = target_reps is seconds ("30" or "30-45"). Mirrors EXERCISE_MEASURES in packages/shared.';
comment on column public.program_exercises.notes is
  'The coach''s own cue for this exercise in this program (execution, tempo, setup) — shown to the client next to the exercise.';

alter table public.logged_sets
  add column if not exists duration_seconds int check (duration_seconds between 1 and 7200);
comment on column public.logged_sets.duration_seconds is
  'Seconds held/performed for a timed set (program_exercises.measure = time); reps is 0 on such a set.';

-- ---------- copy keeps measure ----------
-- Body as in 20260930100000, plus `measure` on each exercise.
create or replace function public.copy_program(
  p_source uuid,
  p_name text default null,
  p_for_client uuid default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_src public.programs;
  v_new uuid;
  v_name text;
  v_day record;
  v_new_day uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  select * into v_src from public.programs where id = p_source;
  if not found or not public.can_see_program(p_source) then
    raise exception 'program not found' using errcode = 'P0002';
  end if;

  v_name := nullif(btrim(coalesce(p_name, '')), '');
  if v_name is null then
    v_name := v_src.name;
  end if;
  v_name := left(v_name, 120);

  if p_for_client is null then
    if public.has_active_coach() then
      raise exception 'a coached client cannot own their own programs' using errcode = '42501';
    end if;
    insert into public.programs
      (coach_id, client_id, name, description, level, goal, training_style, notes, weeks, intensity_mode, status,
       visibility, source_program_id)
    values
      (null, auth.uid(), v_name, v_src.description, v_src.level, v_src.goal, v_src.training_style, v_src.notes,
       v_src.weeks, v_src.intensity_mode, 'published', 'private', p_source)
    returning id into v_new;
  else
    if not public.is_active_coach_of(p_for_client) then
      raise exception 'not an active coach of that client' using errcode = '42501';
    end if;
    insert into public.programs
      (coach_id, client_id, name, description, level, goal, training_style, notes, weeks, intensity_mode, status,
       visibility, source_program_id)
    values
      (auth.uid(), p_for_client, v_name, v_src.description, v_src.level, v_src.goal, v_src.training_style, v_src.notes,
       v_src.weeks, v_src.intensity_mode, 'draft', 'private', p_source)
    returning id into v_new;
  end if;

  for v_day in
    select * from public.program_days where program_id = p_source order by week_index, day_index
  loop
    insert into public.program_days (program_id, week_index, day_index, name, muscle_groups)
    values (v_new, v_day.week_index, v_day.day_index, v_day.name, v_day.muscle_groups)
    returning id into v_new_day;

    insert into public.program_exercises
      (program_day_id, exercise_id, position, target_sets, target_reps, target_weight_kg,
       target_rpe, rest_seconds, notes, circuit, set_type, measure)
    select v_new_day, e.exercise_id, e.position, e.target_sets, e.target_reps, e.target_weight_kg,
           e.target_rpe, e.rest_seconds, e.notes, e.circuit, e.set_type, e.measure
    from public.program_exercises e
    where e.program_day_id = v_day.id;
  end loop;

  if coalesce(v_src.coach_id, v_src.client_id) <> auth.uid() then
    update public.programs set copy_count = copy_count + 1 where id = p_source;
  end if;

  return v_new;
end;
$$;
grant execute on function public.copy_program(uuid, text, uuid) to authenticated;

create or replace function public.duplicate_program_exercise(p_row uuid)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v public.program_exercises;
  v_program uuid;
  v_new uuid;
begin
  select * into v from public.program_exercises where id = p_row;
  if not found then
    raise exception 'exercise not found' using errcode = '42501';
  end if;
  select program_id into v_program from public.program_days where id = v.program_day_id;
  if not public.can_edit_program(v_program) then
    raise exception 'not allowed to edit this program' using errcode = '42501';
  end if;

  update public.program_exercises
     set position = position + 1
   where program_day_id = v.program_day_id and position > v.position;

  insert into public.program_exercises
    (program_day_id, exercise_id, position, target_sets, target_reps, target_weight_kg,
     target_rpe, rest_seconds, notes, circuit, set_type, measure)
  values
    (v.program_day_id, v.exercise_id, v.position + 1, v.target_sets, v.target_reps, v.target_weight_kg,
     v.target_rpe, v.rest_seconds, v.notes, v.circuit, v.set_type, v.measure)
  returning id into v_new;
  return v_new;
end;
$$;
revoke execute on function public.duplicate_program_exercise(uuid) from public, anon;
grant execute on function public.duplicate_program_exercise(uuid) to authenticated;

-- ---------- library additions ----------
-- System rows (owner_id null) that Free Exercise DB does not have. source is
-- 'custom' because the check allows only that or the import's own; the
-- external_id prefix keeps them out of the importer's key space. The glute
-- bridge reuses the import's "Butt Lift (Bridge)" photos — the same movement.
insert into public.exercises
  (owner_id, source, external_id, name_en, name_ro, category, level, force, mechanic, equipment,
   primary_muscles, secondary_muscles, instructions_en, instructions_ro, images)
values
  (null, 'custom', 'voinic:glute_bridge', 'Glute Bridge', 'Punte pentru fesieri',
   'strength', 'beginner', 'push', 'isolation', 'body only',
   '{glutes}', '{hamstrings,abdominals}',
   E'Lie on your back, knees bent, feet flat on the floor hip-width apart, arms by your sides.\nBrace your core and drive through your heels to lift your hips until knees, hips and shoulders form a straight line.\nSqueeze your glutes at the top for a second without arching your lower back.\nLower slowly to the floor and repeat.',
   E'Întinde-te pe spate, cu genunchii îndoiți și tălpile pe sol, la lățimea șoldurilor, brațele pe lângă corp.\nContractă abdomenul și împinge prin călcâie pentru a ridica șoldurile până când genunchii, șoldurile și umerii formează o linie dreaptă.\nStrânge fesierii sus o secundă, fără să arcuiești zona lombară.\nCoboară controlat și repetă.',
   '{https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/Butt_Lift_Bridge/0.jpg,https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/Butt_Lift_Bridge/1.jpg}'),
  (null, 'custom', 'voinic:reverse_lunge', 'Reverse Lunge', 'Fandare inversă',
   'strength', 'beginner', 'push', 'compound', 'body only',
   '{quadriceps}', '{glutes,hamstrings,calves}',
   E'Stand tall, feet hip-width apart, hands on your hips.\nStep back with one foot and lower until both knees are bent at about 90 degrees, the back knee just above the floor.\nKeep your torso upright and the front knee over the middle of the foot.\nPush through the front heel to return to standing; alternate legs or finish one side first.',
   E'Stai drept, cu picioarele la lățimea șoldurilor și mâinile pe șolduri.\nFă un pas înapoi cu un picior și coboară până când ambii genunchi sunt îndoiți la aproximativ 90 de grade, genunchiul din spate chiar deasupra solului.\nPăstrează trunchiul drept și genunchiul din față deasupra mijlocului tălpii.\nÎmpinge prin călcâiul din față pentru a reveni; alternează picioarele sau termină întâi o parte.',
   '{}'),
  (null, 'custom', 'voinic:assisted_reverse_lunge', 'Assisted Reverse Lunge', 'Fandare inversă cu sprijin',
   'strength', 'beginner', 'push', 'compound', 'body only',
   '{quadriceps}', '{glutes,hamstrings}',
   E'A beginner version: hold a chair back, a wall, a rack or a TRX strap with one or both hands.\nStep back with one foot and lower as far as is comfortable, using the support for balance — not to pull yourself up.\nKeep your torso upright and the front knee over the middle of the foot.\nPush through the front heel to return to standing. Rely on the support less as you get stronger.',
   E'Varianta pentru începători: ține-te cu una sau ambele mâini de spătarul unui scaun, de perete, de un rack sau de o bandă TRX.\nFă un pas înapoi cu un picior și coboară cât îți este confortabil, folosind sprijinul pentru echilibru — nu ca să te tragi în sus.\nPăstrează trunchiul drept și genunchiul din față deasupra mijlocului tălpii.\nÎmpinge prin călcâiul din față pentru a reveni. Pe măsură ce devii mai puternic, sprijină-te tot mai puțin.',
   '{}')
on conflict (source, external_id) do nothing;
