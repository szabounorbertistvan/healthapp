-- HealthApp schema · Coach Discovery foundation
--
-- Voinic stops being only "a coach manages the clients they already have" and
-- becomes a place where people find a coach. This migration is the database
-- half of that: the professional profile, its reference data, verification,
-- moderation and the coaching request. No UI, no search RPC, no payments yet.
--
-- The principle that does NOT change: nothing in this database is public.
-- users_select shows a person only themselves and their coach / clients, and
-- until now no profile function was granted to `anon`. Coach Discovery needs
-- the first anonymous read (a coach page Google can index), so:
--
--   * every coach_* table has RLS with owner / admin policies only — no anon
--     policy, and `anon` loses every table privilege on them;
--   * the one anonymous door is coach_public_profile(slug), a security
--     definer function that returns a fixed list of public fields of a
--     *published* profile and nothing else. search_coaches() will be the
--     second door, once the schema has settled.
--
-- 1. Reference data, editable by an admin, readable by anyone signed in:
--    countries, cities (slug + lat/lng, for /coaches/cluj-napoca and distance
--    later — no geocoding), languages, specializations. users.city stays as it
--    is: the social profile and people search read it; discovery has its own
--    relations.
--
-- 2. coach_profiles, 1:1 with users. Professional data does not go into
--    `users`: that table must stay private, and a single wrong policy on a
--    mixed table would expose health data. The public name is never
--    users.full_name as such — handle_new_user() fills it with the e-mail
--    address when sign-up had no name — but public_display_name(): username,
--    else a full_name without "@", else a fixed fallback.
--
-- 3. Lifecycle (pre-moderation, decided 2026-10-01):
--        draft ──submit──▶ pending_review ──admin──▶ published
--          ▲                    │  (reject, with a note) │
--          └──── withdraw ──────┴────────────────────────┘
--        any ──admin──▶ suspended ──admin──▶ published | draft
--    The coach can never write `status`; only submit_coach_for_review(),
--    withdraw_coach_profile() and admin_set_coach_profile_status() do.
--    Content is editable only in `draft`: what an admin approved is what is
--    public. accepting_clients is the exception — an operational switch, not
--    content.
--
-- 4. Verification is not one flag: one row per (profile, kind) in
--    coach_verifications, kinds identity / certification / business, each
--    pending / verified / rejected / revoked, written only by an admin. A
--    badge is a `verified` row. Certifications carry their own status and a
--    private document_ref that no API role can read.
--
-- 5. coaching_requests: client → coach (→ optional service) with a message.
--    pending → declined (coach) | cancelled (client). `accepted` is in the
--    model, but its RPC is not here yet: what happens to a client who already
--    has an active coach (one_active_coach_per_client) is still an open
--    product decision. payment_id / booking_id are placeholders without
--    foreign keys — the tables they will point at do not exist.
--
-- 6. Search foundation: coach_profiles.search_text (search_normalize(): lower
--    + unaccent, the same as foods) rebuilt by triggers from the name,
--    headline, about, specializations, cities and services, plus a generated
--    `simple` tsvector, with a trigram and a GIN index. rank_score is a column
--    for the future recommender; nothing writes it yet.

-- ============================================================================
-- 0. helpers
-- ============================================================================

-- The public name. Immutable on purpose: it only looks at its arguments.
create or replace function public.public_display_name(p_username text, p_full_name text)
returns text language sql immutable parallel safe as $$
  select coalesce(
    nullif(btrim(p_username), ''),
    case when position('@' in coalesce(p_full_name, '')) = 0 then nullif(btrim(p_full_name), '') end,
    'Voinic coach'
  );
$$;
comment on function public.public_display_name(text, text) is
  'Username, else a full_name that is not an e-mail address, else a fixed fallback. The only name a public surface may show.';

-- ============================================================================
-- 1. reference data
-- ============================================================================

create table public.countries (
  code text primary key check (code ~ '^[A-Z]{2}$'),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name_en text not null check (char_length(name_en) between 1 and 80),
  name_ro text not null check (char_length(name_ro) between 1 and 80),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.cities (
  id uuid primary key default gen_random_uuid(),
  country_code text not null references public.countries (code),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 60),
  -- the name as written locally ("București"); name_en only where English differs
  name text not null check (char_length(name) between 1 and 80),
  name_en text check (name_en is null or char_length(name_en) between 1 and 80),
  latitude  numeric(9, 6) check (latitude  is null or latitude  between -90  and 90),
  longitude numeric(9, 6) check (longitude is null or longitude between -180 and 180),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((latitude is null) = (longitude is null))
);
create trigger cities_updated before update on public.cities
  for each row execute function public.handle_updated_at();
create index cities_country_idx on public.cities (country_code);

create table public.languages (
  -- ISO 639-1 (639-3 where there is no two-letter code)
  code text primary key check (code ~ '^[a-z]{2,3}$'),
  name_en text not null check (char_length(name_en) between 1 and 60),
  name_ro text not null check (char_length(name_ro) between 1 and 60),
  native_name text not null check (char_length(native_name) between 1 and 60),
  sort_order int not null default 100,
  active boolean not null default true
);

create table public.specializations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 60),
  name_en text not null check (char_length(name_en) between 1 and 80),
  name_ro text not null check (char_length(name_ro) between 1 and 80),
  sort_order int not null default 100,
  -- retire instead of delete: coach_specializations references it
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger specializations_updated before update on public.specializations
  for each row execute function public.handle_updated_at();

insert into public.countries (code, slug, name_en, name_ro) values
  ('RO', 'romania', 'Romania', 'România'),
  ('MD', 'moldova', 'Moldova', 'Republica Moldova');

insert into public.cities (country_code, slug, name, name_en, latitude, longitude) values
  ('RO', 'bucharest',      'București',      'Bucharest', 44.426800, 26.102500),
  ('RO', 'cluj-napoca',    'Cluj-Napoca',    null,        46.771200, 23.623600),
  ('RO', 'timisoara',      'Timișoara',      null,        45.748900, 21.208700),
  ('RO', 'iasi',           'Iași',           null,        47.158500, 27.601400),
  ('RO', 'constanta',      'Constanța',      null,        44.159800, 28.634800),
  ('RO', 'craiova',        'Craiova',        null,        44.330200, 23.794900),
  ('RO', 'brasov',         'Brașov',         null,        45.642700, 25.588700),
  ('RO', 'galati',         'Galați',         null,        45.435300, 28.008000),
  ('RO', 'ploiesti',       'Ploiești',       null,        44.936500, 26.012800),
  ('RO', 'oradea',         'Oradea',         null,        47.046500, 21.918900),
  ('RO', 'braila',         'Brăila',         null,        45.269200, 27.957500),
  ('RO', 'arad',           'Arad',           null,        46.186600, 21.312300),
  ('RO', 'pitesti',        'Pitești',        null,        44.856500, 24.869200),
  ('RO', 'sibiu',          'Sibiu',          null,        45.798300, 24.125600),
  ('RO', 'bacau',          'Bacău',          null,        46.567000, 26.914600),
  ('RO', 'targu-mures',    'Târgu Mureș',    null,        46.542500, 24.557500),
  ('RO', 'baia-mare',      'Baia Mare',      null,        47.656700, 23.585000),
  ('RO', 'buzau',          'Buzău',          null,        45.150000, 26.833300),
  ('RO', 'botosani',       'Botoșani',       null,        47.748600, 26.669400),
  ('RO', 'satu-mare',      'Satu Mare',      null,        47.790000, 22.885700),
  ('RO', 'suceava',        'Suceava',        null,        47.651400, 26.255600),
  ('MD', 'chisinau',       'Chișinău',       null,        47.010500, 28.863800);

