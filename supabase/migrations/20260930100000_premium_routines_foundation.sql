-- HealthApp schema · premium routines foundation
--
-- Builds on 20260923130000_program_library (visibility, saves, copy_program,
-- discovery). No new program table and no change to ownership: a routine is
-- still a `programs` row bound to one account (client_id NOT NULL).
--
-- 1. Prescriptions. target_rpe was `between 1 and 10` since the first
--    migration, but in an RIR program it holds RIR, and RIR 0 ("to failure")
--    is a real prescription the builder already accepts (validateTargets
--    allows 0..10) — the insert then failed. Now 0..10; the per-scale rule
--    (RPE ≥ 1) is validateProgram()'s, advisory. New `set_type` per
--    prescribed exercise.
--
-- 2. Metadata the library filters on: `training_style`. Everything else asked
--    for already exists or is derived rather than stored — description, goal,
--    level, weeks (programs); days per week, equipment, muscle groups and
--    session length (from the days and exercises, in program_card_rows).
--
-- 3. Admin-only flags: `featured_at` (the Featured shelf) and `is_official`
--    (a routine Voinic stands behind — "Voinic-created" without a special
--    owner: it is published from an account and marked by an admin). Set only
--    through admin_set_program_flags(); only a PUBLIC routine may carry them,
--    and a trigger drops the feature the moment the routine stops being public.
--
-- 4. Column privileges on programs. Until now `authenticated` could INSERT and
--    UPDATE every column, and RLS only asked WHO owns the row — so an owner
--    could set their own copy_count ("most copied"), forge source_program_id
--    to inflate someone else's program_usage(), move a row to another account,
--    and would have been able to feature themselves. Now the grant lists what
--    the app writes; lineage, counters, ownership changes and flags go through
--    the security-definer functions that own those rules (copy_program,
--    admin_set_program_flags). Every app write was checked against the list.
--
-- 5. Reads: program_card_rows / my_programs / discover_programs gain weeks,
--    days_per_week, session_minutes, training_style, featured and source;
--    Discover filters on style, session length and featured. program_usage
--    gains the save count. Return types change, so each is dropped first.
--
-- 6. duplicate_program_exercise(): copy one prescribed exercise to right after
--    itself, shifting the rest, in one transaction. Security invoker — the
--    writes go through the editing policies — plus an explicit can_edit_program
--    check so a refusal is an error, not a silent no-op.
--
-- History is untouched by all of it: logged_sets carries its own weight and
-- reps, program_exercise_id / program_day_id are `on delete set null`.

-- ---------- 1. prescriptions ----------
alter table public.program_exercises drop constraint if exists program_exercises_target_rpe_check;
alter table public.program_exercises add constraint program_exercises_target_rpe_check
  check (target_rpe between 0 and 10);

alter table public.program_exercises
  add column if not exists set_type text not null default 'normal'
    check (set_type in ('normal', 'warmup', 'drop_set', 'amrap', 'to_failure'));
comment on column public.program_exercises.set_type is
  'How the prescribed sets are performed: normal, warmup, drop_set, amrap, to_failure. Mirrors SET_TYPES in packages/shared.';

-- ---------- 2. metadata ----------
alter table public.programs
  add column if not exists training_style text
    check (training_style is null or training_style in
      ('full_body', 'upper_lower', 'push_pull_legs', 'body_part_split', 'circuit', 'other'));

-- ---------- 3. admin flags ----------
alter table public.programs
  add column if not exists featured_at timestamptz,
  add column if not exists is_official boolean not null default false;
comment on column public.programs.featured_at is
  'Set by an admin through admin_set_program_flags() — never by the owner (no column grant). Cleared when the routine leaves public.';
comment on column public.programs.is_official is
  'A routine Voinic stands behind. Admin-set only, like featured_at.';

create index if not exists programs_featured_idx
  on public.programs (featured_at desc) where featured_at is not null and visibility = 'public';

create or replace function public.programs_drop_feature_when_hidden()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.visibility <> 'public' then
    new.featured_at := null;
  end if;
  return new;
end;
$$;
drop trigger if exists programs_drop_feature_when_hidden on public.programs;
create trigger programs_drop_feature_when_hidden before update of visibility on public.programs
  for each row execute function public.programs_drop_feature_when_hidden();

