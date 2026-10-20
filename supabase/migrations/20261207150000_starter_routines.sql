-- Voinic's starter routines for Discover (2026-12-07)
--
-- Discover shows what people have published, so on a fresh account it is
-- empty. 20260930100000 already has the mechanism for "routines Voinic stands
-- behind": a public routine owned by an account and flagged is_official /
-- featured by an admin. What was missing is the content.
--
-- admin_create_starter_routines() lets an admin create four of them in one
-- call, owned by the admin's own account (as any routine is owned by someone),
-- public, marked official and featured:
--
--   Full Body — 3 zile            beginner · general · full_body
--   Upper / Lower — 4 zile        intermediate · hypertrophy · upper_lower
--   Push / Pull / Legs — 3 zile   intermediate · hypertrophy · push_pull_legs
--   Forță — 4 zile                intermediate · strength · upper_lower
--
-- Exercises are the system library's (exercises.owner_id is null), found by
-- their Free Exercise DB id; one the library lacks is skipped, never invented.
-- Idempotent per admin: a routine with the same name already owned by the
-- caller is left alone, so pressing the button twice creates nothing new.
-- The routine flags survive because the writes are an admin's
-- (20260930150000 clears them only for a non-admin's edit).

create or replace function public.admin_create_starter_routines()
returns int language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := auth.uid();
  v_routines jsonb := $json$[
    {"name": "Full Body — 3 zile", "level": "beginner", "goal": "general", "style": "full_body", "weeks": 8, "mode": "rir",
     "description": "Trei antrenamente pe săptămână pentru tot corpul, cu o zi liberă între ele. Bun pentru primele luni la sală: exercițiile de bază, puține seturi, timp să înveți tehnica. Crește greutatea când faci toate repetările cu 2 în rezervă.",
     "days": [
       {"name": "Ziua A", "ex": [["Barbell_Squat",3,"6-8",150],["Barbell_Bench_Press_-_Medium_Grip",3,"6-10",120],["Bent_Over_Barbell_Row",3,"8-10",120],["Plank",3,"40",60,"time"]]},
       {"name": "Ziua B", "ex": [["Romanian_Deadlift",3,"8-10",150],["Standing_Military_Press",3,"6-10",120],["Wide-Grip_Lat_Pulldown",3,"8-12",90],["Dumbbell_Lunges",2,"10-12",90]]},
       {"name": "Ziua C", "ex": [["Goblet_Squat",3,"10-12",90],["Dumbbell_Bench_Press",3,"8-12",90],["Seated_Cable_Rows",3,"10-12",90],["Hanging_Leg_Raise",3,"8-12",60]]}
     ]},
    {"name": "Upper / Lower — 4 zile", "level": "intermediate", "goal": "hypertrophy", "style": "upper_lower", "weeks": 8, "mode": "rir",
     "description": "Patru zile: de două ori partea de sus, de două ori picioarele. Volum moderat pentru masă musculară, cu exerciții compuse la început și izolare la final. Pauză după ziua 2.",
     "days": [
       {"name": "Upper 1", "ex": [["Barbell_Bench_Press_-_Medium_Grip",4,"6-8",150],["Bent_Over_Barbell_Row",4,"6-8",150],["Dumbbell_Shoulder_Press",3,"8-12",90],["Wide-Grip_Lat_Pulldown",3,"10-12",90],["Barbell_Curl",2,"10-12",60],["Triceps_Pushdown",2,"10-12",60]]},
       {"name": "Lower 1", "ex": [["Barbell_Squat",4,"6-8",180],["Romanian_Deadlift",3,"8-10",150],["Leg_Press",3,"10-12",120],["Lying_Leg_Curls",3,"10-12",60],["Standing_Calf_Raises",3,"12-15",60]]},
       {"name": "Upper 2", "ex": [["Incline_Dumbbell_Press",4,"8-10",120],["Pullups",4,"6-10",120],["Seated_Cable_Rows",3,"10-12",90],["Side_Lateral_Raise",3,"12-15",60],["Hammer_Curls",2,"10-12",60],["Dips_-_Triceps_Version",2,"8-12",90]]},
       {"name": "Lower 2", "ex": [["Barbell_Deadlift",3,"5",180],["Front_Barbell_Squat",3,"6-8",150],["Barbell_Hip_Thrust",3,"8-12",90],["Leg_Extensions",3,"12-15",60],["Cable_Crunch",3,"12-15",60]]}
     ]},
    {"name": "Push / Pull / Legs — 3 zile", "level": "intermediate", "goal": "hypertrophy", "style": "push_pull_legs", "weeks": 8, "mode": "rir",
     "description": "Împingeri, trageri, picioare — fiecare grupă o dată pe săptămână, cu volum mai mare pe zi. Poți face ciclul de două ori pe săptămână dacă te refaci bine.",
     "days": [
       {"name": "Push", "ex": [["Barbell_Bench_Press_-_Medium_Grip",4,"6-8",150],["Incline_Dumbbell_Press",3,"8-10",120],["Standing_Military_Press",3,"6-10",120],["Side_Lateral_Raise",3,"12-15",60],["Triceps_Pushdown",3,"10-12",60]]},
       {"name": "Pull", "ex": [["Barbell_Deadlift",3,"5",180],["Pullups",4,"6-10",120],["Seated_Cable_Rows",3,"10-12",90],["Face_Pull",3,"12-15",60],["Barbell_Curl",3,"8-12",60]]},
       {"name": "Legs", "ex": [["Barbell_Squat",4,"6-8",180],["Romanian_Deadlift",3,"8-10",150],["Leg_Press",3,"10-12",120],["Lying_Leg_Curls",3,"10-12",60],["Standing_Calf_Raises",4,"12-15",60]]}
     ]},
    {"name": "Forță — 4 zile", "level": "intermediate", "goal": "strength", "style": "upper_lower", "weeks": 12, "mode": "rpe",
     "description": "Un ridicat principal pe zi — genuflexiune, împins la piept, îndreptări, împins deasupra capului — cu repetări puține și pauze lungi, apoi două exerciții ajutătoare. Crește încet: 2,5 kg pe săptămână la presă, 5 kg la picioare, cât timp RPE rămâne sub 9.",
     "days": [
       {"name": "Genuflexiuni", "ex": [["Barbell_Squat",5,"3-5",240],["Romanian_Deadlift",3,"6-8",150],["Hanging_Leg_Raise",3,"8-12",60]]},
       {"name": "Împins la piept", "ex": [["Barbell_Bench_Press_-_Medium_Grip",5,"3-5",240],["Bent_Over_Barbell_Row",3,"6-8",150],["Close-Grip_Barbell_Bench_Press",3,"6-8",150]]},
       {"name": "Îndreptări", "ex": [["Barbell_Deadlift",5,"3",240],["Front_Barbell_Squat",3,"5-6",180],["Lying_Leg_Curls",3,"8-10",90]]},
       {"name": "Împins deasupra capului", "ex": [["Standing_Military_Press",5,"3-5",210],["Pullups",4,"5-8",150],["Dips_-_Triceps_Version",3,"6-10",120]]}
     ]}
  ]$json$;
  r jsonb;
  d jsonb;
  x jsonb;
  v_program uuid;
  v_day uuid;
  v_ex uuid;
  v_day_i int;
  v_pos int;
  v_created int := 0;
begin
  perform public.admin_assert();

  for r in select * from jsonb_array_elements(v_routines) loop
    if exists (select 1 from public.programs p
                where p.client_id = v_admin and p.coach_id is null and p.name = r ->> 'name') then
      continue;
    end if;

    insert into public.programs (coach_id, client_id, name, description, level, goal, training_style,
                                 weeks, intensity_mode, status, visibility)
    values (null, v_admin, r ->> 'name', r ->> 'description', r ->> 'level', r ->> 'goal', r ->> 'style',
            (r ->> 'weeks')::int, (r ->> 'mode')::intensity_mode, 'published', 'public')
    returning id into v_program;

    v_day_i := 0;
    for d in select * from jsonb_array_elements(r -> 'days') loop
      v_day_i := v_day_i + 1;
      insert into public.program_days (program_id, week_index, day_index, name)
      values (v_program, 1, v_day_i, d ->> 'name')
      returning id into v_day;

      v_pos := 0;
      for x in select * from jsonb_array_elements(d -> 'ex') loop
        select e.id into v_ex from public.exercises e
         where e.owner_id is null and e.external_id = x ->> 0
         limit 1;
        continue when v_ex is null;
        insert into public.program_exercises (program_day_id, exercise_id, position, target_sets, target_reps,
                                              rest_seconds, measure)
        values (v_day, v_ex, v_pos, (x ->> 1)::int, x ->> 2, (x ->> 3)::int, coalesce(x ->> 4, 'reps'));
        v_pos := v_pos + 1;
      end loop;
    end loop;

    update public.programs
       set is_official = true, featured_at = now()
     where id = v_program;
    v_created := v_created + 1;
  end loop;

  return v_created;
end;
$$;
revoke execute on function public.admin_create_starter_routines() from public, anon;
grant execute on function public.admin_create_starter_routines() to authenticated;
