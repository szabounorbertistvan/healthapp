-- HealthApp schema · admin flags describe the content an admin looked at
--
-- 20260930100000 made featured_at / is_official admin-only to SET, but not to
-- KEEP: a routine an admin marked "By Voinic" kept the mark through a trip to
-- private and back, and through any edit its owner made afterwards. So an
-- owner could get a good routine marked, then replace its content and carry
-- the badge (and the Featured shelf) over to something nobody reviewed.
-- Found by the push security review.
--
-- The rule now: both flags are an admin's judgement of ONE version. A change
-- by a signed-in non-admin clears them —
--   · the routine leaving public (was: featured only);
--   · any change to the program's own content columns;
--   · inserting, updating or deleting one of its days or prescribed exercises.
-- Not content, so kept: saves, copy_count (bumped by copy_program), the flags
-- themselves. An admin's edits keep the flags; so do writes with no signed-in
-- user (service role, migrations).
--
-- The day/exercise triggers are security definer because owners have no
-- column grant on the flags (20260930100000); the function writes only those
-- two columns, only on the one parent program, and only to clear them.

create or replace function public.programs_drop_feature_when_hidden()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.visibility <> 'public' then
    new.featured_at := null;
    new.is_official := false;
  end if;
  return new;
end;
$$;

-- Program-level content edits by a non-admin.
create or replace function public.programs_drop_flags_on_edit()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin()
     and (new.name, new.notes, new.weeks, new.intensity_mode, new.description, new.level, new.goal, new.training_style)
         is distinct from
         (old.name, old.notes, old.weeks, old.intensity_mode, old.description, old.level, old.goal, old.training_style)
  then
    new.featured_at := null;
    new.is_official := false;
  end if;
  return new;
end;
$$;
drop trigger if exists programs_drop_flags_on_edit on public.programs;
create trigger programs_drop_flags_on_edit before update on public.programs
  for each row execute function public.programs_drop_flags_on_edit();

-- Day / prescription edits by a non-admin clear the parent's flags.
create or replace function public.program_clear_flags(p_program uuid)
returns void language sql security definer set search_path = public as $$
  update public.programs
     set featured_at = null, is_official = false
   where id = p_program
     and (featured_at is not null or is_official);
$$;
revoke execute on function public.program_clear_flags(uuid) from public, anon, authenticated;

create or replace function public.program_days_drop_flags()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    perform public.program_clear_flags(coalesce(new.program_id, old.program_id));
  end if;
  return null;
end;
$$;
drop trigger if exists program_days_drop_flags on public.program_days;
create trigger program_days_drop_flags after insert or update or delete on public.program_days
  for each row execute function public.program_days_drop_flags();

create or replace function public.program_exercises_drop_flags()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_program uuid;
begin
  if auth.uid() is not null and not public.is_admin() then
    select d.program_id into v_program
      from public.program_days d
     where d.id = coalesce(new.program_day_id, old.program_day_id);
    if v_program is not null then
      perform public.program_clear_flags(v_program);
    end if;
  end if;
  return null;
end;
$$;
drop trigger if exists program_exercises_drop_flags on public.program_exercises;
create trigger program_exercises_drop_flags after insert or update or delete on public.program_exercises
  for each row execute function public.program_exercises_drop_flags();