create or replace function public.admin_set_program_flags(p_program uuid, p_featured boolean, p_official boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_visibility text;
begin
  perform public.admin_assert();
  select visibility into v_visibility from public.programs where id = p_program;
  if not found then
    raise exception 'program not found' using errcode = 'P0002';
  end if;
  if (p_featured or p_official) and v_visibility <> 'public' then
    raise exception 'only a public routine can be featured or marked official' using errcode = '22023';
  end if;
  update public.programs
     set featured_at = case when p_featured then coalesce(featured_at, now()) else null end,
         is_official = p_official
   where id = p_program;
end;
$$;
revoke execute on function public.admin_set_program_flags(uuid, boolean, boolean) from public, anon;
grant execute on function public.admin_set_program_flags(uuid, boolean, boolean) to authenticated;

-- ---------- 4. what an owner may write ----------
revoke insert, update on table public.programs from authenticated;
grant insert (coach_id, client_id, name, notes, status, intensity_mode, weeks,
              visibility, description, level, goal, training_style)
  on table public.programs to authenticated;
grant update (name, notes, status, intensity_mode, weeks,
              visibility, description, level, goal, training_style)
  on table public.programs to authenticated;

-- ---------- 5. reads ----------
drop function if exists public.discover_programs(text, text, text, text, text, text, int, int);
drop function if exists public.my_programs(boolean);
drop function if exists public.program_card_rows(uuid[]);
drop function if exists public.program_usage(uuid);

create function public.program_card_rows(p_ids uuid[])
returns table (
  id uuid, name text, description text, level text, goal text, visibility text,
  status text, coach_id uuid, client_id uuid, source_program_id uuid,
  author_id uuid, author_name text, author_username text, author_avatar text,
  days int, exercises int, total_sets int, est_minutes int,
  muscle_groups text[], equipment text[], copy_count int,
  weeks int, days_per_week int, session_minutes int, training_style text,
  featured boolean, source text,
  saved boolean, is_mine boolean, assigned_by_coach boolean,
  created_at timestamptz, updated_at timestamptz
) language sql stable security definer set search_path = public as $$
  select
    p.id, p.name, p.description, p.level, p.goal, p.visibility,
    p.status::text, p.coach_id, p.client_id, p.source_program_id,
    coalesce(p.coach_id, p.client_id) as author_id,
    coalesce(u.username, u.full_name) as author_name,
    u.username, u.avatar_url,
    coalesce(agg.days, 0) as days,
    coalesce(agg.exercises, 0) as exercises,
    coalesce(agg.total_sets, 0) as total_sets,
    -- A deterministic estimate: every set is 40 s of work plus its own rest
    -- (90 s when none is set). Mirrors estimateMinutes() in packages/shared.
    coalesce(agg.est_seconds, 0) / 60 as est_minutes,
    coalesce(agg.muscles, '{}') as muscle_groups,
    coalesce(agg.equipment, '{}') as equipment,
    p.copy_count,
    p.weeks,
    coalesce(wk.days, 0) as days_per_week,
    coalesce(sess.minutes, 0) as session_minutes,
    p.training_style,
    (p.featured_at is not null and p.visibility = 'public') as featured,
    -- Mirrors routineSource() in packages/shared/src/routines.ts.
    case when p.is_official then 'voinic'
         when p.coach_id is not null or u.role in ('coach', 'both') then 'coach'
         else 'user' end as source,
    exists (select 1 from public.program_saves s where s.program_id = p.id and s.user_id = auth.uid()) as saved,
    (coalesce(p.coach_id, p.client_id) = auth.uid()) as is_mine,
    (p.coach_id is not null and p.client_id = auth.uid()) as assigned_by_coach,
    p.created_at, p.updated_at
  from public.programs p
  join public.users u on u.id = coalesce(p.coach_id, p.client_id)
  left join lateral (
    select
      count(distinct d.id)::int as days,
      count(e.id)::int as exercises,
      coalesce(sum(e.target_sets), 0)::int as total_sets,
      coalesce(sum(e.target_sets * (40 + coalesce(e.rest_seconds, 90))), 0)::int as est_seconds,
      array_agg(distinct m) filter (where m is not null) as muscles,
      array_agg(distinct x.equipment) filter (where x.equipment is not null) as equipment
    from public.program_days d
    left join public.program_exercises e on e.program_day_id = d.id
    left join public.exercises x on x.id = e.exercise_id
    left join lateral unnest(coalesce(x.primary_muscles, '{}')) as m on true
    where d.program_id = p.id
  ) agg on true
  -- Days in the first week: "days per week" as the program states it.
  left join lateral (
    select count(*)::int as days from public.program_days d
    where d.program_id = p.id
      and d.week_index = (select min(d2.week_index) from public.program_days d2 where d2.program_id = p.id)
  ) wk on true
  -- A session's length: each day's whole minutes, averaged over the days and
  -- rounded — the detail page's figure (sessionMinutes() in packages/shared).
  left join lateral (
    select round(avg(day_minutes))::int as minutes
    from (
      select floor(coalesce(sum(e.target_sets * (40 + coalesce(e.rest_seconds, 90))), 0) / 60.0) as day_minutes
      from public.program_days d
      left join public.program_exercises e on e.program_day_id = d.id
      where d.program_id = p.id
      group by d.id
    ) per_day
  ) sess on true
  where p.id = any(p_ids)
    and public.can_see_program(p.id);
$$;
grant execute on function public.program_card_rows(uuid[]) to authenticated;

create function public.my_programs(p_saved boolean default false)
returns table (
  id uuid, name text, description text, level text, goal text, visibility text,
  status text, coach_id uuid, client_id uuid, source_program_id uuid,
  author_id uuid, author_name text, author_username text, author_avatar text,
  days int, exercises int, total_sets int, est_minutes int,
  muscle_groups text[], equipment text[], copy_count int,
  weeks int, days_per_week int, session_minutes int, training_style text,
  featured boolean, source text,
  saved boolean, is_mine boolean, assigned_by_coach boolean,
  created_at timestamptz, updated_at timestamptz
) language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  if p_saved then
    return query
      select c.* from public.program_card_rows(
        array(select s.program_id from public.program_saves s where s.user_id = auth.uid())
      ) c
      order by c.updated_at desc;
  else
    return query
      select c.* from public.program_card_rows(
        array(select p.id from public.programs p
              where p.client_id = auth.uid() or p.coach_id = auth.uid())
      ) c
      order by c.updated_at desc;
  end if;
end;
$$;
grant execute on function public.my_programs(boolean) to authenticated;

-- Discover: the public shelf, paged, every filter applied before the limit.
-- Sorting is deterministic (newest / most copied); Featured is a FILTER an
-- admin curates, not a ranking — nothing here is recommended by an algorithm.
create function public.discover_programs(
  p_q text default null,
  p_level text default null,
  p_goal text default null,
  p_muscle text default null,
  p_equipment text default null,
  p_sort text default 'newest',
  p_limit int default 20,
  p_offset int default 0,
  p_style text default null,
  p_max_minutes int default null,
  p_featured boolean default false
)
returns table (
  id uuid, name text, description text, level text, goal text, visibility text,
  status text, coach_id uuid, client_id uuid, source_program_id uuid,
  author_id uuid, author_name text, author_username text, author_avatar text,
  days int, exercises int, total_sets int, est_minutes int,
  muscle_groups text[], equipment text[], copy_count int,
  weeks int, days_per_week int, session_minutes int, training_style text,
  featured boolean, source text,
  saved boolean, is_mine boolean, assigned_by_coach boolean,
  created_at timestamptz, updated_at timestamptz
) language plpgsql stable security definer set search_path = public as $$
declare
  v_limit int := greatest(1, least(coalesce(p_limit, 20), 50));
  v_offset int := greatest(0, coalesce(p_offset, 0));
  v_q text := nullif(btrim(coalesce(p_q, '')), '');
  v_sort text := coalesce(p_sort, 'newest');
begin
  if auth.uid() is null then return; end if;
  if v_sort not in ('newest', 'most_copied') then
    raise exception 'unknown sort' using errcode = '22023';
  end if;
  return query
    select c.*
    from public.program_card_rows(
      array(
        select p.id
        from public.programs p
        join public.users u on u.id = coalesce(p.coach_id, p.client_id)
        where p.visibility <> 'private'
          and public.can_see_program(p.id)
          and exists (select 1 from public.program_days d where d.program_id = p.id)
          and (v_q is null
               or p.name ilike '%' || v_q || '%'
               or coalesce(u.username, u.full_name) ilike '%' || v_q || '%'
               or coalesce(p.description, '') ilike '%' || v_q || '%')
          and (p_level is null or p.level = p_level)
          and (p_goal is null or p.goal = p_goal)
          and (p_style is null or p.training_style = p_style)
          and (not coalesce(p_featured, false) or (p.featured_at is not null and p.visibility = 'public'))
          and (p_muscle is null or exists (
                select 1 from public.program_days d
                join public.program_exercises e on e.program_day_id = d.id
                join public.exercises x on x.id = e.exercise_id
                where d.program_id = p.id and p_muscle = any(x.primary_muscles)))
          and (p_equipment is null or exists (
                select 1 from public.program_days d
                join public.program_exercises e on e.program_day_id = d.id
                join public.exercises x on x.id = e.exercise_id
                where d.program_id = p.id and x.equipment = p_equipment))
          and (p_max_minutes is null or (
                select round(avg(day_minutes)) from (
                  select floor(coalesce(sum(e.target_sets * (40 + coalesce(e.rest_seconds, 90))), 0) / 60.0) as day_minutes
                  from public.program_days d
                  left join public.program_exercises e on e.program_day_id = d.id
                  where d.program_id = p.id
                  group by d.id
                ) per_day) <= p_max_minutes)
        order by
          case when v_sort = 'most_copied' then p.copy_count end desc nulls last,
          p.created_at desc
        limit v_limit offset v_offset
      )
    ) c
    order by
      case when v_sort = 'most_copied' then c.copy_count end desc nulls last,
      c.created_at desc;
end;
$$;
grant execute on function public.discover_programs(text, text, text, text, text, text, int, int, text, int, boolean) to authenticated;

-- Aggregate counts only — never who.
create function public.program_usage(p_program uuid)
returns table (copies int, users int, sessions int, completed int, saves int)
language sql stable security definer set search_path = public as $$
  select
    (select count(*)::int from public.programs c where c.source_program_id = p_program),
    (select count(distinct c.client_id)::int from public.programs c
      where c.source_program_id = p_program or c.id = p_program),
    (select count(*)::int from public.logged_sessions s
      join public.program_days d on d.id = s.program_day_id
      join public.programs c on c.id = d.program_id
      where c.id = p_program or c.source_program_id = p_program),
    (select count(*)::int from public.logged_sessions s
      join public.program_days d on d.id = s.program_day_id
      join public.programs c on c.id = d.program_id
      where (c.id = p_program or c.source_program_id = p_program) and s.completed_at is not null),
    (select count(*)::int from public.program_saves s where s.program_id = p_program)
  where public.can_see_program(p_program);
$$;
grant execute on function public.program_usage(uuid) to authenticated;

-- ---------- copy keeps the new fields (and never the admin flags) ----------
-- Body as in 20260923130000, plus training_style on the program and set_type
-- on each exercise. featured_at / is_official are left at their defaults on
-- the copy: a feature belongs to the routine an admin looked at, not to
-- every copy of it.
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
       target_rpe, rest_seconds, notes, circuit, set_type)
    select v_new_day, e.exercise_id, e.position, e.target_sets, e.target_reps, e.target_weight_kg,
           e.target_rpe, e.rest_seconds, e.notes, e.circuit, e.set_type
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

-- ---------- 6. duplicate one exercise ----------
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
     target_rpe, rest_seconds, notes, circuit, set_type)
  values
    (v.program_day_id, v.exercise_id, v.position + 1, v.target_sets, v.target_reps, v.target_weight_kg,
     v.target_rpe, v.rest_seconds, v.notes, v.circuit, v.set_type)
  returning id into v_new;
  return v_new;
end;
$$;
revoke execute on function public.duplicate_program_exercise(uuid) from public, anon;
grant execute on function public.duplicate_program_exercise(uuid) to authenticated;
