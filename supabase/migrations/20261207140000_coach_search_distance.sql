-- Coach search by distance: "near me" (2026-12-07)
--
-- Until now Discovery matched a place only by name (a city slug, a gym). A
-- reader may now hand search_coaches() a point — their phone's location, asked
-- in the browser and sent only with this one query, never stored — plus an
-- optional radius:
--
--   p_near_lat / p_near_lng   the reader's point (both or neither)
--   p_radius_km               1..500; only coaches with a place within it
--   p_sort = 'distance'       nearest first
--
-- A coach's distance is to the nearest place they work (coach_locations): the
-- gym's pin when the location names a gym with coordinates, else the city's
-- centre (cities.latitude / longitude) — coarse on purpose, never a home
-- address, because coaches never give one. A card carries 'distance_km'
-- (one decimal) only when a point was sent.
--
-- coach_ranked() stays the one ranking layer: its formula and weights are
-- untouched; the new arguments are trailing defaults, so every existing call
-- (search_coaches, admin_coach_ranking) resolves as before. Both functions are
-- dropped and recreated (new arguments), with their grants.

create or replace function public.coach_distance_km(p_profile uuid, p_lat numeric, p_lng numeric)
returns real language sql stable security definer set search_path = public as $$
  select min(
           -- haversine on a 6371 km sphere; plenty for "which coach is closer"
           2 * 6371 * asin(least(1, sqrt(
             power(sin(radians((pt.lat - p_lat::float8) / 2)), 2)
             + cos(radians(p_lat::float8)) * cos(radians(pt.lat))
               * power(sin(radians((pt.lng - p_lng::float8) / 2)), 2)))))::real
    from (select coalesce(g.lat, c.latitude::float8) as lat, coalesce(g.lng, c.longitude::float8) as lng
            from public.coach_locations l
            join public.cities c on c.id = l.city_id
            left join public.gyms g on g.id = l.gym_id and g.lat is not null and g.lng is not null
           where l.coach_profile_id = p_profile) pt
   where pt.lat is not null and pt.lng is not null;
$$;
revoke execute on function public.coach_distance_km(uuid, numeric, numeric) from public, anon, authenticated;

drop function public.search_coaches(text, text, text, boolean, boolean, text[], int, int, int, text, boolean, text, int, int,
                                    boolean, boolean, uuid, boolean, text[], text[], numeric, boolean);
drop function public.coach_ranked(text, text, text, boolean, boolean, text[], int, int, int, text, boolean, text,
                                  boolean, boolean, uuid, boolean, text[], text[], numeric, boolean);