insert into public.languages (code, name_en, name_ro, native_name, sort_order) values
  ('ro', 'Romanian',  'Română',    'Română',     10),
  ('en', 'English',   'Engleză',   'English',    20),
  ('hu', 'Hungarian', 'Maghiară',  'Magyar',     30),
  ('de', 'German',    'Germană',   'Deutsch',    40),
  ('fr', 'French',    'Franceză',  'Français',   50),
  ('it', 'Italian',   'Italiană',  'Italiano',   60),
  ('es', 'Spanish',   'Spaniolă',  'Español',    70),
  ('ru', 'Russian',   'Rusă',      'Русский',    80),
  ('uk', 'Ukrainian', 'Ucraineană','Українська', 90);

insert into public.specializations (slug, name_en, name_ro, sort_order) values
  ('weight-loss',         'Weight Loss',         'Slăbire',                10),
  ('muscle-building',     'Muscle Building',     'Creștere musculară',     20),
  ('hypertrophy',         'Hypertrophy',         'Hipertrofie',            30),
  ('strength',            'Strength',            'Forță',                  40),
  ('powerlifting',        'Powerlifting',        'Powerlifting',           50),
  ('bodybuilding',        'Bodybuilding',        'Culturism',              60),
  ('functional-training', 'Functional Training', 'Antrenament funcțional', 70),
  ('mobility',            'Mobility',            'Mobilitate',             80),
  ('sports-performance',  'Sports Performance',  'Performanță sportivă',   90),
  ('nutrition',           'Nutrition',           'Nutriție',              100),
  ('beginners',           'Beginners',           'Începători',            110);

-- Readable by anyone signed in (it is a catalog, not anyone's data); written
-- by an admin only. Anonymous pages get these names through the public RPCs.
alter table public.countries       enable row level security;
alter table public.cities          enable row level security;
alter table public.languages       enable row level security;
alter table public.specializations enable row level security;

create policy countries_read on public.countries for select to authenticated using (true);
create policy countries_admin on public.countries for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy cities_read on public.cities for select to authenticated using (true);
create policy cities_admin on public.cities for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy languages_read on public.languages for select to authenticated using (true);
create policy languages_admin on public.languages for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy specializations_read on public.specializations for select to authenticated using (true);
create policy specializations_admin on public.specializations for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

revoke all on table public.countries, public.cities, public.languages, public.specializations from anon;
grant select, insert, update, delete on table
  public.countries, public.cities, public.languages, public.specializations to authenticated;

-- ============================================================================
-- 2. coach_profiles
-- ============================================================================

create table public.coach_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users (id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 60),
  headline text check (headline is null or char_length(headline) <= 120),
  about text check (about is null or char_length(about) <= 3000),
  -- a Cloudinary delivery URL built by the server action, never a URL the browser chose
  cover_url text check (cover_url is null or (cover_url like 'https://res.cloudinary.com/%' and char_length(cover_url) <= 500)),
  -- the year coaching started: "years of experience" would go stale on its own
  coaching_since int check (coaching_since is null or coaching_since between 1950 and 2100),
  accepting_clients boolean not null default true,
  online boolean not null default false,
  in_person boolean not null default false,
  status text not null default 'draft'
    check (status in ('draft', 'pending_review', 'published', 'suspended')),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references public.users (id) on delete set null,
  -- why an admin sent it back to draft; the coach reads it, the public never does
  review_note text check (review_note is null or char_length(review_note) <= 1000),
  published_at timestamptz,
  suspended_at timestamptz,
  suspension_reason text check (suspension_reason is null or char_length(suspension_reason) <= 1000),
  -- for the future recommender; nothing writes it yet
  rank_score real not null default 0,
  -- rebuilt by coach_profiles_search_text(); see section 7
  search_text text not null default '',
  search_doc tsvector generated always as (to_tsvector('simple'::regconfig, search_text)) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'suspended') = (suspended_at is not null))
);
create trigger coach_profiles_updated before update on public.coach_profiles
  for each row execute function public.handle_updated_at();

create unique index coach_profiles_slug_idx on public.coach_profiles (slug);
create index coach_profiles_status_idx on public.coach_profiles (status);
-- the discovery filters only ever look at published profiles
create index coach_profiles_discovery_idx on public.coach_profiles (accepting_clients, online, in_person)
  where status = 'published';
create index coach_profiles_published_idx on public.coach_profiles (published_at desc)
  where status = 'published';
create index coach_profiles_search_doc_idx on public.coach_profiles using gin (search_doc);
create index coach_profiles_search_trgm_idx on public.coach_profiles
  using gin (search_text extensions.gin_trgm_ops);

comment on table public.coach_profiles is
  'A coach''s public professional profile, 1:1 with users. Never readable by anon directly: public reads go through coach_public_profile().';

-- ---------- slugs ----------
-- /coaches/<x> will resolve a coach, a city, a country or a specialization, so
-- they share one namespace. Words the router will need are reserved too.
create or replace function public.coach_slug_reserved(p_slug text)
returns boolean language sql stable security definer set search_path = public as $$
  select p_slug = any (array[
           'online', 'in-person', 'near-me', 'search', 'new', 'edit', 'top', 'all',
           'apply', 'become-a-coach', 'city', 'cities', 'country', 'countries',
           'specialization', 'specializations', 'services', 'verified'])
      or exists (select 1 from public.cities c where c.slug = p_slug)
      or exists (select 1 from public.countries c where c.slug = p_slug)
      or exists (select 1 from public.specializations s where s.slug = p_slug);
$$;

-- A slug from a username: lower case, anything else becomes one dash.
create or replace function public.coach_slug_base(p_username text)
returns text language plpgsql immutable as $$
declare
  v text := btrim(regexp_replace(lower(coalesce(p_username, '')), '[^a-z0-9]+', '-', 'g'), '-');
begin
  if char_length(v) < 3 then
    v := btrim('coach-' || v, '-');
  end if;
  return btrim(left(v, 50), '-');
