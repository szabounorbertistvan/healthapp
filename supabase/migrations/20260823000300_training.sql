-- HealthApp schema · 03 training engine

-- Exercise library. System rows come from Free Exercise DB (public domain,
-- https://github.com/yuhonas/free-exercise-db) via the import-exercises edge
-- function: owner_id null, source 'free-exercise-db'. Coach customs: owner_id set.
create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.users (id) on delete cascade, -- null = system library
  source text not null default 'custom' check (source in ('free-exercise-db', 'custom')),
  external_id text, -- Free Exercise DB id, for idempotent re-imports
  name_en text not null,
  name_ro text,
  category text,          -- strength / stretching / cardio / ...
  level text,             -- beginner / intermediate / expert
  force text,             -- push / pull / static
  mechanic text,          -- compound / isolation
  equipment text,
  primary_muscles text[] not null default '{}',
  secondary_muscles text[] not null default '{}',
  instructions_en text,
  instructions_ro text,
  video_url text,
  images text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id)
);
create trigger exercises_updated before update on public.exercises
  for each row execute function public.handle_updated_at();
create index exercises_name_idx on public.exercises using gin (to_tsvector('simple', name_en || ' ' || coalesce(name_ro, '')));
create index exercises_owner_idx on public.exercises (owner_id);

-- Programs. Coach-built: coach_id set, client_id = assignee.
-- Solo-client routines: coach_id null, client_id = owner.
create table public.programs (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid references public.users (id) on delete set null,
  client_id uuid not null references public.users (id) on delete cascade,
  name text not null,
  notes text,
  status publish_status not null default 'draft',
  intensity_mode intensity_mode not null default 'rir', -- coach chooses per client (open decision, default per plan)
  weeks int not null default 1 check (weeks between 1 and 52),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger programs_updated before update on public.programs
  for each row execute function public.handle_updated_at();
create index programs_client_idx on public.programs (client_id, status);
create index programs_coach_idx on public.programs (coach_id);

create table public.program_days (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs (id) on delete cascade,
  week_index int not null default 1,
  day_index int not null, -- 0=Sun .. 6=Sat, or ordinal within week
  name text not null,
  unique (program_id, week_index, day_index)
);
create index program_days_program_idx on public.program_days (program_id);

create table public.program_exercises (
  id uuid primary key default gen_random_uuid(),
  program_day_id uuid not null references public.program_days (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id),
  position int not null default 0,
  target_sets int not null check (target_sets between 1 and 20),
  target_reps text not null, -- "8" or a range "8-10"
  target_weight_kg numeric(6,2),
  target_rpe numeric(3,1) check (target_rpe between 1 and 10),
  rest_seconds int check (rest_seconds between 0 and 600),
  notes text
);
create index program_exercises_day_idx on public.program_exercises (program_day_id, position);

-- Logged workouts. client_generated_id = offline idempotency key (outbox pattern).
create table public.logged_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  program_day_id uuid references public.program_days (id) on delete set null, -- null = ad-hoc session
  client_generated_id uuid not null unique,
  started_at timestamptz not null,
  completed_at timestamptz,
  notes text,
  received_at timestamptz not null default now() -- server-authoritative (clock-skew rule)
);
create index logged_sessions_user_idx on public.logged_sessions (user_id, started_at desc);

create table public.logged_sets (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.logged_sessions (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade, -- denormalized for fast RLS
  program_exercise_id uuid references public.program_exercises (id) on delete set null,
  exercise_id uuid not null references public.exercises (id),
  client_generated_id uuid not null unique,
  set_index int not null,
  reps int not null check (reps between 0 and 200),
  weight_kg numeric(6,2),
  rpe numeric(3,1) check (rpe between 1 and 10),
  effort simple_effort,
  is_pr boolean not null default false,
  notes text,
  client_ts timestamptz,
  received_at timestamptz not null default now()
);
create index logged_sets_session_idx on public.logged_sets (session_id, set_index);
create index logged_sets_history_idx on public.logged_sets (user_id, exercise_id, received_at desc);

-- coach video overrides system video (rule from the doc)
create table public.exercise_videos (
  id uuid primary key default gen_random_uuid(),
  exercise_id uuid not null references public.exercises (id) on delete cascade,
  owner_id uuid references public.users (id) on delete cascade, -- null = system
  storage_path text not null,
  created_at timestamptz not null default now()
);
create index exercise_videos_ex_idx on public.exercise_videos (exercise_id);

-- V1.1 feature; table ships now so media pipeline lands early
create table public.set_videos (
  id uuid primary key default gen_random_uuid(),
  logged_set_id uuid not null references public.logged_sets (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  storage_path text not null,
  review_status text not null default 'pending' check (review_status in ('pending', 'reviewed')),
  created_at timestamptz not null default now()
);

-- append-only telemetry
create table public.workout_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.users (id) on delete cascade,
  session_id uuid references public.logged_sessions (id) on delete cascade,
  event text not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index workout_events_user_idx on public.workout_events (user_id, created_at desc);
