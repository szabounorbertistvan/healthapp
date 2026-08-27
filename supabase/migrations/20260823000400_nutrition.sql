-- HealthApp schema · 04 nutrition engine

-- Food cache + customs. External rows (source 'off') are written by the
-- food-search / barcode-lookup edge functions (service role) on first use, so
-- the local cache grows organically and searches get faster and cheaper.
create table public.foods (
  id uuid primary key default gen_random_uuid(),
  source food_source not null default 'custom',
  external_id text,          -- OFF product code
  barcode text,
  owner_id uuid references public.users (id) on delete cascade, -- set only for customs
  name_en text,
  name_ro text,
  brand text,
  kcal_100g numeric(7,2) not null check (kcal_100g >= 0),
  protein_100g numeric(6,2) not null default 0 check (protein_100g >= 0),
  carbs_100g numeric(6,2) not null default 0 check (carbs_100g >= 0),
  fat_100g numeric(6,2) not null default 0 check (fat_100g >= 0),
  verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id),
  check (name_en is not null or name_ro is not null),
  check (source <> 'custom' or owner_id is not null)
);
create trigger foods_updated before update on public.foods
  for each row execute function public.handle_updated_at();
create index foods_barcode_idx on public.foods (barcode);
create index foods_search_idx on public.foods using gin (to_tsvector('simple', coalesce(name_en, '') || ' ' || coalesce(name_ro, '') || ' ' || coalesce(brand, '')));
create index foods_owner_idx on public.foods (owner_id);

create table public.nutrition_plans (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid references public.users (id) on delete set null, -- null = solo client's own targets
  client_id uuid not null references public.users (id) on delete cascade,
  name text not null,
  kcal_target int not null check (kcal_target between 500 and 10000),
  protein_target_g int not null default 0,
  carbs_target_g int not null default 0,
  fat_target_g int not null default 0,
  status publish_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger nutrition_plans_updated before update on public.nutrition_plans
  for each row execute function public.handle_updated_at();
create index nutrition_plans_client_idx on public.nutrition_plans (client_id, status);

create table public.planned_meals (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.nutrition_plans (id) on delete cascade,
  day_index int not null default 0, -- 0 = every day, 1..7 = specific weekday plan
  slot meal_slot not null,
  name text not null,
  position int not null default 0
);
create index planned_meals_plan_idx on public.planned_meals (plan_id, day_index, position);

create table public.planned_meal_foods (
  id uuid primary key default gen_random_uuid(),
  planned_meal_id uuid not null references public.planned_meals (id) on delete cascade,
  food_id uuid not null references public.foods (id),
  grams numeric(7,1) not null check (grams > 0)
);
create index planned_meal_foods_meal_idx on public.planned_meal_foods (planned_meal_id);

-- Logged food. Macros are SNAPSHOTTED at log time (denormalized on purpose:
-- external food data can change; history must not).
create table public.food_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  date date not null,
  slot meal_slot not null,
  food_id uuid references public.foods (id) on delete set null,
  food_name text not null, -- snapshot, survives food deletion
  grams numeric(7,1) not null check (grams > 0),
  kcal numeric(7,1) not null,
  protein_g numeric(6,1) not null default 0,
  carbs_g numeric(6,1) not null default 0,
  fat_g numeric(6,1) not null default 0,
  method food_log_method not null default 'search',
  client_generated_id uuid not null unique,
  client_ts timestamptz,
  received_at timestamptz not null default now()
);
create index food_logs_user_date_idx on public.food_logs (user_id, date desc);
