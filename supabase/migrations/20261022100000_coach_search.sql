-- HealthApp schema · Coach Discovery: search (/coaches)
--
-- The listing page needs one read that returns a page of coach cards, already
-- filtered and ordered, for anyone — anonymous visitors included. Same rule
-- as the other Coach Discovery doors (20261020100000, 20261021100000): a
-- security definer function with a fixed output, published profiles only,
-- public fields only.
--
-- 1. search_text also carries the country (both languages), so "romania" or
--    "românia" finds a coach in Cluj. Every row is rebuilt once here, and a
--    renamed country reaches its coaches like a renamed city does.
--
-- 2. coach_search_tsquery(text): the typed words, normalised (lower +
--    unaccent), each a prefix match, all required: "hiper cluj" →
--    'hiper':* & 'cluj':*. Only [a-z0-9] tokens reach to_tsquery, so nothing
--    typed can be tsquery syntax.
--
-- 3. search_coaches(...): a coach matches the text when every word prefixes
--    something in search_text (the tsvector), or the phrase appears as typed,
--    or it is close enough for a typo (pg_trgm word_similarity ≥ 0.45).
--    Filters: country, city (a coach location there), format (online / in
--    person — either of the ticked ones), specializations (any of the ticked
--    ones), minimum years of experience (from coaching_since), price range
--    (only active services with price_public, in one currency — RON by
--    default; a private price never takes part), accepting clients.
--
--    Order. "recommended" is deterministic and explainable, nothing more:
--      accepting clients first, then profile completeness (cover photo,
--      an About of 200+ characters, a certification, a language, a public
--      price — 0..5), then verified, then text relevance, then followers,
--      then the newest. rank_score is NOT used: nothing writes it yet (it is
--      0 everywhere), so it would rank nothing.
--    The other sorts — relevance, experience, followers, newest — put their
--    key first and fall back to that same order.
--
--    One call returns { total, items } — each item is a card's fields,
--    computed for the page rows only (24 by default). limit / offset, the
--    repo's convention (discover_programs, social_search_users).
--
-- 4. coach_discovery_facets(): what the filters offer — active
--    specializations, and the countries / cities that have at least one
--    published coach, with counts.
--
-- Indexes: the ones this needs already exist (20261020100000) — status,
-- slug, the published-only (accepting, online, in_person) index, the GIN on
-- search_doc and the trigram GIN on search_text, coach_locations(city_id),
-- coach_specializations(specialization_id), coach_services(coach_profile_id,
-- …), cities(country_code). None is added.

-- ---------- 1. country in the search text ----------
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
    (select string_agg(c.name || ' ' || coalesce(c.name_en, '') || ' ' || co.name_en || ' ' || co.name_ro, ' ')
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

create or replace function public.coach_reference_touch_search()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'specializations' then
    update public.coach_profiles set search_text = ''
     where id in (select coach_profile_id from public.coach_specializations where specialization_id = new.id);
  elsif tg_table_name = 'cities' then
    update public.coach_profiles set search_text = ''
     where id in (select coach_profile_id from public.coach_locations where city_id = new.id);
  elsif tg_table_name = 'countries' then
    update public.coach_profiles set search_text = ''
     where id in (select l.coach_profile_id from public.coach_locations l
                  join public.cities c on c.id = l.city_id where c.country_code = new.code);
  else
    update public.coach_profiles set search_text = '' where user_id = new.id;
  end if;
  return null;
end;
$$;
create trigger countries_search after update of name_en, name_ro on public.countries
  for each row execute function public.coach_reference_touch_search();

-- rebuild every row once (the BEFORE trigger recomputes search_text)
update public.coach_profiles set search_text = '';

-- ---------- 2. the typed words as a prefix query ----------
create or replace function public.coach_search_tsquery(p_query text)
returns tsquery language sql immutable parallel safe set search_path = public, extensions as $$
  select case when count(*) = 0 then null
              else to_tsquery('simple'::regconfig, string_agg(tok || ':*', ' & ' order by n)) end
  from regexp_split_to_table(public.search_normalize(coalesce(p_query, '')), '[^a-z0-9]+') with ordinality as t(tok, n)
  where tok <> '';
$$;

-- ---------- 3. the search ----------
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
      ) order by p.ord)
      from page p cross join params pr
    ), '[]'::jsonb)
  );
$$;

-- ---------- 4. what the filters offer ----------
create or replace function public.coach_discovery_facets()
returns jsonb language sql stable security definer set search_path = public as $$
  with live as (
    select cp.id from public.coach_profiles cp join public.users u on u.id = cp.user_id
    where cp.status = 'published' and u.suspended_at is null
      and not exists (select 1 from public.account_deletion_requests d where d.user_id = cp.user_id)
  )
  select jsonb_build_object(
    'specializations', coalesce((select jsonb_agg(jsonb_build_object('slug', s.slug, 'name_en', s.name_en, 'name_ro', s.name_ro)
                                                  order by s.sort_order)
                                   from public.specializations s where s.active), '[]'::jsonb),
    'countries', coalesce((select jsonb_agg(jsonb_build_object('code', x.code, 'slug', x.slug, 'name_en', x.name_en,
                                                               'name_ro', x.name_ro, 'coaches', x.n) order by x.name_en)
                             from (select co.code, co.slug, co.name_en, co.name_ro, count(distinct l.coach_profile_id)::int n
                                     from public.countries co
                                     join public.cities c on c.country_code = co.code
                                     join public.coach_locations l on l.city_id = c.id
                                     join live on live.id = l.coach_profile_id
                                    group by co.code) x), '[]'::jsonb),
    'cities', coalesce((select jsonb_agg(jsonb_build_object('slug', x.slug, 'name', x.name, 'name_en', x.name_en,
                                                            'country_code', x.country_code, 'coaches', x.n) order by x.name)
                          from (select c.slug, c.name, coalesce(c.name_en, c.name) name_en, c.country_code,
                                       count(distinct l.coach_profile_id)::int n
                                  from public.cities c
                                  join public.coach_locations l on l.city_id = c.id
                                  join live on live.id = l.coach_profile_id
                                 group by c.id) x), '[]'::jsonb)
  );
$$;

-- ---------- grants ----------
revoke execute on function public.coach_search_tsquery(text) from public, anon, authenticated;
revoke execute on function public.search_coaches(text, text, text, boolean, boolean, text[], int, int, int, text, boolean, text, int, int) from public;
grant execute on function public.search_coaches(text, text, text, boolean, boolean, text[], int, int, int, text, boolean, text, int, int) to anon, authenticated;
revoke execute on function public.coach_discovery_facets() from public;
grant execute on function public.coach_discovery_facets() to anon, authenticated;
