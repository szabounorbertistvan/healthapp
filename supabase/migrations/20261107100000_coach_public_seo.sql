-- HealthApp schema · Coach Discovery: the public directory's SEO foundation
--
-- What existed: /coaches and /coaches/[slug] are public (middleware lets them
-- through), backed only by anon-granted readers gated by coach_public_visible()
-- (published, account live, no block); a slug is unique, lower-case words and
-- hyphens, not reserved, and editable only while the profile is a draft;
-- publishing needs a complete profile (coach_profile_missing(): headline,
-- about, a specialization, a delivery mode, a location when in person, an
-- active service, an avatar, a valid slug) and an admin's approval. This adds
-- the two things a public, shared, crawled URL still needs:
--
-- 1. Permanent links. A coach puts /coaches/<slug> in an Instagram bio; if the
--    slug later changes (back to draft, renamed, approved again), the old link
--    must not die. coach_slug_redirects keeps every slug a profile had once it
--    had been published, coach_slug_redirect(old) answers the current slug of
--    a profile that is public right now (nothing otherwise — a redirect never
--    reveals a hidden or suspended coach), and a slug in that history cannot
--    be taken by another coach (SLUG_TAKEN) — a shared link never lands on a
--    stranger. The owner may take an old slug of their own back.
--
-- 2. The sitemap. coach_sitemap() lists the coaches a search engine may index:
--    public (coach_public_visible's rule, without a viewer) and still carrying
--    the essentials publishing required — a headline, an about, an avatar, a
--    specialization and an active service (an avatar can be removed after
--    approval; a page that lost them is not offered for indexing, and the page
--    itself says noindex — lib/coach-public.ts coachIndexable()). Slug and
--    last modification only.

-- ---------- 1. slug history ----------
create table public.coach_slug_redirects (
  old_slug text primary key check (old_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  coach_profile_id uuid not null references public.coach_profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index coach_slug_redirects_profile_idx on public.coach_slug_redirects (coach_profile_id);
alter table public.coach_slug_redirects enable row level security;
-- no policy and no grant: read through coach_slug_redirect() only
revoke all on table public.coach_slug_redirects from anon, authenticated;

create or replace function public.coach_slug_history_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- a slug another profile used to have stays theirs: their old links point there
  if exists (select 1 from public.coach_slug_redirects r
             where r.old_slug = new.slug and r.coach_profile_id <> new.id) then
    raise exception 'SLUG_TAKEN' using errcode = '23505';
  end if;
  -- taking one of your own old slugs back: it is live again, not a redirect
  delete from public.coach_slug_redirects where old_slug = new.slug and coach_profile_id = new.id;
  return new;
end;
$$;
revoke execute on function public.coach_slug_history_guard() from public, anon, authenticated;
create trigger coach_profiles_slug_history_guard before insert or update of slug on public.coach_profiles
  for each row execute function public.coach_slug_history_guard();

create or replace function public.coach_slug_history_record()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- only a slug the public could have seen: the profile had been published
  if old.slug is distinct from new.slug and old.published_at is not null then
    insert into public.coach_slug_redirects (old_slug, coach_profile_id)
    values (old.slug, new.id)
    on conflict (old_slug) do update set coach_profile_id = excluded.coach_profile_id, created_at = now();
  end if;
  return null;
end;
$$;
revoke execute on function public.coach_slug_history_record() from public, anon, authenticated;
create trigger coach_profiles_slug_history_record after update of slug on public.coach_profiles
  for each row execute function public.coach_slug_history_record();

/** The current slug for an old one, if that coach is public right now; null otherwise. */
create or replace function public.coach_slug_redirect(p_slug text)
returns text language sql stable security definer set search_path = public as $$
  select cp.slug
  from public.coach_slug_redirects r
  join public.coach_profiles cp on cp.id = r.coach_profile_id
  where r.old_slug = lower(btrim(coalesce(p_slug, '')))
    and exists (select 1 from public.coach_public_visible(cp.slug));
$$;
revoke execute on function public.coach_slug_redirect(text) from public;
grant execute on function public.coach_slug_redirect(text) to anon, authenticated;

-- ---------- 2. the sitemap ----------
/**
 * Every indexable coach page: slug and last modification, newest first.
 * Public by design (a sitemap is read by crawlers); nothing else is returned.
 */
create or replace function public.coach_sitemap(p_limit int default 5000, p_offset int default 0)
returns table (slug text, last_modified timestamptz)
language sql stable security definer set search_path = public as $$
  select cp.slug, greatest(cp.updated_at, cp.published_at)
  from public.coach_profiles cp
  join public.users u on u.id = cp.user_id
  where cp.status = 'published'
    and u.suspended_at is null
    and not exists (select 1 from public.account_deletion_requests d where d.user_id = cp.user_id)
    -- the essentials publishing required, still there
    and nullif(btrim(cp.headline), '') is not null
    and nullif(btrim(cp.about), '') is not null
    and nullif(btrim(u.avatar_url), '') is not null
    and exists (select 1 from public.coach_specializations cs where cs.coach_profile_id = cp.id)
    and exists (select 1 from public.coach_services sv where sv.coach_profile_id = cp.id and sv.active)
  order by greatest(cp.updated_at, cp.published_at) desc, cp.slug
  limit greatest(1, least(coalesce(p_limit, 5000), 50000)) offset greatest(0, coalesce(p_offset, 0));
$$;
revoke execute on function public.coach_sitemap(int, int) from public;
grant execute on function public.coach_sitemap(int, int) to anon, authenticated;