end;
$$;

create or replace function public.coach_profiles_check_slug()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.slug is distinct from old.slug then
    if public.coach_slug_reserved(new.slug) then
      raise exception 'SLUG_RESERVED' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;
create trigger coach_profiles_check_slug before insert or update of slug on public.coach_profiles
  for each row execute function public.coach_profiles_check_slug();

-- And the other direction: a new city / specialization / country cannot take
-- a slug a coach already has.
create or replace function public.discovery_slug_not_a_coach()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.coach_profiles where slug = new.slug) then
    raise exception 'SLUG_TAKEN_BY_COACH' using errcode = '23505';
  end if;
  return new;
end;
$$;
create trigger cities_slug_not_a_coach before insert or update of slug on public.cities
  for each row execute function public.discovery_slug_not_a_coach();
create trigger countries_slug_not_a_coach before insert or update of slug on public.countries
  for each row execute function public.discovery_slug_not_a_coach();
create trigger specializations_slug_not_a_coach before insert or update of slug on public.specializations
  for each row execute function public.discovery_slug_not_a_coach();

-- ---------- edit lock ----------
-- Through the API (current_user = authenticated) content changes only while
-- the profile is a draft. The RPCs below run as the owner and are exempt —
-- they only ever move status columns. Same current_user test as
-- admin_audit_events_immutable().
create or replace function public.coach_profiles_edit_lock()
returns trigger language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon')
     and old.status <> 'draft'
     and (new.slug, new.headline, new.about, new.cover_url, new.coaching_since, new.online, new.in_person)
         is distinct from
         (old.slug, old.headline, old.about, old.cover_url, old.coaching_since, old.online, old.in_person)
  then
    raise exception 'PROFILE_LOCKED' using errcode = '55000';
  end if;
  return new;
end;
$$;
create trigger coach_profiles_edit_lock before update on public.coach_profiles
  for each row execute function public.coach_profiles_edit_lock();

-- ---------- ownership helpers (used by the policies below) ----------
create or replace function public.coach_profile_owned(p_profile uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.coach_profiles where id = p_profile and user_id = auth.uid());
$$;
create or replace function public.coach_profile_editable(p_profile uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.coach_profiles
                 where id = p_profile and user_id = auth.uid() and status = 'draft');
$$;