create or replace function public.coach_ranked(
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
  p_verified boolean default null,
  p_hybrid boolean default null,
  p_gym uuid default null,
  p_saved boolean default null,
  p_service_kinds text[] default null,
  p_languages text[] default null,
  p_min_rating numeric default null,
  p_available boolean default null,
  p_near_lat numeric default null,
  p_near_lng numeric default null,
  p_radius_km int default null
) returns table (
  profile_id uuid, ord bigint, relevance real, trust real, quality real, responsiveness real, activity real,
  engagement real, cold_start real, placement real, score numeric, saved_at timestamptz, signals jsonb,
  exact_name boolean, rating_bayes real, next_available_at timestamptz, distance_km real
) language sql stable security definer set search_path = public, extensions as $$
  with params as (
    select case when public.coach_search_tsquery(p_query) is null then null
                else public.search_normalize(btrim(p_query)) end as q,
           nullif(lower(btrim(coalesce(p_country, ''))), '') as country,
           nullif(lower(btrim(coalesce(p_city, ''))), '') as city,
           -- a discipline includes its styles (20261116100000): Yoga finds a Vinyasa-only coach
           public.specialization_slugs_expand(nullif(array_remove(coalesce(p_specializations, '{}'), ''), '{}')) as specs,
           nullif(array_remove(coalesce(p_service_kinds, '{}'), ''), '{}') as kinds,
           nullif(array_remove(coalesce(p_languages, '{}'), ''), '{}') as langs,
           case when p_min_rating between 1 and 5 then p_min_rating end as min_rating,
           upper(coalesce(nullif(btrim(p_currency), ''), 'RON')) as currency,
           case when p_sort in ('recommended', 'relevance', 'experience', 'followers', 'newest', 'saved', 'rating', 'availability', 'distance')
                then p_sort else 'recommended' end as sort,
           -- a point the reader chose ("near me"): used only for this query, never stored
           case when p_near_lat between -90 and 90 and p_near_lng between -180 and 180 then p_near_lat end as near_lat,
           case when p_near_lat between -90 and 90 and p_near_lng between -180 and 180 then p_near_lng end as near_lng,
           case when p_radius_km is not null then greatest(1, least(p_radius_km, 500)) end as radius
  ),
  qt as (
    select t.tok, t.kind, t.ids from public.coach_query_tokens(p_query) t cross join params pr
    where pr.q is not null and t.kind <> 'stop'
  ),
  matched as (
    select cp.id, cp.user_id, cp.online, cp.in_person, cp.accepting_clients, cp.published_at, cp.coaching_since,
           cp.search_wdoc, cp.search_text, cp.verification_status, cp.review_count, cp.review_avg,
           -- the whole query is this coach's public name or username: they are what was looked for
           (pr.q is not null and (cp.search_name = pr.q
                                  or public.search_normalize(coalesce(u.username, '')) = ltrim(pr.q, '@ '))) as exact_name,
           -- km to the nearest place the coach works: their gym's pin, else the city's centre
           case when pr.near_lat is not null then public.coach_distance_km(cp.id, pr.near_lat, pr.near_lng) end as distance_km
    from public.coach_profiles cp
    join public.users u on u.id = cp.user_id
    cross join params pr
    where cp.status = 'published'
      and u.suspended_at is null
      and not exists (select 1 from public.account_deletion_requests d where d.user_id = cp.user_id)
      and not public.social_blocked_between(auth.uid(), cp.user_id)
      -- text: every meaningful word answered (structure, text or a near miss), or the phrase as typed
      and (pr.q is null
           or not exists (select 1 from qt
                           where public.coach_token_score(cp.id, cp.search_wdoc, cp.search_text, cp.online, cp.in_person, qt.tok, qt.kind, qt.ids) <= 0)
           or cp.search_text like '%' || pr.q || '%')
      and (p_accepting is not true or cp.accepting_clients)
      and (p_verified is not true or cp.verification_status = 'verified')
      and (p_hybrid is not true or (cp.online and cp.in_person))
      and (p_saved is not true or exists (
            select 1 from public.coach_saves sv where sv.user_id = auth.uid() and sv.coach_profile_id = cp.id))
      and (p_gym is null or exists (
            select 1 from public.coach_locations l where l.coach_profile_id = cp.id and l.gym_id = p_gym))
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
      and (pr.kinds is null or exists (
            select 1 from public.coach_services sv where sv.coach_profile_id = cp.id and sv.active and sv.kind = any (pr.kinds)))
      and (pr.langs is null or exists (
            select 1 from public.coach_languages cl where cl.coach_profile_id = cp.id and cl.language_code = any (pr.langs)))
      and (pr.min_rating is null or (cp.review_count > 0 and cp.review_avg >= pr.min_rating))
      and (p_available is not true or exists (
            select 1 from public.coach_rank_signals sg
            where sg.coach_profile_id = cp.id and sg.next_available_at < now() + interval '14 days'))
      and (pr.radius is null or pr.near_lat is null
           or public.coach_distance_km(cp.id, pr.near_lat, pr.near_lng) <= pr.radius)
      and (p_min_years is null or p_min_years <= 0
           or (cp.coaching_since is not null
               and cp.coaching_since <= extract(year from now())::int - p_min_years))
      and (p_price_min is null and p_price_max is null or exists (
            select 1 from public.coach_services sv
            where sv.coach_profile_id = cp.id and sv.active and sv.price_public
              and sv.price_cents is not null and sv.currency = pr.currency
              and sv.price_cents >= coalesce(p_price_min, 0)
              and sv.price_cents <= coalesce(p_price_max, 2147483647)))
  ),
  rel as (
    select m.id,
           -- the query: the mean of its words, +0.1 when the whole phrase appears as typed
           case when pr.q is null or not exists (select 1 from qt) then null
                else least(1,
                       (select avg(public.coach_token_score(m.id, m.search_wdoc, m.search_text, m.online, m.in_person, qt.tok, qt.kind, qt.ids)) from qt)
                     + case when (select count(*) from qt) > 1 and m.search_text like '%' || pr.q || '%' then 0.1 else 0 end)
           end as q_rel,
           -- a specialization filter: the coach's primary one counts most
           case when pr.specs is null then null
                when exists (select 1 from public.coach_specializations cs join public.specializations s on s.id = cs.specialization_id
                              where cs.coach_profile_id = m.id and cs.is_primary and s.slug = any (pr.specs)) then 1
                else 0.85 end as s_rel
    from matched m cross join params pr
  ),
  parts as (
    select m.id, m.published_at, m.coaching_since, m.exact_name, m.review_count, m.distance_km,
           case when r.q_rel is null and r.s_rel is null then null
                else ((coalesce(r.q_rel, 0) + coalesce(r.s_rel, 0))
                      / ((r.q_rel is not null)::int + (r.s_rel is not null)::int)) end as relevance,
           0.55 * (m.verification_status = 'verified')::int
           + 0.30 * coalesce(sg.completeness, public.coach_rank_completeness(m.id)) / 5.0
           + 0.15 * case when coalesce(sg.verified_credentials, 0) > 0 then 1 when coalesce(sg.credentials, 0) > 0 then 0.4 else 0 end
             as trust,
           -- the Bayesian rating: 5 virtual 3.5-star reviews
           (5 * 3.5 + m.review_count * coalesce(m.review_avg, 0)) / (5 + m.review_count) as rating_bayes,
           0.7 * (((5 * 3.5 + m.review_count * coalesce(m.review_avg, 0)) / (5 + m.review_count)) - 1) / 4.0
           + 0.3 * (1 - exp(-(coalesce(sg.completed_bookings, 0) + 2 * coalesce(sg.completed_relationships, 0)) / 8.0))
             as quality,
           (coalesce(sg.responded_48h, 0) + 3 * 0.7) / (coalesce(sg.requests_180d, 0) + 3.0) as responsiveness,
           0.4 * case when sg.last_active_at > now() - interval '14 days' then 1
                      when sg.last_active_at > now() - interval '30 days' then 0.6
                      when sg.last_active_at > now() - interval '90 days' then 0.3 else 0 end
           + 0.2 * case when sg.last_public_post_at > now() - interval '30 days' then 1
                        when sg.last_public_post_at > now() - interval '90 days' then 0.5 else 0 end
           + 0.2 * m.accepting_clients::int
           + 0.2 * coalesce(sg.has_availability, false)::int as activity,
           1 - exp(-(coalesce(sg.saves_90d, 0) + 2 * coalesce(sg.requests_90d, 0) + coalesce(sg.views_30d, 0) / 10.0) / 15.0)
             as engagement,
           case when m.published_at > now() - interval '45 days'
                 and (coalesce(sg.completeness, public.coach_rank_completeness(m.id)) >= 4 or m.verification_status = 'verified')
                then 0.06 * (1 - extract(epoch from now() - m.published_at) / extract(epoch from interval '45 days'))
                else 0 end as cold_start,
           0::numeric as placement,
           (select sv.created_at from public.coach_saves sv where sv.user_id = auth.uid() and sv.coach_profile_id = m.id) as saved_at,
           case when sg.coach_profile_id is null then null else to_jsonb(sg) - 'coach_profile_id' end as signals,
           sg.next_available_at,
           m.user_id
    from matched m
    join rel r on r.id = m.id
    left join public.coach_rank_signals sg on sg.coach_profile_id = m.id
  ),
  scored as (
    select p.*,
           round((case when p.relevance is null then 0 else 0.5 * p.relevance end
                  + (case when p.relevance is null then 1 else 0.5 end)
                    * (0.30 * p.trust + 0.30 * p.quality + 0.15 * p.responsiveness + 0.15 * p.activity + 0.10 * p.engagement)
                  + p.cold_start + p.placement)::numeric, 4) as score
    from parts p
  )
  select s.id,
         row_number() over (order by
           -- navigational: the coach whose name was typed, first (never in the pure sorts below)
           case when pr.sort in ('recommended', 'relevance') then s.exact_name end desc nulls last,
           case when pr.sort = 'saved' then s.saved_at end desc nulls last,
           case when pr.sort = 'relevance' then s.relevance end desc nulls last,
           case when pr.sort = 'rating' then s.rating_bayes end desc nulls last,
           case when pr.sort = 'rating' then s.review_count end desc nulls last,
           case when pr.sort = 'availability' then s.next_available_at end asc nulls last,
           case when pr.sort = 'distance' then s.distance_km end asc nulls last,
           case when pr.sort = 'experience' then s.coaching_since end asc nulls last,
           case when pr.sort = 'followers' then (
             select count(*) from public.social_follows f join public.users fu on fu.id = f.follower_id
              where f.following_id = s.user_id and fu.suspended_at is null
                and not exists (select 1 from public.account_deletion_requests d where d.user_id = fu.id)) end desc nulls last,
           case when pr.sort = 'newest' then s.published_at end desc nulls last,
           s.score desc, s.published_at desc nulls last, s.id),
         round(s.relevance::numeric, 3)::real, round(s.trust::numeric, 3)::real, round(s.quality::numeric, 3)::real,
         round(s.responsiveness::numeric, 3)::real, round(s.activity::numeric, 3)::real,
         round(s.engagement::numeric, 3)::real, round(s.cold_start::numeric, 3)::real, s.placement::real,
         s.score, s.saved_at, s.signals, s.exact_name, round(s.rating_bayes::numeric, 3)::real, s.next_available_at,
         round(s.distance_km::numeric, 1)::real
  from scored s cross join params pr;
