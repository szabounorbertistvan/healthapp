-- HealthApp schema · Coach Discovery: saved coaches (a private shortlist)
--
-- Follow (social_follows) is a public, social relationship: the coach sees
-- it, it feeds their posts into yours. Save is the opposite: a private
-- shortlist of coaches to come back to. Nobody but the person who saved can
-- see a save — not the coach, not other users, not anonymous callers — and
-- no count of saves exists anywhere. The shape is program_saves' (a bookmark).
--
-- 1. coach_saves (user_id, coach_profile_id, created_at), primary key on the
--    pair (one save per coach per person, enforced here, not in the app).
--    Saving yourself is refused by a trigger (CANNOT_SAVE_SELF), whatever
--    role writes. Saving a coach you cannot see (draft, hidden, suspended,
--    a deleting account, across a block) is refused by the insert policy,
--    through the definer helper coach_saveable(). A save outlives its coach
--    going hidden or suspended, but every read goes through the public doors
--    (search_coaches), so an invisible coach simply does not show; a deleted
--    profile or account cascades the rows away.
--
-- 2. RLS: the owner selects, inserts and deletes their own rows; nothing
--    else, no update. anon has no privilege at all.
--
-- 3. search_coaches() (latest: 20261101100000):
--      p_saved   only the caller's saved coaches (the /coaches/saved page)
--      'saved'   sort: most recently saved first
--      items     gain the profile id (public already, on coach_public_profile)
--                and, for a signed-in caller only, is_saved — computed in the
--                same query, never one request per card.
--    coach_viewer_state() gains is_saved for the public profile's button.
--
-- 4. "saved" becomes a reserved coach slug: /coaches/saved is the page.

-- ---------- 1-2. the table ----------
create table public.coach_saves (
  user_id uuid not null references public.users (id) on delete cascade,
  coach_profile_id uuid not null references public.coach_profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, coach_profile_id)
);
create index coach_saves_user_idx on public.coach_saves (user_id, created_at desc);
create index coach_saves_profile_idx on public.coach_saves (coach_profile_id);
alter table public.coach_saves enable row level security;

/** A coach the caller may save: visible to them (the public page's own rule) and not themselves. */
create or replace function public.coach_saveable(p_profile uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.coach_profiles cp
    join public.users u on u.id = cp.user_id
    where cp.id = p_profile
      and cp.status = 'published'
      and cp.user_id <> auth.uid()
      and u.suspended_at is null
      and not exists (select 1 from public.account_deletion_requests d where d.user_id = cp.user_id)
      and not public.social_blocked_between(auth.uid(), cp.user_id)
  );
$$;
revoke execute on function public.coach_saveable(uuid) from public, anon;
grant execute on function public.coach_saveable(uuid) to authenticated;

create or replace function public.coach_saves_not_self()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.coach_profiles cp where cp.id = new.coach_profile_id and cp.user_id = new.user_id) then
    raise exception 'CANNOT_SAVE_SELF' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger coach_saves_not_self before insert or update on public.coach_saves
  for each row execute function public.coach_saves_not_self();
revoke execute on function public.coach_saves_not_self() from public, anon, authenticated;

create policy coach_saves_select on public.coach_saves for select to authenticated
  using (user_id = auth.uid());
create policy coach_saves_insert on public.coach_saves for insert to authenticated
  with check (user_id = auth.uid() and public.coach_saveable(coach_profile_id));
create policy coach_saves_delete on public.coach_saves for delete to authenticated
  using (user_id = auth.uid());

revoke all on table public.coach_saves from anon, authenticated;
grant select, delete on table public.coach_saves to authenticated;
grant insert (user_id, coach_profile_id) on table public.coach_saves to authenticated;

-- ---------- 3. search and the viewer state ----------
drop function public.search_coaches(text, text, text, boolean, boolean, text[], int, int, int, text, boolean, text, int, int, boolean, boolean, uuid);

