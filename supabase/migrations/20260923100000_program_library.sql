-- HealthApp schema · routine library: visibility, saving, copying, discovery
--
-- The plan (PROGRAM) and the execution (WORKOUT) were already separate:
-- logged_sets carries its own weight and reps, and program_day_id is
-- `on delete set null`, so editing or deleting a program never rewrites what
-- somebody actually lifted. Nothing here changes that, and
-- supabase/tests/program_library.test.sql pins it down.
--
-- What this migration adds is reuse:
--
-- 1. programs grows `visibility`, `description`, `level`, `goal`,
--    `source_program_id` and `copy_count`. No new program table — a routine IS
--    a program; the library is a way of finding and copying one.
--
-- 2. A program may only leave 'private' when it has no coach
--    (`programs_shareable_only_solo`). A coach's program is written FOR one
--    named client, so publishing it would publish somebody's prescription. A
--    coach who wants to publish a template does it from their own training
--    account, where coach_id is null — the same surface as "My training".
--
-- 3. `assign to a client` is a COPY, not a shared row: programs.client_id is
--    NOT NULL and has always bound a program to exactly one person. So
--    copy_program() is the single path behind Duplicate, "Copy to my
--    programs" and "Assign to client" — three buttons, one atomic function,
--    one set of rules. Copies are independent by construction (new rows all
--    the way down); `source_program_id` records where a copy came from, which
--    is what "used by" and "most copied" read, and is `on delete set null` so
--    deleting the original never deletes its children.
--
-- 4. program_saves is a bookmark: the same shape as social_follows — a unique
--    pair, owner-only policies, so the toggle is race-safe in the database
--    rather than in the action.
--
-- 5. Reading the library is three security-definer functions rather than a
--    query per card: my_programs(), discover_programs() and program_usage().
--    A card needs day and exercise counts, the muscle groups across every
--    exercise and the author's name; done in the app that is four round trips
--    per program.

-- ---------- 1. the columns ----------
alter table public.programs
  add column if not exists visibility text not null default 'private'
    check (visibility in ('private', 'followers', 'public')),
  add column if not exists description text
    check (description is null or char_length(description) <= 2000),
  add column if not exists level text
    check (level is null or level in ('beginner', 'intermediate', 'advanced')),
  add column if not exists goal text
    check (goal is null or goal in ('strength', 'hypertrophy', 'fat_loss', 'endurance', 'general')),
  add column if not exists source_program_id uuid references public.programs (id) on delete set null,
  add column if not exists copy_count int not null default 0;

comment on column public.programs.visibility is
  'private (default) · followers · public. Only a program with coach_id null may leave private — a coach program belongs to one named client.';
comment on column public.programs.source_program_id is
  'The program this one was copied from. Lineage only: the copy shares no rows with it.';

alter table public.programs drop constraint if exists programs_shareable_only_solo;
alter table public.programs add constraint programs_shareable_only_solo
  check (visibility = 'private' or coach_id is null);

-- Discover reads the non-private rows by recency or popularity.
create index if not exists programs_discover_idx
  on public.programs (created_at desc) where visibility <> 'private';
create index if not exists programs_popular_idx
  on public.programs (copy_count desc, created_at desc) where visibility <> 'private';
create index if not exists programs_source_idx on public.programs (source_program_id);

-- ---------- 2. bookmarks ----------
create table if not exists public.program_saves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  program_id uuid not null references public.programs (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, program_id)
);
create index if not exists program_saves_user_idx on public.program_saves (user_id, created_at desc);
alter table public.program_saves enable row level security;

grant select, insert, update, delete on table public.program_saves to authenticated;
grant select, insert, update, delete on table public.program_saves to service_role;

-- ---------- 3. who may see a program ----------
-- Security definer so the policies below can call it without recursing into
-- the very policies they are deciding. Mirrors canSeeProgram() in
-- packages/shared/src/routines.ts.
create or replace function public.can_see_program(p_program uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.programs p
    where p.id = p_program
      and (
        -- your own, either as its coach or as the person it belongs to
        p.coach_id = auth.uid()
        or p.client_id = auth.uid()
        -- published to the world
        or p.visibility = 'public'
        -- published to the author's followers
        or (p.visibility = 'followers' and public.is_following(coalesce(p.coach_id, p.client_id)))
      )
  );
$$;
grant execute on function public.can_see_program(uuid) to authenticated;

