-- BuddyGym schema · 07 engagement: habits, streaks, badges, notifications

create table public.habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  created_by uuid not null references public.users (id) on delete cascade, -- self or coach
  name text not null,
  weekdays int[] not null default '{0,1,2,3,4,5,6}', -- 0=Sun
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger habits_updated before update on public.habits
  for each row execute function public.handle_updated_at();
create index habits_user_idx on public.habits (user_id) where active;

create table public.habit_logs (
  id uuid primary key default gen_random_uuid(),
  habit_id uuid not null references public.habits (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade, -- denormalized for RLS
  date date not null,
  client_generated_id uuid not null unique,
  received_at timestamptz not null default now(),
  unique (habit_id, date)
);
create index habit_logs_user_idx on public.habit_logs (user_id, date desc);

-- server-computed (daily job), never trusted from the client
create table public.streaks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  type text not null check (type in ('workout', 'nutrition', 'habits', 'overall')),
  current int not null default 0,
  best int not null default 0,
  last_activity_date date,
  updated_at timestamptz not null default now(),
  unique (user_id, type)
);

create table public.badges (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name_en text not null,
  name_ro text not null,
  description_en text,
  description_ro text,
  icon text,
  sort int not null default 0
);

create table public.user_badges (
  user_id uuid not null references public.users (id) on delete cascade,
  badge_id uuid not null references public.badges (id) on delete cascade,
  awarded_at timestamptz not null default now(),
  primary key (user_id, badge_id)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  category notification_category not null,
  title text not null,
  body text,
  payload jsonb not null default '{}', -- deep-link target etc.
  created_at timestamptz not null default now(),
  sent_at timestamptz,   -- set by push-dispatch after APNs/FCM delivery
  read_at timestamptz
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unsent_idx on public.notifications (created_at) where sent_at is null;

-- MVP badge catalog seed
insert into public.badges (slug, name_en, name_ro, sort) values
  ('first-workout',   'First workout',    'Primul antrenament', 1),
  ('workouts-10',     '10 workouts',      '10 antrenamente',    2),
  ('workouts-50',     '50 workouts',      '50 de antrenamente', 3),
  ('streak-7',        '7-day streak',     'Serie de 7 zile',    4),
  ('streak-30',       '30-day streak',    'Serie de 30 de zile',5),
  ('first-checkin',   'First check-in',   'Primul check-in',    6),
  ('first-pr',        'First PR',         'Primul record',      7),
  ('nutrition-week',  'Full week logged', 'O săptămână logată', 8);