alter table public.coach_profiles enable row level security;
create policy coach_profiles_owner_read on public.coach_profiles for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy coach_profiles_owner_update on public.coach_profiles for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Created only by become_coach(), status only by the lifecycle RPCs, never
-- deleted through the API (the user row's cascade removes it).
revoke all on table public.coach_profiles from anon;
revoke insert, update, delete on table public.coach_profiles from authenticated;
grant select on table public.coach_profiles to authenticated;
grant update (slug, headline, about, cover_url, coaching_since, accepting_clients, online, in_person)
  on table public.coach_profiles to authenticated;

-- ============================================================================
-- 3. what a coach offers: specializations, languages, locations, services
-- ============================================================================

create table public.coach_specializations (
  coach_profile_id uuid not null references public.coach_profiles (id) on delete cascade,
  specialization_id uuid not null references public.specializations (id) on delete restrict,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (coach_profile_id, specialization_id)
);
create index coach_specializations_spec_idx on public.coach_specializations (specialization_id);
create unique index coach_specializations_one_primary on public.coach_specializations (coach_profile_id)
  where is_primary;

create table public.coach_languages (
  coach_profile_id uuid not null references public.coach_profiles (id) on delete cascade,
  language_code text not null references public.languages (code) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (coach_profile_id, language_code)
);
create index coach_languages_language_idx on public.coach_languages (language_code);

create table public.coach_locations (
  id uuid primary key default gen_random_uuid(),
  coach_profile_id uuid not null references public.coach_profiles (id) on delete cascade,
  city_id uuid not null references public.cities (id) on delete restrict,
  -- where in that city, as public as the profile: a gym, never a home address
  gym_name text check (gym_name is null or char_length(gym_name) between 1 and 120),
  created_at timestamptz not null default now(),
  unique (coach_profile_id, city_id)
);
create index coach_locations_city_idx on public.coach_locations (city_id);

create table public.coach_services (
  id uuid primary key default gen_random_uuid(),
  coach_profile_id uuid not null references public.coach_profiles (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  description text check (description is null or char_length(description) <= 1000),
  -- text + check, not an enum, so a new kind (booking slots, …) is one constraint swap
  kind text not null default 'online_coaching'
    check (kind in ('online_coaching', 'personal_training', 'nutrition_coaching',
                    'group_coaching', 'consultation', 'other')),
  -- minor units (bani / cents); null = price on request
  price_cents int check (price_cents is null or price_cents between 0 and 100000000),
  currency text not null default 'RON' check (currency ~ '^[A-Z]{3}$'),
  price_unit text not null default 'month'
    check (price_unit in ('session', 'month', 'package', 'custom')),
  -- false: the price is shown only after contact, never on the public page
  price_public boolean not null default true,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger coach_services_updated before update on public.coach_services
  for each row execute function public.handle_updated_at();
create index coach_services_profile_idx on public.coach_services (coach_profile_id, sort_order);

alter table public.coach_specializations enable row level security;
alter table public.coach_languages       enable row level security;
alter table public.coach_locations       enable row level security;
alter table public.coach_services        enable row level security;

create policy coach_specializations_read on public.coach_specializations for select to authenticated
  using (public.coach_profile_owned(coach_profile_id) or public.is_admin());
create policy coach_languages_read on public.coach_languages for select to authenticated
  using (public.coach_profile_owned(coach_profile_id) or public.is_admin());
create policy coach_locations_read on public.coach_locations for select to authenticated
  using (public.coach_profile_owned(coach_profile_id) or public.is_admin());

create policy coach_services_read on public.coach_services for select to authenticated
  using (public.coach_profile_owned(coach_profile_id) or public.is_admin());
create policy coach_services_insert on public.coach_services for insert to authenticated
  with check (public.coach_profile_editable(coach_profile_id));
create policy coach_services_update on public.coach_services for update to authenticated
  using (public.coach_profile_editable(coach_profile_id))
  with check (public.coach_profile_editable(coach_profile_id));
create policy coach_services_delete on public.coach_services for delete to authenticated
  using (public.coach_profile_editable(coach_profile_id));

revoke all on table public.coach_specializations, public.coach_languages,
                    public.coach_locations, public.coach_services from anon;
-- the three sets are replaced whole by coach_set_*(); services are rows the coach edits
revoke insert, update, delete on table public.coach_specializations, public.coach_languages,
                                       public.coach_locations from authenticated;
grant select on table public.coach_specializations, public.coach_languages,
                      public.coach_locations, public.coach_services to authenticated;
revoke insert, update on table public.coach_services from authenticated;
grant insert (coach_profile_id, name, description, kind, price_cents, currency, price_unit,
              price_public, active, sort_order) on table public.coach_services to authenticated;
grant update (name, description, kind, price_cents, currency, price_unit, price_public,
              active, sort_order) on table public.coach_services to authenticated;
grant delete on table public.coach_services to authenticated;

-- ============================================================================
-- 4. certifications and verification
-- ============================================================================

create table public.coach_certifications (
  id uuid primary key default gen_random_uuid(),
  coach_profile_id uuid not null references public.coach_profiles (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  issuer text check (issuer is null or char_length(issuer) between 1 and 120),
  year int check (year is null or year between 1950 and 2100),
  verification_status text not null default 'unverified'
    check (verification_status in ('unverified', 'pending', 'verified', 'rejected')),
  -- where the proof lives once uploads exist. No API role can read it.
  document_ref text check (document_ref is null or char_length(document_ref) <= 500),
  verified_at timestamptz,
  verified_by uuid references public.users (id) on delete set null,
  admin_note text check (admin_note is null or char_length(admin_note) <= 1000),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger coach_certifications_updated before update on public.coach_certifications
  for each row execute function public.handle_updated_at();
create index coach_certifications_profile_idx on public.coach_certifications (coach_profile_id, sort_order);

-- Renaming a verified certificate is a different certificate.
create or replace function public.coach_certifications_reset_verification()
returns trigger language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon')
     and (new.name, new.issuer, new.year) is distinct from (old.name, old.issuer, old.year) then
    new.verification_status := 'unverified';
    new.verified_at := null;
    new.verified_by := null;
  end if;
  return new;
end;
$$;
create trigger coach_certifications_reset_verification before update on public.coach_certifications
  for each row execute function public.coach_certifications_reset_verification();

create table public.coach_verifications (
  id uuid primary key default gen_random_uuid(),
  coach_profile_id uuid not null references public.coach_profiles (id) on delete cascade,
  kind text not null check (kind in ('identity', 'certification', 'business')),
  status text not null default 'pending'
    check (status in ('pending', 'verified', 'rejected', 'revoked')),
  document_ref text check (document_ref is null or char_length(document_ref) <= 500),
  admin_note text check (admin_note is null or char_length(admin_note) <= 1000),
  verified_at timestamptz,
  verified_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (coach_profile_id, kind)
);
create trigger coach_verifications_updated before update on public.coach_verifications
  for each row execute function public.handle_updated_at();

alter table public.coach_certifications enable row level security;
alter table public.coach_verifications  enable row level security;

create policy coach_certifications_read on public.coach_certifications for select to authenticated
  using (public.coach_profile_owned(coach_profile_id) or public.is_admin());
create policy coach_certifications_insert on public.coach_certifications for insert to authenticated
  with check (public.coach_profile_editable(coach_profile_id));
create policy coach_certifications_update on public.coach_certifications for update to authenticated
  using (public.coach_profile_editable(coach_profile_id))
  with check (public.coach_profile_editable(coach_profile_id));
create policy coach_certifications_delete on public.coach_certifications for delete to authenticated
  using (public.coach_profile_editable(coach_profile_id));
create policy coach_verifications_read on public.coach_verifications for select to authenticated
  using (public.coach_profile_owned(coach_profile_id) or public.is_admin());

-- Column grants: document_ref and admin_note are not readable by any API role
-- (admins read them through admin RPCs); verification columns are not writable.
revoke all on table public.coach_certifications, public.coach_verifications from anon;
revoke all on table public.coach_certifications, public.coach_verifications from authenticated;
grant select (id, coach_profile_id, name, issuer, year, verification_status, verified_at,
              sort_order, created_at, updated_at) on table public.coach_certifications to authenticated;
grant insert (coach_profile_id, name, issuer, year, sort_order) on table public.coach_certifications to authenticated;
grant update (name, issuer, year, sort_order) on table public.coach_certifications to authenticated;
grant delete on table public.coach_certifications to authenticated;
grant select (id, coach_profile_id, kind, status, verified_at, created_at, updated_at)
  on table public.coach_verifications to authenticated;

-- ============================================================================
-- 5. coaching requests
-- ============================================================================

create table public.coaching_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.users (id) on delete cascade,
  coach_id uuid not null references public.users (id) on delete cascade,
  service_id uuid references public.coach_services (id) on delete set null,
  message text check (message is null or char_length(message) between 1 and 2000),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  decline_reason text check (decline_reason is null or char_length(decline_reason) <= 500),
  resolved_at timestamptz,
  -- set when accepted: the relationship this request became
  trainer_client_id uuid references public.trainer_clients (id) on delete set null,
  -- placeholders for paid coaching and booking; their tables do not exist yet
  payment_id uuid,
  booking_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (client_id <> coach_id),
  check ((status = 'pending') = (resolved_at is null))
);
create trigger coaching_requests_updated before update on public.coaching_requests
  for each row execute function public.handle_updated_at();
create unique index coaching_requests_one_pending on public.coaching_requests (client_id, coach_id)
  where status = 'pending';
create index coaching_requests_coach_idx on public.coaching_requests (coach_id, status, created_at desc);
create index coaching_requests_client_idx on public.coaching_requests (client_id, created_at desc);

alter table public.coaching_requests enable row level security;
create policy coaching_requests_parties on public.coaching_requests for select to authenticated
  using (client_id = auth.uid() or coach_id = auth.uid() or public.is_admin());
revoke all on table public.coaching_requests from anon;
revoke insert, update, delete on table public.coaching_requests from authenticated;
grant select on table public.coaching_requests to authenticated;

-- ============================================================================
-- 6. coach RPCs
-- ============================================================================

/**
 * Turn the signed-in account into a coach with a draft profile. Idempotent:
 * a second call returns the same profile.
 *
 * Role: client → both. Not `coach`: detect_streak_risk() and
 * detect_checkin_due() select role in ('client', 'both'), and someone who has
 * been training as a client keeps their own reminders. coach / both / admin
 * keep their role — this can never raise anyone to admin. The tier follows:
 * own_tier() reads coach_free for a coach role with no paid subscription.
 */
create or replace function public.become_coach()
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_u public.users;
  v_id uuid;
  v_base text;
  v_slug text;
  v_n int := 1;
begin
  if v_user is null then
    raise exception 'NOT_SIGNED_IN' using errcode = '42501';
  end if;
  select * into v_u from public.users where id = v_user for update;
  if not found then
    raise exception 'NOT_SIGNED_IN' using errcode = '42501';
  end if;
  if v_u.suspended_at is not null
     or exists (select 1 from public.account_deletion_requests d where d.user_id = v_user) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '42501';
  end if;
  if v_u.username is null then
    raise exception 'PROFILE_INCOMPLETE' using errcode = '22023';
  end if;

  if v_u.role = 'client' then
    update public.users set role = 'both' where id = v_user;
  end if;

  select id into v_id from public.coach_profiles where user_id = v_user;
  if v_id is not null then
    return v_id;
  end if;

  v_base := public.coach_slug_base(v_u.username);
  v_slug := v_base;
  while exists (select 1 from public.coach_profiles where slug = v_slug)
        or public.coach_slug_reserved(v_slug) loop
    v_n := v_n + 1;
    v_slug := left(v_base, 55) || '-' || v_n;
  end loop;

  insert into public.coach_profiles (user_id, slug) values (v_user, v_slug)
  returning id into v_id;
  return v_id;
end;
$$;

-- The caller's profile, which must be a draft to be changed.
create or replace function public.coach_my_editable_profile()
returns uuid language plpgsql stable security definer set search_path = public as $$
declare
  v_id uuid;
  v_status text;
begin
  select id, status into v_id, v_status from public.coach_profiles where user_id = auth.uid();
  if v_id is null then
    raise exception 'NO_COACH_PROFILE' using errcode = 'P0002';
  end if;
  if v_status <> 'draft' then
    raise exception 'PROFILE_LOCKED' using errcode = '55000';
  end if;
  return v_id;
end;
$$;

-- The three sets are replaced whole: the editor sends what is ticked.
create or replace function public.coach_set_specializations(p_slugs text[], p_primary text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_profile uuid := public.coach_my_editable_profile();
  v_slugs text[] := coalesce(p_slugs, '{}');
begin
  if cardinality(v_slugs) > 8 then
    raise exception 'TOO_MANY_SPECIALIZATIONS' using errcode = '22023';
  end if;
  if exists (select unnest(v_slugs) except select slug from public.specializations where active)
     or (p_primary is not null and not (p_primary = any (v_slugs))) then
    raise exception 'UNKNOWN_SPECIALIZATION' using errcode = '22023';
  end if;
  delete from public.coach_specializations where coach_profile_id = v_profile;
  insert into public.coach_specializations (coach_profile_id, specialization_id, is_primary)
  select v_profile, s.id, s.slug = coalesce(p_primary, '')
  from public.specializations s
  where s.slug = any (v_slugs);
end;
$$;

create or replace function public.coach_set_languages(p_codes text[])
returns void language plpgsql security definer set search_path = public as $$
declare
  v_profile uuid := public.coach_my_editable_profile();
  v_codes text[] := coalesce(p_codes, '{}');
begin
  if cardinality(v_codes) > 10 then
    raise exception 'TOO_MANY_LANGUAGES' using errcode = '22023';
  end if;
  if exists (select unnest(v_codes) except select code from public.languages where active) then
    raise exception 'UNKNOWN_LANGUAGE' using errcode = '22023';
  end if;
  delete from public.coach_languages where coach_profile_id = v_profile;
  insert into public.coach_languages (coach_profile_id, language_code)
  select distinct v_profile, c from unnest(v_codes) c;
end;
$$;

-- p_locations: [{"city": "cluj-napoca", "gym_name": "…"}, …]
create or replace function public.coach_set_locations(p_locations jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_profile uuid := public.coach_my_editable_profile();
  v_items jsonb := coalesce(p_locations, '[]'::jsonb);
begin
  if jsonb_typeof(v_items) <> 'array' then
    raise exception 'INVALID_LOCATIONS' using errcode = '22023';
  end if;
  if jsonb_array_length(v_items) > 5 then
    raise exception 'TOO_MANY_LOCATIONS' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(v_items) e
             where not exists (select 1 from public.cities c
                               where c.slug = e ->> 'city' and c.active)) then
    raise exception 'UNKNOWN_CITY' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(v_items) e
             where char_length(btrim(coalesce(e ->> 'gym_name', ''))) > 120) then
    raise exception 'GYM_NAME_TOO_LONG' using errcode = '22023';
  end if;
  delete from public.coach_locations where coach_profile_id = v_profile;
  insert into public.coach_locations (coach_profile_id, city_id, gym_name)
  select distinct on (c.id) v_profile, c.id, nullif(btrim(e ->> 'gym_name'), '')
  from jsonb_array_elements(v_items) e
  join public.cities c on c.slug = e ->> 'city';
end;
$$;

/**
 * What still stops this profile from being submitted, as codes the editor can
 * turn into copy. Empty = ready. The owner may ask about their own profile,
 * an admin about anyone's.
 */
create or replace function public.coach_profile_missing(p_profile uuid default null)
returns text[] language plpgsql stable security definer set search_path = public as $$
declare
  v_cp public.coach_profiles;
  v_avatar text;
begin
  if p_profile is null then
    select * into v_cp from public.coach_profiles where user_id = auth.uid();
  else
    select * into v_cp from public.coach_profiles where id = p_profile;
  end if;
  if v_cp.id is null or (v_cp.user_id <> auth.uid() and not public.is_admin()) then
    raise exception 'NO_COACH_PROFILE' using errcode = 'P0002';
  end if;
  select avatar_url into v_avatar from public.users where id = v_cp.user_id;

  return array_remove(array[
    case when nullif(btrim(v_cp.headline), '') is null then 'HEADLINE' end,
    case when nullif(btrim(v_cp.about), '') is null then 'ABOUT' end,
    case when not exists (select 1 from public.coach_specializations cs
                          join public.specializations s on s.id = cs.specialization_id and s.active
                          where cs.coach_profile_id = v_cp.id) then 'SPECIALIZATION' end,
    -- "at least one location, or online": a coach must say how they work, and
    -- in person needs somewhere to be
    case when not v_cp.online and not v_cp.in_person then 'DELIVERY_MODE' end,
    case when v_cp.in_person and not exists (select 1 from public.coach_locations l
                                             where l.coach_profile_id = v_cp.id) then 'LOCATION' end,
    case when not exists (select 1 from public.coach_services sv
                          where sv.coach_profile_id = v_cp.id and sv.active) then 'SERVICE' end,
    case when exists (select 1 from public.coach_services sv
                      where sv.coach_profile_id = v_cp.id and sv.active
                        and sv.price_unit <> 'custom' and sv.price_cents is null) then 'SERVICE_PRICE' end,
    case when nullif(btrim(v_avatar), '') is null then 'AVATAR' end,
    case when v_cp.slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or public.coach_slug_reserved(v_cp.slug) then 'SLUG' end,
    case when v_cp.coaching_since > extract(year from now())::int then 'COACHING_SINCE' end
  ], null);
end;
$$;

/**
 * draft → pending_review. Returns the missing items instead of raising, so the
 * editor can show all of them at once; an empty array means it was submitted.
 */
create or replace function public.submit_coach_for_review()
returns text[] language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_status text;
  v_missing text[];
begin
  select id, status into v_id, v_status from public.coach_profiles
  where user_id = auth.uid() for update;
  if v_id is null then
    raise exception 'NO_COACH_PROFILE' using errcode = 'P0002';
  end if;
  if v_status <> 'draft' then
    raise exception 'NOT_DRAFT' using errcode = '55000';
  end if;
  v_missing := public.coach_profile_missing(v_id);
  if cardinality(v_missing) > 0 then
    return v_missing;
  end if;
  update public.coach_profiles
     set status = 'pending_review', submitted_at = now(), review_note = null
   where id = v_id;
  return '{}';
end;
$$;

-- published | pending_review → draft, by the coach. Not from suspended.
create or replace function public.withdraw_coach_profile()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_status text;
begin
  select id, status into v_id, v_status from public.coach_profiles
  where user_id = auth.uid() for update;
  if v_id is null then
    raise exception 'NO_COACH_PROFILE' using errcode = 'P0002';
  end if;
  if v_status not in ('pending_review', 'published') then
    raise exception 'BAD_TRANSITION' using errcode = '55000';
  end if;
  update public.coach_profiles set status = 'draft', submitted_at = null where id = v_id;
end;
$$;

-- ============================================================================
-- 7. search text
-- ============================================================================

-- Everything a search should match, normalised. Never the raw full_name: it
-- may be an e-mail address.
create or replace function public.coach_profiles_search_text(
  p_profile uuid, p_user uuid, p_headline text, p_about text
) returns text language sql stable security definer set search_path = public as $$
  select public.search_normalize(concat_ws(' ',
    public.public_display_name(u.username, u.full_name),
    u.username,
    p_headline,
    p_about,
    (select string_agg(s.name_en || ' ' || s.name_ro, ' ')
       from public.coach_specializations cs
       join public.specializations s on s.id = cs.specialization_id
      where cs.coach_profile_id = p_profile),
    (select string_agg(c.name || ' ' || coalesce(c.name_en, ''), ' ')
       from public.coach_locations l
       join public.cities c on c.id = l.city_id
      where l.coach_profile_id = p_profile),
    (select string_agg(sv.name, ' ')
       from public.coach_services sv
      where sv.coach_profile_id = p_profile and sv.active)
  ))
  from public.users u where u.id = p_user;
$$;

create or replace function public.coach_profiles_refresh_search()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.search_text := coalesce(
    public.coach_profiles_search_text(new.id, new.user_id, new.headline, new.about), '');
  return new;
end;
$$;
create trigger coach_profiles_refresh_search before insert or update on public.coach_profiles
  for each row execute function public.coach_profiles_refresh_search();

-- A child row changed: touch the profile so the trigger above rebuilds it.
-- Runs as the owner, so the edit lock (API roles only) does not apply.
create or replace function public.coach_child_touch_search()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.coach_profiles set search_text = ''
   where id = coalesce(case when tg_op <> 'DELETE' then new.coach_profile_id end, old.coach_profile_id);
  return null;
end;
$$;
create trigger coach_specializations_search after insert or update or delete on public.coach_specializations
  for each row execute function public.coach_child_touch_search();
create trigger coach_locations_search after insert or update or delete on public.coach_locations
  for each row execute function public.coach_child_touch_search();
create trigger coach_services_search after insert or update or delete on public.coach_services
  for each row execute function public.coach_child_touch_search();

-- A renamed specialization / city or a changed username reaches every profile.
create or replace function public.coach_reference_touch_search()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'specializations' then
    update public.coach_profiles set search_text = ''
     where id in (select coach_profile_id from public.coach_specializations where specialization_id = new.id);
  elsif tg_table_name = 'cities' then
    update public.coach_profiles set search_text = ''
     where id in (select coach_profile_id from public.coach_locations where city_id = new.id);
  else
    update public.coach_profiles set search_text = '' where user_id = new.id;
  end if;
  return null;
end;
$$;
create trigger specializations_search after update of name_en, name_ro on public.specializations
  for each row execute function public.coach_reference_touch_search();
create trigger cities_search after update of name, name_en on public.cities
  for each row execute function public.coach_reference_touch_search();
create trigger users_coach_search after update of username, full_name on public.users
  for each row execute function public.coach_reference_touch_search();

-- ============================================================================
-- 8. coaching request RPCs
-- ============================================================================

create or replace function public.request_coaching(
  p_coach_profile uuid,
  p_service uuid default null,
  p_message text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_coach uuid;
  v_accepting boolean;
  v_message text := nullif(btrim(coalesce(p_message, '')), '');
  v_id uuid;
begin
  if v_user is null then
    raise exception 'NOT_SIGNED_IN' using errcode = '42501';
  end if;
  if not exists (select 1 from public.users u where u.id = v_user
                 and u.suspended_at is null and u.username is not null)
     or exists (select 1 from public.account_deletion_requests d where d.user_id = v_user) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '42501';
  end if;

  -- the same visibility as the public page, plus "not across a block"
  select cp.user_id, cp.accepting_clients into v_coach, v_accepting
  from public.coach_profiles cp
  join public.users u on u.id = cp.user_id
  where cp.id = p_coach_profile
    and cp.status = 'published'
    and u.suspended_at is null
    and not exists (select 1 from public.account_deletion_requests d where d.user_id = cp.user_id)
    and not public.social_blocked_between(v_user, cp.user_id);
  if v_coach is null then
    raise exception 'COACH_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_coach = v_user then
    raise exception 'CANNOT_REQUEST_SELF' using errcode = '22023';
  end if;
  if not v_accepting then
    raise exception 'NOT_ACCEPTING_CLIENTS' using errcode = '55000';
  end if;
  if p_service is not null and not exists (
       select 1 from public.coach_services sv
       where sv.id = p_service and sv.coach_profile_id = p_coach_profile and sv.active) then
    raise exception 'UNKNOWN_SERVICE' using errcode = '22023';
  end if;
  if exists (select 1 from public.trainer_clients tc
             where tc.coach_id = v_coach and tc.client_id = v_user and tc.status = 'active') then
    raise exception 'ALREADY_COACHED' using errcode = '55000';
  end if;
  if char_length(v_message) > 2000 then
    raise exception 'MESSAGE_TOO_LONG' using errcode = '22023';
  end if;
  if (select count(*) from public.coaching_requests r
      where r.client_id = v_user and r.created_at > now() - interval '24 hours') >= 10 then
    raise exception 'REQUEST_RATE' using errcode = 'P0001';
  end if;

  begin
    insert into public.coaching_requests (client_id, coach_id, service_id, message)
    values (v_user, v_coach, p_service, v_message)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'REQUEST_PENDING' using errcode = '23505';
  end;
  return v_id;
end;
$$;

create or replace function public.cancel_coaching_request(p_request uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.coaching_requests
     set status = 'cancelled', resolved_at = now()
   where id = p_request and client_id = auth.uid() and status = 'pending';
  if not found then
    raise exception 'REQUEST_NOT_PENDING' using errcode = '55000';
  end if;
end;
$$;

create or replace function public.decline_coaching_request(p_request uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.coaching_requests
     set status = 'declined', resolved_at = now(),
         decline_reason = left(nullif(btrim(coalesce(p_reason, '')), ''), 500)
   where id = p_request and coach_id = auth.uid() and status = 'pending';
  if not found then
    raise exception 'REQUEST_NOT_PENDING' using errcode = '55000';
  end if;
end;
$$;

-- ============================================================================
-- 9. admin RPCs (no admin UI yet)
-- ============================================================================

/**
 * The only way a profile becomes published or suspended.
 *   pending_review → published            approve
 *   pending_review → draft                reject (reason required, shown to the coach)
 *   published      → draft                unpublish (reason required)
 *   draft | pending_review | published → suspended   (reason required)
 *   suspended      → published | draft    reinstate
 */
create or replace function public.admin_set_coach_profile_status(
  p_profile uuid, p_status text, p_reason text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_cp public.coach_profiles;
  v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 1000);
begin
  perform public.admin_assert();
  select * into v_cp from public.coach_profiles where id = p_profile for update;
  if not found then
    raise exception 'NO_COACH_PROFILE' using errcode = 'P0002';
  end if;
  if not (
       (v_cp.status = 'pending_review' and p_status in ('published', 'draft'))
    or (v_cp.status = 'published' and p_status = 'draft')
    or (v_cp.status <> 'suspended' and p_status = 'suspended')
    or (v_cp.status = 'suspended' and p_status in ('published', 'draft'))
  ) then
    raise exception 'BAD_TRANSITION' using errcode = '22023';
  end if;
  if v_reason is null and (p_status = 'suspended' or (p_status = 'draft' and v_cp.status <> 'suspended')) then
    raise exception 'REASON_REQUIRED' using errcode = '22023';
  end if;

  update public.coach_profiles set
    status = p_status,
    reviewed_at = now(),
    reviewed_by = auth.uid(),
    published_at = case when p_status = 'published' then coalesce(published_at, now()) else published_at end,
    review_note = case when p_status = 'draft' then v_reason when p_status = 'published' then null else review_note end,
    suspended_at = case when p_status = 'suspended' then now() end,
    suspension_reason = case when p_status = 'suspended' then v_reason end
  where id = p_profile;

  perform public.audit_log('ADMIN_ACTION', 'coach_profile', p_profile::text, v_cp.user_id,
    jsonb_build_object('op', 'coach_profile_status', 'from', v_cp.status, 'to', p_status, 'reason', v_reason));
end;
$$;

-- Approve, reject or revoke one kind of verification. A row per (profile, kind).
create or replace function public.admin_set_coach_verification(
  p_profile uuid, p_kind text, p_status text, p_note text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_user uuid;
begin
  perform public.admin_assert();
  if p_kind not in ('identity', 'certification', 'business')
     or p_status not in ('pending', 'verified', 'rejected', 'revoked') then
    raise exception 'BAD_VERIFICATION' using errcode = '22023';
  end if;
  select user_id into v_user from public.coach_profiles where id = p_profile;
  if v_user is null then
    raise exception 'NO_COACH_PROFILE' using errcode = 'P0002';
  end if;
  insert into public.coach_verifications (coach_profile_id, kind, status, admin_note, verified_at, verified_by)
  values (p_profile, p_kind, p_status, left(nullif(btrim(coalesce(p_note, '')), ''), 1000),
          case when p_status = 'verified' then now() end,
          case when p_status = 'verified' then auth.uid() end)
  on conflict (coach_profile_id, kind) do update set
    status = excluded.status,
    admin_note = coalesce(excluded.admin_note, coach_verifications.admin_note),
    verified_at = excluded.verified_at,
    verified_by = excluded.verified_by;
  perform public.audit_log('ADMIN_ACTION', 'coach_profile', p_profile::text, v_user,
    jsonb_build_object('op', 'coach_verification', 'kind', p_kind, 'status', p_status));
end;
$$;

create or replace function public.admin_set_certification_status(
  p_certification uuid, p_status text, p_note text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_profile uuid;
begin
  perform public.admin_assert();
  if p_status not in ('unverified', 'pending', 'verified', 'rejected') then
    raise exception 'BAD_VERIFICATION' using errcode = '22023';
  end if;
  update public.coach_certifications set
    verification_status = p_status,
    verified_at = case when p_status = 'verified' then now() end,
    verified_by = case when p_status = 'verified' then auth.uid() end,
    admin_note = coalesce(left(nullif(btrim(coalesce(p_note, '')), ''), 1000), admin_note)
  where id = p_certification
  returning coach_profile_id into v_profile;
  if v_profile is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  perform public.audit_log('ADMIN_ACTION', 'coach_certification', p_certification::text,
    (select user_id from public.coach_profiles where id = v_profile),
    jsonb_build_object('op', 'certification_status', 'status', p_status));
end;
$$;

-- The review queue, oldest submission first.
create or replace function public.admin_coach_profiles(p_status text default 'pending_review')
returns table (
  id uuid, user_id uuid, slug text, display_name text, headline text, status text,
  submitted_at timestamptz, published_at timestamptz, suspended_at timestamptz, updated_at timestamptz
) language plpgsql stable security definer set search_path = public as $$
begin
  perform public.admin_assert();
  return query
  select cp.id, cp.user_id, cp.slug, public.public_display_name(u.username, u.full_name), cp.headline,
         cp.status, cp.submitted_at, cp.published_at, cp.suspended_at, cp.updated_at
  from public.coach_profiles cp
  join public.users u on u.id = cp.user_id
  where p_status is null or cp.status = p_status
  order by cp.submitted_at nulls last, cp.updated_at desc
  limit 200;
end;
$$;

-- ============================================================================
-- 10. the public door
-- ============================================================================

/**
 * One published coach profile by slug, for anyone — including anonymous
 * visitors and crawlers. The field list below IS the public contract: adding
 * a key here publishes it. Never: e-mail, users.* beyond username/avatar,
 * status / review / suspension data, document_ref, admin notes, non-public
 * prices, rank_score, search_text. user_id only to a signed-in viewer (the
 * follow and request buttons need it).
 *
 * Null when the slug is unknown, the profile is not published, the account is
 * suspended or being deleted, or the viewer and the coach have blocked each
 * other.
 */
create or replace function public.coach_public_profile(p_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', cp.id,
    'user_id', case when auth.uid() is not null then cp.user_id end,
    'slug', cp.slug,
    'display_name', public.public_display_name(u.username, u.full_name),
    'username', u.username,
    'avatar_url', u.avatar_url,
    'cover_url', cp.cover_url,
    'headline', cp.headline,
    'about', cp.about,
    'coaching_since', cp.coaching_since,
    'accepting_clients', cp.accepting_clients,
    'online', cp.online,
    'in_person', cp.in_person,
    'published_at', cp.published_at,
    'followers', (select count(*)::int from public.social_follows f
                  join public.users fu on fu.id = f.follower_id
                  where f.following_id = cp.user_id and fu.suspended_at is null
                    and not exists (select 1 from public.account_deletion_requests d where d.user_id = fu.id)),
    'badges', coalesce((select jsonb_agg(v.kind || '_verified' order by v.kind)
                        from public.coach_verifications v
                        where v.coach_profile_id = cp.id and v.status = 'verified'), '[]'::jsonb),
    'specializations', coalesce((select jsonb_agg(jsonb_build_object(
                          'slug', s.slug, 'name_en', s.name_en, 'name_ro', s.name_ro, 'is_primary', cs.is_primary)
                          order by cs.is_primary desc, s.sort_order)
                        from public.coach_specializations cs
                        join public.specializations s on s.id = cs.specialization_id and s.active
                        where cs.coach_profile_id = cp.id), '[]'::jsonb),
    'languages', coalesce((select jsonb_agg(jsonb_build_object(
                          'code', l.code, 'name_en', l.name_en, 'name_ro', l.name_ro, 'native_name', l.native_name)
                          order by l.sort_order)
                        from public.coach_languages cl
                        join public.languages l on l.code = cl.language_code
                        where cl.coach_profile_id = cp.id), '[]'::jsonb),
    'locations', coalesce((select jsonb_agg(jsonb_build_object(
                          'city_slug', c.slug, 'city', c.name, 'city_en', coalesce(c.name_en, c.name),
                          'country_code', co.code, 'country_en', co.name_en, 'country_ro', co.name_ro,
                          'gym_name', l.gym_name)
                          order by c.name)
                        from public.coach_locations l
                        join public.cities c on c.id = l.city_id
                        join public.countries co on co.code = c.country_code
                        where l.coach_profile_id = cp.id), '[]'::jsonb),
    'certifications', coalesce((select jsonb_agg(jsonb_build_object(
                          'name', ce.name, 'issuer', ce.issuer,
                          'verified', ce.verification_status = 'verified')
                          order by ce.sort_order, ce.created_at)
                        from public.coach_certifications ce
                        where ce.coach_profile_id = cp.id), '[]'::jsonb),
    'services', coalesce((select jsonb_agg(jsonb_build_object(
                          'id', sv.id, 'name', sv.name, 'description', sv.description, 'kind', sv.kind,
                          'price_unit', sv.price_unit, 'price_public', sv.price_public,
                          'price_cents', case when sv.price_public then sv.price_cents end,
                          'currency', case when sv.price_public then sv.currency end)
                          order by sv.sort_order, sv.created_at)
                        from public.coach_services sv
                        where sv.coach_profile_id = cp.id and sv.active), '[]'::jsonb)
  )
  from public.coach_profiles cp
  join public.users u on u.id = cp.user_id
  where cp.slug = lower(btrim(coalesce(p_slug, '')))
    and cp.status = 'published'
    and u.suspended_at is null
    and not exists (select 1 from public.account_deletion_requests d where d.user_id = cp.user_id)
    and not public.social_blocked_between(auth.uid(), cp.user_id);
$$;

-- ============================================================================
-- 11. execute grants
-- ============================================================================
-- Functions are executable by PUBLIC by default; every one here says who may
-- call it. Trigger functions and internal helpers: nobody through the API.

revoke execute on function public.coach_slug_reserved(text) from public, anon, authenticated;
revoke execute on function public.coach_profiles_check_slug() from public, anon, authenticated;
revoke execute on function public.discovery_slug_not_a_coach() from public, anon, authenticated;
revoke execute on function public.coach_profiles_search_text(uuid, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.coach_profiles_refresh_search() from public, anon, authenticated;
revoke execute on function public.coach_child_touch_search() from public, anon, authenticated;
revoke execute on function public.coach_reference_touch_search() from public, anon, authenticated;
revoke execute on function public.coach_my_editable_profile() from public, anon, authenticated;

-- used inside RLS policies, so the caller needs them
revoke execute on function public.coach_profile_owned(uuid) from public, anon;
revoke execute on function public.coach_profile_editable(uuid) from public, anon;
grant execute on function public.coach_profile_owned(uuid) to authenticated;
grant execute on function public.coach_profile_editable(uuid) to authenticated;

-- signed-in only
revoke execute on function public.become_coach() from public, anon;
revoke execute on function public.coach_set_specializations(text[], text) from public, anon;
revoke execute on function public.coach_set_languages(text[]) from public, anon;
revoke execute on function public.coach_set_locations(jsonb) from public, anon;
revoke execute on function public.coach_profile_missing(uuid) from public, anon;
revoke execute on function public.submit_coach_for_review() from public, anon;
revoke execute on function public.withdraw_coach_profile() from public, anon;
revoke execute on function public.request_coaching(uuid, uuid, text) from public, anon;
revoke execute on function public.cancel_coaching_request(uuid) from public, anon;
revoke execute on function public.decline_coaching_request(uuid, text) from public, anon;
revoke execute on function public.admin_set_coach_profile_status(uuid, text, text) from public, anon;
revoke execute on function public.admin_set_coach_verification(uuid, text, text, text) from public, anon;
revoke execute on function public.admin_set_certification_status(uuid, text, text) from public, anon;
revoke execute on function public.admin_coach_profiles(text) from public, anon;
grant execute on function public.become_coach() to authenticated;
grant execute on function public.coach_set_specializations(text[], text) to authenticated;
grant execute on function public.coach_set_languages(text[]) to authenticated;
grant execute on function public.coach_set_locations(jsonb) to authenticated;
grant execute on function public.coach_profile_missing(uuid) to authenticated;
grant execute on function public.submit_coach_for_review() to authenticated;
grant execute on function public.withdraw_coach_profile() to authenticated;
grant execute on function public.request_coaching(uuid, uuid, text) to authenticated;
grant execute on function public.cancel_coaching_request(uuid) to authenticated;
grant execute on function public.decline_coaching_request(uuid, text) to authenticated;
grant execute on function public.admin_set_coach_profile_status(uuid, text, text) to authenticated;
grant execute on function public.admin_set_coach_verification(uuid, text, text, text) to authenticated;
grant execute on function public.admin_set_certification_status(uuid, text, text) to authenticated;
grant execute on function public.admin_coach_profiles(text) to authenticated;

-- the anonymous door
revoke execute on function public.coach_public_profile(text) from public;
grant execute on function public.coach_public_profile(text) to anon, authenticated;
