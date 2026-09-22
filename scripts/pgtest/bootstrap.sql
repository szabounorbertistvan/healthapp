-- Just enough Supabase for supabase/migrations to apply to a bare Postgres.
--
-- Everything the migrations reference but do not create themselves: the three
-- Supabase roles, the `extensions` / `auth` / `supabase_migrations` schemas,
-- a stand-in auth.users (the columns the migrations and the admin panel read)
-- and the auth.* helpers, above all auth.uid(), which is what every RLS policy
-- in this repo is written against.
--
-- This is NOT the real Supabase auth schema — see README.md.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
grant anon, authenticated, service_role to postgres;

create schema if not exists extensions;
create schema if not exists auth;
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text primary key);

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

alter database postgres set search_path = "$user", public, extensions;

create table auth.users (
  id uuid primary key,
  email text,
  encrypted_password text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  raw_app_meta_data jsonb default '{}'::jsonb,
  last_sign_in_at timestamptz,
  email_confirmed_at timestamptz default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz,
  is_sso_user boolean default false,
  phone text,
  aud text default 'authenticated',
  role text default 'authenticated',
  recovery_sent_at timestamptz,
  confirmation_sent_at timestamptz,
  email_change_sent_at timestamptz,
  banned_until timestamptz,
  invited_at timestamptz,
  confirmed_at timestamptz
);

create table auth.identities (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  provider text,
  provider_id text,
  identity_data jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  last_sign_in_at timestamptz
);

create table auth.audit_log_entries (
  id uuid primary key default extensions.gen_random_uuid(),
  instance_id uuid,
  payload json,
  created_at timestamptz default now(),
  ip_address varchar(64) default ''
);

-- An empty setting must not be cast to jsonb, or every anonymous query errors.
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ), '')::uuid
$$;

create or replace function auth.role() returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )
$$;

create or replace function auth.email() returns text language sql stable as $$
  select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
$$;

create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;

grant usage on schema auth, extensions to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;
