-- BuddyGym schema · 05 progress engine

create table public.measurements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  date date not null,
  weight_kg numeric(5,2) check (weight_kg between 20 and 400),
  circumferences jsonb not null default '{}', -- {"waist": 82.5, "chest": 104, ...} in cm
  created_at timestamptz not null default now(),
  unique (user_id, date)
);
create index measurements_user_idx on public.measurements (user_id, date desc);

create table public.check_ins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  week_start date not null, -- Monday of the ISO week
  weight_kg numeric(5,2),
  circumferences jsonb not null default '{}',
  sleep int check (sleep between 1 and 10),
  energy int check (energy between 1 and 10),
  stress int check (stress between 1 and 10),
  hunger int check (hunger between 1 and 10),
  recovery int check (recovery between 1 and 10),
  note text,
  submitted_at timestamptz not null default now(),
  coach_reviewed_at timestamptz,
  unique (user_id, week_start) -- one check-in per week (spec D2)
);
create index check_ins_user_idx on public.check_ins (user_id, week_start desc);

-- V1.1 feature; table ships now
create table public.progress_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  date date not null,
  pose text check (pose in ('front', 'side', 'back')),
  storage_path text not null,
  created_at timestamptz not null default now()
);
create index progress_photos_user_idx on public.progress_photos (user_id, date desc);

-- Weekly snapshots, computed server-side by compute_adherence_snapshots().
-- `inputs` stores everything that went into the numbers => every signal is explainable.
create table public.adherence_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  week_start date not null,
  workout_pct numeric(4,3) not null default 0,
  nutrition_pct numeric(4,3) not null default 0,
  habit_pct numeric(4,3) not null default 0,
  checkin_done boolean not null default false,
  overall_pct numeric(4,3) not null default 0,
  signal adherence_signal not null,
  reason text not null, -- plain-language "why" shown on the coach dashboard
  inputs jsonb not null default '{}',
  formula_version int not null default 1,
  computed_at timestamptz not null default now(),
  unique (user_id, week_start)
);
create index adherence_user_idx on public.adherence_snapshots (user_id, week_start desc);
