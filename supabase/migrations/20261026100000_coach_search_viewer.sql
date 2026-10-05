-- HealthApp schema · Coach Discovery: who the signed-in reader is to each card
--
-- The Discovery Home (/coaches) puts a Follow button on every coach card. The
-- button needs the coach's user id and whether the reader already follows
-- them; search_coaches() (20261022100000) returned neither, so a card could
-- only link to the profile.
--
-- This adds four keys to each item, for a SIGNED-IN caller only — the same
-- rule coach_public_profile() (20261021100000) applies to user_id:
--   user_id       the coach's account (the follow target)
--   is_self       the reader is this coach (no Follow on your own card)
--   is_following  public.is_following(), as the profile page uses
--   follows_me    the coach follows the reader ("Follow back")
-- An anonymous caller gets exactly the cards it got before: no user_id, no
-- viewer keys. Otherwise the body is 20261022100000's.
--
-- Also: search_text carries the gym names of a coach's locations
-- (coach_locations.gym_name — the gym's own name when gym_id is set, shown on
-- the public page already), so "Search coaches, specialties, gyms…" means it.
-- coach_locations already touches the profile on every change (the
-- coach_locations_search trigger); every row is rebuilt once here.

-- ---------- 1. gym names in the search text ----------
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
    (select string_agg(c.name || ' ' || coalesce(c.name_en, '') || ' ' || co.name_en || ' ' || co.name_ro
                       || ' ' || coalesce(l.gym_name, ''), ' ')
       from public.coach_locations l
       join public.cities c on c.id = l.city_id
       join public.countries co on co.code = c.country_code
      where l.coach_profile_id = p_profile),
    (select string_agg(sv.name, ' ')
       from public.coach_services sv
      where sv.coach_profile_id = p_profile and sv.active)
  ))
  from public.users u where u.id = p_user;
$$;
revoke execute on function public.coach_profiles_search_text(uuid, uuid, text, text) from public, anon, authenticated;

-- rebuild every row once (the BEFORE trigger recomputes search_text)
update public.coach_profiles set search_text = '';

-- ---------- 2. search_coaches: the viewer keys ----------

create or replace function public.search_coaches(
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
  p_offset int default 0
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
           case when p_sort in ('recommended', 'relevance', 'experience', 'followers', 'newest')
                then p_sort else 'recommended' end as sort,
           -- up to 10 pages of 24: "Load more" grows one listing (lib/coach-discovery.ts)
           greatest(1, least(coalesce(p_limit, 24), 240)) as lim,
           greatest(0, least(coalesce(p_offset, 0), 1000)) as off
  ),
  matched as (
    select cp.id, cp.user_id, cp.slug, cp.headline, cp.about, cp.cover_url, cp.coaching_since,
           cp.accepting_clients, cp.online, cp.in_person, cp.published_at, cp.search_doc, cp.search_text,
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
           exists (select 1 from public.coach_verifications v where v.coach_profile_id = m.id and v.status = 'verified') as verified,
           (select count(*)::int from public.social_follows f
              join public.users fu on fu.id = f.follower_id
             where f.following_id = m.user_id and fu.suspended_at is null) as followers,
           case when pr.q is null then 0::real
                else coalesce(ts_rank(m.search_doc, pr.tsq), 0) + extensions.word_similarity(pr.q, m.search_text) end as relevance
    from matched m cross join params pr
  ),
  ranked as (
    -- the order, computed once: the page is a slice of it, and the items keep it
    select s.*, row_number() over (order by
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
                        -- the city searched for first, then the oldest location
                      order by (c.slug = pr.city) desc nulls last, l.created_at
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
                               where f.follower_id = p.user_id and f.following_id = auth.uid())
      ) end order by p.ord)
      from page p cross join params pr
    ), '[]'::jsonb)
  );
$$;
-- create or replace keeps the grants of 20261022100000 (anon + authenticated).
