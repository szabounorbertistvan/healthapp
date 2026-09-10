-- HealthApp schema · profile fields + per-set RIR
--
-- Two subjects, both from the September client feedback round.
--
-- 1. Who is signed in shows as a username, never an email. Sign-up now asks for
--    full name, username, sex and age, so `users` grows three columns. Username
--    is unique case-insensitively (Maria and maria are the same person). The
--    profile trigger reads the three new values from the sign-up metadata; a
--    Google sign-up cannot carry metadata, so the app sends those accounts to a
--    complete-your-profile step, which is why the columns stay nullable.
--
--    handle_new_user must never fail the sign-up: if the requested username is
--    already taken (a race between the availability check and the insert), the
--    row is created with a numbered variant and the person can change it later.
--
-- 2. A logged set carries both the reps left in the tank and how hard it felt.
--    `rpe` (1..10) is the felt intensity, the slider under the kg/reps boxes;
--    `rir` is what the client typed when the program is in RIR mode. Before
--    this the RIR box was converted into rpe on the way in and the two could
--    not be told apart. `notes` already exists and takes the per-set comment.

alter table public.users
  add column username text,
  add column sex text check (sex in ('male', 'female', 'other')),
  add column birth_year int check (birth_year between 1900 and 2100);

-- 3..24 chars, letters/digits/underscore/dot, must start with a letter or digit.
alter table public.users
  add constraint users_username_format
  check (username is null or username ~ '^[A-Za-z0-9][A-Za-z0-9_.]{2,23}$');

create unique index users_username_lower_idx on public.users (lower(username));

grant update (username, sex, birth_year) on table public.users to authenticated;

-- Availability check for the sign-up form. Security definer because users_select
-- only shows a person themselves and their coach/clients, so an anonymous or
-- freshly signed-up user could not otherwise tell whether a name is free.
-- Returns true when free (or malformed — the form validates format itself).
create or replace function public.username_available(p_username text)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (
    select 1 from public.users
    where lower(username) = lower(trim(p_username))
      and id is distinct from auth.uid()
  );
$$;
grant execute on function public.username_available(text) to anon, authenticated;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  requested text := new.raw_user_meta_data ->> 'role';
  wanted    text := nullif(trim(new.raw_user_meta_data ->> 'username'), '');
  chosen    text := wanted;
  sex_in    text := nullif(trim(new.raw_user_meta_data ->> 'sex'), '');
  year_in   int  := case when (new.raw_user_meta_data ->> 'birth_year') ~ '^[0-9]{4}$'
                         then (new.raw_user_meta_data ->> 'birth_year')::int end;
  attempt   int  := 0;
begin
  -- Anything that does not match the format is dropped rather than failing the
  -- sign-up; the complete-profile step asks again.
  if chosen is not null and chosen !~ '^[A-Za-z0-9][A-Za-z0-9_.]{2,23}$' then
    chosen := null;
  end if;
  while chosen is not null
    and exists (select 1 from public.users where lower(username) = lower(chosen))
  loop
    attempt := attempt + 1;
    chosen := left(wanted, 24 - length(attempt::text) - 1) || '_' || attempt;
    exit when attempt > 50;
  end loop;
  if sex_in not in ('male', 'female', 'other') then sex_in := null; end if;
  if year_in is not null and (year_in < 1900 or year_in > 2100) then year_in := null; end if;

  insert into public.users (id, full_name, avatar_url, role, username, sex, birth_year)
  values (new.id,
          coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), new.email),
          new.raw_user_meta_data ->> 'avatar_url',
          case when requested in ('coach', 'client')
               then requested::user_role
               else 'client'::user_role end,
          chosen,
          sex_in,
          year_in);
  return new;
end;
$$;

-- ---------- logged_sets.rir ----------
alter table public.logged_sets
  add column rir numeric(3,1) check (rir between 0 and 10);
comment on column public.logged_sets.rir is
  'Reps in reserve as typed by the client (RIR-mode programs). rpe is the felt intensity 1..10 from the slider; the two are recorded independently.';