$$;

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
  p_offset int default 0,
  p_verified boolean default null,
  p_hybrid boolean default null,
  p_gym uuid default null,
  p_saved boolean default null,
  p_service_kinds text[] default null,
  p_languages text[] default null,
  p_min_rating numeric default null,
  p_available boolean default null,
  p_near_lat numeric default null,
  p_near_lng numeric default null,
  p_radius_km int default null
) returns jsonb language sql stable security definer set search_path = public, extensions as $$
  with params as (
    select nullif(lower(btrim(coalesce(p_city, ''))), '') as city,
           upper(coalesce(nullif(btrim(p_currency), ''), 'RON')) as currency,
           -- up to 10 pages of 24: "Load more" grows one listing (lib/coach-discovery.ts)
           greatest(1, least(coalesce(p_limit, 24), 240)) as lim,
           greatest(0, least(coalesce(p_offset, 0), 1000)) as off
  ),
  ranked as (
    select r.profile_id, r.ord, r.saved_at, r.next_available_at, r.distance_km
    from public.coach_ranked(p_query, p_country, p_city, p_online, p_in_person, p_specializations, p_min_years,
                             p_price_min, p_price_max, p_currency, p_accepting, p_sort, p_verified, p_hybrid, p_gym, p_saved,
                             p_service_kinds, p_languages, p_min_rating, p_available,
                             p_near_lat, p_near_lng, p_radius_km) r
  ),
  page as (
    select r.ord, r.saved_at, r.next_available_at, r.distance_km, cp.id, cp.user_id, cp.slug, cp.headline, cp.online, cp.in_person,
           cp.coaching_since, cp.accepting_clients, cp.verification_status = 'verified' as verified, cp.review_count, cp.review_avg,
           u.username, u.full_name, u.avatar_url,
           (select count(*)::int from public.social_follows f
              join public.users fu on fu.id = f.follower_id
             where f.following_id = cp.user_id and fu.suspended_at is null
               and not exists (select 1 from public.account_deletion_requests d where d.user_id = fu.id)) as followers
    from ranked r
    join public.coach_profiles cp on cp.id = r.profile_id
    join public.users u on u.id = cp.user_id
    cross join params pr
    where r.ord > pr.off and r.ord <= pr.off + pr.lim
  )
  select jsonb_build_object(
    'total', (select count(*)::int from ranked),
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
        'rating', case when p.review_count > 0
                       then jsonb_build_object('average', p.review_avg, 'count', p.review_count) end,
        -- a fact the booking page shows anyone; never the timestamp, never a score
        'available_soon', coalesce(p.next_available_at < now() + interval '7 days', false),
        -- only when the reader asked "near me": km to the coach's gym or city, rounded
        'distance_km', p.distance_km,
        'location', (select jsonb_build_object('city', c.name, 'city_en', coalesce(c.name_en, c.name),
                                               'country_code', c.country_code)
                       from public.coach_locations l join public.cities c on c.id = l.city_id
                      where l.coach_profile_id = p.id
                      order by (l.gym_id = p_gym) desc nulls last, (c.slug = pr.city) desc nulls last, l.created_at
                      limit 1),
        'specializations', coalesce((select jsonb_agg(jsonb_build_object('slug', x.slug, 'name_en', x.name_en, 'name_ro', x.name_ro,
                                                                         'is_primary', x.is_primary)
                                                      order by x.is_primary desc, x.sort_order)
                                       from (select s.slug, s.name_en, s.name_ro, cs.is_primary, s.sort_order
                                               from public.coach_specializations cs
                                               join public.specializations s on s.id = cs.specialization_id and s.active
                                              where cs.coach_profile_id = p.id
                                              order by cs.is_primary desc, s.sort_order limit 3) x), '[]'::jsonb),
        -- the same set the list above draws from: a retired specialization is not a "+1"
        'specializations_total', (select count(*)::int from public.coach_specializations cs
                                   join public.specializations s on s.id = cs.specialization_id and s.active
                                   where cs.coach_profile_id = p.id),
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

revoke execute on function public.coach_ranked(text, text, text, boolean, boolean, text[], int, int, int, text, boolean, text,
                                              boolean, boolean, uuid, boolean, text[], text[], numeric, boolean,
                                              numeric, numeric, int)
  from public, anon, authenticated;

revoke execute on function public.search_coaches(text, text, text, boolean, boolean, text[], int, int, int, text, boolean, text, int, int,
                                                 boolean, boolean, uuid, boolean, text[], text[], numeric, boolean,
                                                 numeric, numeric, int) from public;
grant execute on function public.search_coaches(text, text, text, boolean, boolean, text[], int, int, int, text, boolean, text, int, int,
                                                boolean, boolean, uuid, boolean, text[], text[], numeric, boolean,
                                                numeric, numeric, int) to anon, authenticated;
