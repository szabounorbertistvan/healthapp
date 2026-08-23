-- BuddyGym schema · 02 core: users, trainer_clients, goals

create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  role user_role not null default 'client',
  full_name text,
  avatar_url text,
  locale text not null default 'ro' check (locale in ('ro', 'en')),
  weight_unit text not null default 'kg' check (weight_unit in ('kg', 'lb')),
  length_unit text not null default 'cm' check (length_unit in ('cm', 'in')),
  timezone text not null default 'Europe/Bucharest',
  check_in_weekday int not null default 1 check (check_in_weekday between 0 and 6), -- 0=Sun
  notification_prefs jsonb not null default '{}',
  push_token text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger users_updated before update on public.users
  for each row execute function public.handle_updated_at();

-- auto-create profile row on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, full_name, avatar_url)
  values (new.id,
          coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
          new.raw_user_meta_data ->> 'avatar_url');
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- coach<->client relationship. client_id is null while the invite is unclaimed.
create table public.trainer_clients (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.users (id) on delete cascade,
  client_id uuid references public.users (id) on delete cascade,
  status relationship_status not null default 'invited',
  invite_code text unique,
  invite_expires_at timestamptz,
  invited_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (coach_id <> client_id)
);
create trigger trainer_clients_updated before update on public.trainer_clients
  for each row execute function public.handle_updated_at();

-- decision from the source doc: exactly ONE active coach per client (history preserved)
create unique index one_active_coach_per_client
  on public.trainer_clients (client_id) where (status = 'active');
create index trainer_clients_coach_idx on public.trainer_clients (coach_id, status);

-- single point of truth for every coach-access RLS policy
create or replace function public.is_active_coach_of(p_client uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.trainer_clients
    where coach_id = auth.uid() and client_id = p_client and status = 'active'
  );
$$;

-- either direction of an active relationship (client may see their coach's profile)
create or replace function public.is_connected_to(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.trainer_clients
    where status = 'active'
      and ((coach_id = auth.uid() and client_id = p_user)
        or (client_id = auth.uid() and coach_id = p_user))
  );
$$;

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  type text not null check (type in ('weight', 'strength', 'habit', 'other')),
  title text not null,
  target_value numeric,
  target_date date,
  status text not null default 'active' check (status in ('active', 'achieved', 'abandoned')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger goals_updated before update on public.goals
  for each row execute function public.handle_updated_at();
create index goals_user_idx on public.goals (user_id);
