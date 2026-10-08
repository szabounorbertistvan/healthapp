-- booking_timezone_valid() without reading the timezone database each time.
--
-- `pg_timezone_names` is not a table: every read walks the whole tz database
-- on disk, ~390 ms on the hosted project (measured 2026-10-08). The check runs
-- once per coach page for the availability summary and once per bookable
-- service inside booking_slots_internal(), so a coach with two bookable
-- services spent ~1.2 s of a ~1.5 s coach_public_profile() here — close enough
-- to the anon statement timeout that the public page 500'd under load.
--
-- The names are copied once into an indexed table. A name found there is
-- valid; a miss still falls back to the catalog, so the answer is exactly the
-- old one — only an unknown or null zone, which is rare, pays the slow path.
-- After a Postgres upgrade adds zones, `select public.refresh_timezone_names()`
-- copies them (until then those zones are merely slow, never wrong).

create table if not exists public.timezone_names (
  name text primary key
);
alter table public.timezone_names enable row level security;
revoke all on public.timezone_names from anon, authenticated;

create or replace function public.refresh_timezone_names()
returns int language sql security definer set search_path = public as $$
  with added as (
    insert into public.timezone_names (name)
    select name from pg_catalog.pg_timezone_names
    on conflict (name) do nothing
    returning 1
  )
  select count(*)::int from added;
$$;
revoke execute on function public.refresh_timezone_names() from public, anon, authenticated;

select public.refresh_timezone_names();

-- Security definer now, to read the locked table; grants unchanged.
create or replace function public.booking_timezone_valid(p_tz text)
returns boolean language sql stable security definer set search_path = public as $$
  select p_tz is not null
     and (exists (select 1 from public.timezone_names where name = p_tz)
          or exists (select 1 from pg_catalog.pg_timezone_names where name = p_tz));
$$;
revoke execute on function public.booking_timezone_valid(text) from public, anon;
grant execute on function public.booking_timezone_valid(text) to authenticated;