create function public.search_coaches(
  p_query text default null,
  p_country text default null,
  p_city text default null,
  p_online boolean default null,
  p_in_person boolean default null,
  p_specializations text[] default null,
  p_min_years int default null,
  p_price_min int default null,
  p_price_max int default null,
  p_currency text default 'RON',
  p_accepting boolean default true,
  p_sort text default 'recommended',
  p_limit int default 24,
  p_offset int default 0,
  p_verified boolean default null,
  p_hybrid boolean default null,
  p_gym uuid default null,
  p_saved boolean default null
) returns jsonb language sql stable security definer set search_path = public, extensions as $$
  with params as (
    -- a query with no searchable word (only punctuation) is no query
    select case when public.coach_search_tsquery(p_query) is null then null
                else public.search_normalize(btrim(p_query)) end as q,
           public.coach_search_tsquery(p_query) as tsq,
           nullif(lower(btrim(coalesce(p_country, ''))), '') as country,
           nullif(lower(btrim(coalesce(p_city, ''))), '') as city,
           nullif(array_remove(coalesce(p_specializations, '{}'), ''), '{}') as specs,
           upper(coalesce(nullif(btrim(p_currency), ''), 'RON')) as currency,
           case when p_sort in ('recommended', 'relevance', 'experience', 'followers', 'newest', 'saved')
                then p_sort else 'recommended' end as sort,
           -- up to 10 pages of 24: "Load more" grows one listing (lib/coach-discovery.ts)
           greatest(1, least(coalesce(p_limit, 24), 240)) as lim,
           greatest(0, least(coalesce(p_offset, 0), 1000)) as off
  ),
  matched as (
    select cp.id, cp.user_id, cp.slug, cp.headline, cp.about, cp.cover_url, cp.coaching_since,
           cp.accepting_clients, cp.online, cp.in_person, cp.published_at, cp.search_doc, cp.search_text,
           cp.verification_status,
           u.username, u.full_name, u.avatar_url
    from public.coach_profiles cp
    join public.users u on u.id = cp.user_id
    cross join params pr
    where cp.status = 'published'
      and u.suspended_at is null
      and not exists (select 1 from public.account_deletion_requests d where d.user_id = cp.user_id)
      and not public.social_blocked_between(auth.uid(), cp.user_id)
      -- text
      and (pr.q is null
           or (pr.tsq is not null and cp.search_doc @@ pr.tsq)
           or cp.search_text like '%' || pr.q || '%'
           or extensions.word_similarity(pr.q, cp.search_text) >= 0.45)
      -- availability: only accepting coaches unless the caller asks for all
      and (p_accepting is not true or cp.accepting_clients)
      -- verified: at least one verification an admin accepted (the ✓ on the card)
      and (p_verified is not true or cp.verification_status = 'verified')
      -- hybrid: coaches both online and in person (on top of the format ticks)
      and (p_hybrid is not true or (cp.online and cp.in_person))
      -- the caller's own shortlist (20261102100000); anonymous callers have none
      and (p_saved is not true or exists (
            select 1 from public.coach_saves sv where sv.user_id = auth.uid() and sv.coach_profile_id = cp.id))
      -- a gym: the coach lists a location at it
      and (p_gym is null or exists (
            select 1 from public.coach_locations l where l.coach_profile_id = cp.id and l.gym_id = p_gym))
      -- format: any of the ticked ones; none ticked = no filter
      and (coalesce(p_online, false) = false and coalesce(p_in_person, false) = false
           or (p_online is true and cp.online)
           or (p_in_person is true and cp.in_person))
      and (pr.city is null or exists (
            select 1 from public.coach_locations l join public.cities c on c.id = l.city_id
            where l.coach_profile_id = cp.id and c.slug = pr.city))
      and (pr.country is null or exists (
            select 1 from public.coach_locations l
            join public.cities c on c.id = l.city_id
            join public.countries co on co.code = c.country_code
            where l.coach_profile_id = cp.id and (co.slug = pr.country or lower(co.code) = pr.country)))
      and (pr.specs is null or exists (
            select 1 from public.coach_specializations cs join public.specializations s on s.id = cs.specialization_id
            where cs.coach_profile_id = cp.id and s.slug = any (pr.specs)))
      and (p_min_years is null or p_min_years <= 0
           or (cp.coaching_since is not null
               and cp.coaching_since <= extract(year from now())::int - p_min_years))
      -- price: public prices only, in one currency
      and (p_price_min is null and p_price_max is null or exists (
            select 1 from public.coach_services sv
            where sv.coach_profile_id = cp.id and sv.active and sv.price_public
              and sv.price_cents is not null and sv.currency = pr.currency
              and sv.price_cents >= coalesce(p_price_min, 0)
              and sv.price_cents <= coalesce(p_price_max, 2147483647)))
  ),
  scored as (
    select m.*,
           (case when m.cover_url is not null then 1 else 0 end
            + case when char_length(coalesce(m.about, '')) >= 200 then 1 else 0 end
            + case when exists (select 1 from public.coach_certifications ce where ce.coach_profile_id = m.id) then 1 else 0 end
            + case when exists (select 1 from public.coach_languages cl where cl.coach_profile_id = m.id) then 1 else 0 end
            + case when exists (select 1 from public.coach_services sv where sv.coach_profile_id = m.id and sv.active
                                and sv.price_public and sv.price_cents is not null) then 1 else 0 end) as completeness,
           m.verification_status = 'verified' as verified,
           (select sv.created_at from public.coach_saves sv
             where sv.user_id = auth.uid() and sv.coach_profile_id = m.id) as saved_at,
           (select count(*)::int from public.social_follows f
              join public.users fu on fu.id = f.follower_id
             where f.following_id = m.user_id and fu.suspended_at is null
               and not exists (select 1 from public.account_deletion_requests d where d.user_id = fu.id)) as followers,
           case when pr.q is null then 0::real
                else coalesce(ts_rank(m.search_doc, pr.tsq), 0) + extensions.word_similarity(pr.q, m.search_text) end as relevance
    from matched m cross join params pr
  ),
  ranked as (
    -- the order, computed once: the page is a slice of it, and the items keep it
    select s.*, row_number() over (order by
      case when pr.sort = 'saved' then s.saved_at end desc nulls last,
      case when pr.sort = 'relevance' then s.relevance end desc nulls last,
      case when pr.sort = 'experience' then s.coaching_since end asc nulls last,
      case when pr.sort = 'followers' then s.followers end desc nulls last,
      case when pr.sort = 'newest' then s.published_at end desc nulls last,
      s.accepting_clients desc, s.completeness desc, s.verified desc, s.relevance desc,
      s.followers desc, s.published_at desc nulls last, s.id) as ord
    from scored s cross join params pr
  ),
  page as (
    select r.* from ranked r cross join params pr
    where r.ord > pr.off and r.ord <= pr.off + pr.lim
  )
  select jsonb_build_object(
    'total', (select count(*)::int from scored),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'slug', p.slug,
        'display_name', public.public_display_name(p.username, p.full_name),
        'avatar_url', p.avatar_url,
        'headline', p.headline,
        'verified', p.verified,
        'online', p.online,
        'in_person', p.in_person,
        'coaching_since', p.coaching_since,
        'accepting_clients', p.accepting_clients,
        'followers', p.followers,
        'location', (select jsonb_build_object('city', c.name, 'city_en', coalesce(c.name_en, c.name),
                                               'country_code', c.country_code)
                       from public.coach_locations l join public.cities c on c.id = l.city_id
                      where l.coach_profile_id = p.id
                        -- the gym, then the city searched for first, then the oldest location
                      order by (l.gym_id = p_gym) desc nulls last, (c.slug = pr.city) desc nulls last, l.created_at
                      limit 1),
        'specializations', coalesce((select jsonb_agg(jsonb_build_object('slug', x.slug, 'name_en', x.name_en, 'name_ro', x.name_ro)
                                                      order by x.is_primary desc, x.sort_order)
                                       from (select s.slug, s.name_en, s.name_ro, cs.is_primary, s.sort_order
                                               from public.coach_specializations cs
                                               join public.specializations s on s.id = cs.specialization_id and s.active
                                              where cs.coach_profile_id = p.id
                                              order by cs.is_primary desc, s.sort_order limit 3) x), '[]'::jsonb),
        'specializations_total', (select count(*)::int from public.coach_specializations cs
                                   where cs.coach_profile_id = p.id),
        -- the cheapest public price, preferring the currency being browsed
        'starting_price', (select jsonb_build_object('cents', sv.price_cents, 'currency', sv.currency, 'unit', sv.price_unit)
                             from public.coach_services sv
                            where sv.coach_profile_id = p.id and sv.active and sv.price_public and sv.price_cents is not null
                            order by (sv.currency = pr.currency) desc, sv.price_cents
                            limit 1)
      ) || case when auth.uid() is null then '{}'::jsonb else jsonb_build_object(
        'user_id', p.user_id,
        'is_self', p.user_id = auth.uid(),
        'is_following', public.is_following(p.user_id),
        'follows_me', exists (select 1 from public.social_follows f
                               where f.follower_id = p.user_id and f.following_id = auth.uid()),
        'is_saved', p.saved_at is not null
      ) end order by p.ord)
      from page p cross join params pr
    ), '[]'::jsonb)
  );