-- A shared program, and its days and exercises, are readable by whoever the
-- visibility lets in. These are SELECT-only and sit alongside the existing
-- owner/coach policies — nothing already allowed becomes disallowed.
drop policy if exists programs_shared_read on public.programs;
create policy programs_shared_read on public.programs for select to authenticated
  using (visibility <> 'private' and public.can_see_program(id));

drop policy if exists program_days_shared_read on public.program_days;
create policy program_days_shared_read on public.program_days for select to authenticated
  using (exists (select 1 from public.programs p
                 where p.id = program_id and p.visibility <> 'private' and public.can_see_program(p.id)));

drop policy if exists program_exercises_shared_read on public.program_exercises;
create policy program_exercises_shared_read on public.program_exercises for select to authenticated
  using (exists (select 1 from public.program_days d join public.programs p on p.id = d.program_id
                 where d.id = program_day_id and p.visibility <> 'private' and public.can_see_program(p.id)));

-- A bookmark belongs to one person, and you can only bookmark what you can
-- see: the with-check is what stops a private program being saved by its id.
drop policy if exists program_saves_owner on public.program_saves;
create policy program_saves_owner on public.program_saves for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.can_see_program(program_id));

-- ---------- 4. copy / duplicate / assign ----------
-- One function behind all three, because they are the same operation with a
-- different destination:
--
--   duplicate  copy_program(mine)                 → a second copy for me
--   copy       copy_program(someone's public one) → my own copy
--   assign     copy_program(any, p_for_client)    → a copy owned by me as coach,
--                                                   belonging to that client
--
-- Security definer, so it must re-state every rule RLS would have applied:
-- the source must be visible, a coached client may not own new programs of
-- their own (policy programs_solo_insert), and a coach may only write for an
-- active client of theirs.
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
  v_status publish_status;
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
    -- A copy for myself. The same gate as programs_solo_insert: while a coach
    -- is active, the client does not author their own programs.
    if public.has_active_coach() then
      raise exception 'a coached client cannot own their own programs' using errcode = '42501';
    end if;
    -- Ready to train with straight away — this is the "Start program" path.
    v_status := 'published';
    insert into public.programs
      (coach_id, client_id, name, description, level, goal, notes, weeks, intensity_mode, status,
       visibility, source_program_id)
    values
      (null, auth.uid(), v_name, v_src.description, v_src.level, v_src.goal, v_src.notes,
       v_src.weeks, v_src.intensity_mode, v_status, 'private', p_source)
    returning id into v_new;
  else
    -- An assignment. Only an active coach of that client, and the copy stays a
    -- draft so the coach reviews it before the client sees it.
    if not public.is_active_coach_of(p_for_client) then
      raise exception 'not an active coach of that client' using errcode = '42501';
    end if;
    insert into public.programs
      (coach_id, client_id, name, description, level, goal, notes, weeks, intensity_mode, status,
       visibility, source_program_id)
    values
      (auth.uid(), p_for_client, v_name, v_src.description, v_src.level, v_src.goal, v_src.notes,
       v_src.weeks, v_src.intensity_mode, 'draft', 'private', p_source)
    returning id into v_new;
  end if;

  -- Days and their prescriptions, in order. New rows throughout: nothing the
  -- copy holds is shared with the source, so editing one cannot touch the other.
  for v_day in
    select * from public.program_days where program_id = p_source order by week_index, day_index
  loop
    insert into public.program_days (program_id, week_index, day_index, name, muscle_groups)
    values (v_new, v_day.week_index, v_day.day_index, v_day.name, v_day.muscle_groups)
    returning id into v_new_day;

    insert into public.program_exercises
      (program_day_id, exercise_id, position, target_sets, target_reps, target_weight_kg,
       target_rpe, rest_seconds, notes, circuit)
    select v_new_day, e.exercise_id, e.position, e.target_sets, e.target_reps, e.target_weight_kg,
           e.target_rpe, e.rest_seconds, e.notes, e.circuit
    from public.program_exercises e
    where e.program_day_id = v_day.id;
  end loop;

  -- "Most copied" counts other people picking it up. Duplicating your own
  -- program is housekeeping, not popularity.
  if coalesce(v_src.coach_id, v_src.client_id) <> auth.uid() then
    update public.programs set copy_count = copy_count + 1 where id = p_source;
  end if;

  return v_new;
end;
$$;
grant execute on function public.copy_program(uuid, text, uuid) to authenticated;

-- ---------- 5. reading the library ----------
-- The shape a program card needs, in one row. Counting days and exercises and
-- collecting muscle groups per card in the app is four round trips each; this
-- is one.
create or replace function public.program_card_rows(p_ids uuid[])
returns table (
  id uuid, name text, description text, level text, goal text, visibility text,
  status text, coach_id uuid, client_id uuid, source_program_id uuid,
  author_id uuid, author_name text, author_username text, author_avatar text,
  days int, exercises int, total_sets int, est_minutes int,
  muscle_groups text[], equipment text[], copy_count int,
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
    -- A deterministic estimate, not a measurement: every set is taken as 40
    -- seconds of work plus its own prescribed rest (90 s when none is set).
    coalesce(agg.est_seconds, 0) / 60 as est_minutes,
    coalesce(agg.muscles, '{}') as muscle_groups,
    coalesce(agg.equipment, '{}') as equipment,
    p.copy_count,
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
  where p.id = any(p_ids)
    and public.can_see_program(p.id);
$$;
grant execute on function public.program_card_rows(uuid[]) to authenticated;

-- Everything the signed-in person can call their own: programs they authored,
-- programs a coach assigned to them, and — when p_saved — the ones they saved.
-- The column list is spelled out rather than `setof record` because PostgREST
-- calls these with no column definition list.
create or replace function public.my_programs(p_saved boolean default false)
returns table (
  id uuid, name text, description text, level text, goal text, visibility text,
  status text, coach_id uuid, client_id uuid, source_program_id uuid,
  author_id uuid, author_name text, author_username text, author_avatar text,
  days int, exercises int, total_sets int, est_minutes int,
  muscle_groups text[], equipment text[], copy_count int,
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

-- Discover: the public shelf, paged. `p_sort` is deterministic on purpose —
-- newest is created_at, most copied is copy_count. Nothing is recommended.
--
-- Every filter, including muscle and equipment, is applied BEFORE the limit.
-- Filtering the page after it was cut would hand back short pages and make the
-- pager lie about what is left.
create or replace function public.discover_programs(
  p_q text default null,
  p_level text default null,
  p_goal text default null,
  p_muscle text default null,
  p_equipment text default null,
  p_sort text default 'newest',
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  id uuid, name text, description text, level text, goal text, visibility text,
  status text, coach_id uuid, client_id uuid, source_program_id uuid,
  author_id uuid, author_name text, author_username text, author_avatar text,
  days int, exercises int, total_sets int, est_minutes int,
  muscle_groups text[], equipment text[], copy_count int,
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
          -- a shelf of empty programs helps nobody
          and exists (select 1 from public.program_days d where d.program_id = p.id)
          and (v_q is null
               or p.name ilike '%' || v_q || '%'
               or coalesce(u.username, u.full_name) ilike '%' || v_q || '%'
               or coalesce(p.description, '') ilike '%' || v_q || '%')
          and (p_level is null or p.level = p_level)
          and (p_goal is null or p.goal = p_goal)
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
grant execute on function public.discover_programs(text, text, text, text, text, text, int, int) to authenticated;

-- How much a program is actually used. Aggregate counts only — never who.
-- Copies are public knowledge (the number is on the card); sessions are
-- counted across every copy, which is the question "is anyone training this?".
create or replace function public.program_usage(p_program uuid)
returns table (copies int, users int, sessions int, completed int)
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
      where (c.id = p_program or c.source_program_id = p_program) and s.completed_at is not null)
  where public.can_see_program(p_program);
$$;
grant execute on function public.program_usage(uuid) to authenticated;

-- The clients a coach has put this program on, for the coach's own desk. Named
-- people, so it is restricted to the coach who authored the source.
create or replace function public.program_assignees(p_program uuid)
returns table (program_id uuid, client_id uuid, client_name text, status text, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.id, c.client_id, coalesce(u.username, u.full_name), c.status::text, c.updated_at
  from public.programs c
  join public.users u on u.id = c.client_id
  where c.source_program_id = p_program
    and c.coach_id = auth.uid()
  order by c.updated_at desc;
$$;
grant execute on function public.program_assignees(uuid) to authenticated;

-- ---------- 6. sharing a program to the feed ----------
alter table public.social_posts drop constraint if exists social_posts_type_check;
alter table public.social_posts add constraint social_posts_type_check
  check (type in ('workout', 'pr', 'challenge_completed', 'progress', 'text', 'streak', 'program'));

-- The post carries a snapshot of the program, so editing the program later
-- never rewrites what was posted (the same rule every other post type follows).
-- program_id lives inside the payload rather than in a column: the post must
-- survive the program being deleted, exactly as a workout post survives its
-- session.
create unique index if not exists social_posts_one_per_program
  on public.social_posts (user_id, (payload ->> 'program_id'))
  where type = 'program' and deleted_at is null;