$$;
revoke execute on function public.search_coaches(text, text, text, boolean, boolean, text[], int, int, int, text, boolean, text, int, int, boolean, boolean, uuid, boolean) from public;
grant execute on function public.search_coaches(text, text, text, boolean, boolean, text[], int, int, int, text, boolean, text, int, int, boolean, boolean, uuid, boolean) to anon, authenticated;

create or replace function public.coach_viewer_state(p_profile uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'is_self', cp.user_id = auth.uid(),
    'is_following', public.is_following(cp.user_id),
    'is_saved', exists (select 1 from public.coach_saves sv where sv.user_id = auth.uid() and sv.coach_profile_id = cp.id),
    'follows_me', exists (select 1 from public.social_follows f
                          where f.follower_id = cp.user_id and f.following_id = auth.uid()),
    'is_client', exists (select 1 from public.trainer_clients tc
                         where tc.coach_id = cp.user_id and tc.client_id = auth.uid() and tc.status = 'active'),
    'has_other_coach', exists (select 1 from public.trainer_clients tc
                               where tc.client_id = auth.uid() and tc.status = 'active' and tc.coach_id <> cp.user_id),
    'pending_request', (select jsonb_build_object('id', r.id, 'service_id', r.service_id, 'created_at', r.created_at)
                        from public.coaching_requests r
                        where r.client_id = auth.uid() and r.coach_id = cp.user_id and r.status = 'pending')
  )
  from public.coach_profiles cp
  join public.users u on u.id = cp.user_id
  where cp.id = p_profile
    and auth.uid() is not null
    -- the same door as coach_public_visible(): published, account live, no block
    and cp.status = 'published'
    and u.suspended_at is null
    and not exists (select 1 from public.account_deletion_requests d where d.user_id = cp.user_id)
    and not public.social_blocked_between(auth.uid(), cp.user_id);
$$;

-- ---------- 4. the reserved slug ----------
create or replace function public.coach_slug_reserved(p_slug text)
returns boolean language sql stable security definer set search_path = public as $$
  select p_slug = any (array[
           'online', 'in-person', 'near-me', 'search', 'new', 'edit', 'top', 'all',
           'apply', 'become-a-coach', 'city', 'cities', 'country', 'countries',
           'specialization', 'specializations', 'services', 'verified', 'saved'])
      or exists (select 1 from public.cities c where c.slug = p_slug)
      or exists (select 1 from public.countries c where c.slug = p_slug)
      or exists (select 1 from public.specializations s where s.slug = p_slug);
$$;
-- create or replace keeps the grants of 20261020100000 / 20261021100000.
