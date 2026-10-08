-- HealthApp schema · Coach Discovery 2.0: weighted text, new filters and sorts — same ranking layer
--
-- Still ONE ranking layer: coach_ranked() (20261110130000) is redefined, not
-- joined by a second one. Its formula (0.5·relevance + 0.5·base …) and every
-- weight of `base` are unchanged; what changes is how a text word earns its
-- relevance, two more sorts, four more filters, and a navigational rule.
--
-- 1. Where a word matches now matters. A text word used to score 1 wherever
--    it appeared, so a bio mentioning "Andrei" counted as much as a coach
--    named Andrei. The profile's text is now kept as one weighted tsvector,
--    search_wdoc, built by the same trigger as search_text:
--      A  the public name and username                     → 1.00
--      B  headline, specializations, cities / country / gym → 0.85
--      C  service names and descriptions                    → 0.70
--      D  about, approach, experience                       → 0.50
--    A near miss (a typo) is 0.40. Specializations, cities and formats read
--    from the catalogs keep their structured scores (20261110130000).
-- 2. An exact name is navigational. Typing a coach's full public name or
--    username puts that coach first under Recommended and Most relevant —
--    someone looking for a person should not have to scroll for them.
-- 3. Sorts: `relevance` is now purely the match (it was the blended score,
--    i.e. the same as recommended), `rating` is the Bayesian rating the
--    quality part already uses (5 virtual 3.5★ reviews — 5.0 from one review
--    does not top 4.9 from 150), `availability` is the soonest free public
--    slot. Every sort falls back to the score, then newest, then id.
-- 4. Filters: service kind (any active service of these kinds), language
--    (any of), minimum rating (published reviews only), available (a free
--    public slot in the next 14 days).
-- 5. Availability is a slow signal: coach_rank_signals gains next_available_at,
--    computed every 15 minutes by the existing refresh from
--    booking_slots_internal() (the same slots anyone sees). A coach published
--    since the last refresh counts as not available until the next one.
--
-- Public output: cards gain `available_soon` (a free slot within 7 days) —
-- a fact anyone can read off the booking page — and nothing else. No score,
-- part, signal or timestamp leaves coach_ranked().

-- ---------- 1. the weighted text ----------
alter table public.coach_profiles
  add column search_name text not null default '',
  add column search_wdoc tsvector;

/** One profile's searchable text in its four weight groups (A name, B what they are, C what they sell, D their story). */
create or replace function public.coach_profiles_search_parts(
  p_profile uuid, p_user uuid, p_headline text, p_about text, p_approach text, p_experience text,
  out name_part text, out primary_part text, out service_part text, out story_part text
) language sql stable security definer set search_path = public as $$
  select
    public.search_normalize(concat_ws(' ', public.public_display_name(u.username, u.full_name), u.username)),
    public.search_normalize(concat_ws(' ',
      p_headline,
      (select string_agg(s.name_en || ' ' || s.name_ro, ' ')
         from public.coach_specializations cs join public.specializations s on s.id = cs.specialization_id
        where cs.coach_profile_id = p_profile),
      (select string_agg(c.name || ' ' || coalesce(c.name_en, '') || ' ' || co.name_en || ' ' || co.name_ro
                         || ' ' || coalesce(l.gym_name, ''), ' ')
         from public.coach_locations l
         join public.cities c on c.id = l.city_id
         join public.countries co on co.code = c.country_code
        where l.coach_profile_id = p_profile))),
    public.search_normalize(coalesce((select string_agg(sv.name || ' ' || coalesce(sv.description, ''), ' ')
                                        from public.coach_services sv
                                       where sv.coach_profile_id = p_profile and sv.active), '')),
    public.search_normalize(concat_ws(' ', p_about, p_approach, p_experience))
  from public.users u where u.id = p_user;
$$;
revoke execute on function public.coach_profiles_search_parts(uuid, uuid, text, text, text, text) from public, anon, authenticated;

create or replace function public.coach_profiles_refresh_search()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v record;
begin
  select * into v from public.coach_profiles_search_parts(new.id, new.user_id, new.headline, new.about,
                                                          new.approach, new.experience_summary);
  -- search_text stays the flat haystack (phrase match, typo tolerance, pg_trgm)
  new.search_text := coalesce(concat_ws(' ', nullif(v.name_part, ''), nullif(v.primary_part, ''),
                                        nullif(v.service_part, ''), nullif(v.story_part, '')), '');
  new.search_name := coalesce(public.search_normalize(
                       (select public.public_display_name(u.username, u.full_name) from public.users u where u.id = new.user_id)), '');
  new.search_wdoc := setweight(to_tsvector('simple', coalesce(v.name_part, '')), 'A')
                  || setweight(to_tsvector('simple', coalesce(v.primary_part, '')), 'B')
                  || setweight(to_tsvector('simple', coalesce(v.service_part, '')), 'C')
                  || setweight(to_tsvector('simple', coalesce(v.story_part, '')), 'D');
  return new;
end;
$$;

-- every profile once (the BEFORE trigger rebuilds all three)
update public.coach_profiles set search_text = '';

-- ---------- 2. a word's score: where it matched ----------
create or replace function public.coach_token_score(
  p_profile uuid, p_doc tsvector, p_text text, p_online boolean, p_in_person boolean, p_tok text, p_kind text, p_ids uuid[]
) returns real language sql stable security definer set search_path = public, extensions as $$
  select (case p_kind
    when 'spec' then case
      when exists (select 1 from public.coach_specializations cs
                    where cs.coach_profile_id = p_profile and cs.specialization_id = any (p_ids) and cs.is_primary) then 1
      when exists (select 1 from public.coach_specializations cs
                    where cs.coach_profile_id = p_profile and cs.specialization_id = any (p_ids)) then 0.85
      when p_doc @@ to_tsquery('simple', p_tok || ':*') then 0.5 else 0 end
    when 'city' then case
      when exists (select 1 from public.coach_locations l where l.coach_profile_id = p_profile and l.city_id = any (p_ids)) then 1
      when p_doc @@ to_tsquery('simple', p_tok || ':*') then 0.6
      when p_online then 0.4 else 0 end
    when 'online' then case when p_online then 1 when p_doc @@ to_tsquery('simple', p_tok || ':*') then 0.5 else 0 end
    when 'in_person' then case when p_in_person then 1 when p_doc @@ to_tsquery('simple', p_tok || ':*') then 0.5 else 0 end
    when 'hybrid' then case when p_online and p_in_person then 1 when p_doc @@ to_tsquery('simple', p_tok || ':*') then 0.5 else 0 end
    -- free text: by the weight of the field it matched in (search_wdoc)
    else case when p_doc @@ to_tsquery('simple', p_tok || ':*A') then 1
              when p_doc @@ to_tsquery('simple', p_tok || ':*B') then 0.85
              when p_doc @@ to_tsquery('simple', p_tok || ':*C') then 0.7
              when p_doc @@ to_tsquery('simple', p_tok || ':*') then 0.5
              when char_length(p_tok) >= 4 and extensions.word_similarity(p_tok, coalesce(p_text, '')) >= 0.45 then 0.4
              else 0 end
  end)::real;
$$;
revoke execute on function public.coach_token_score(uuid, tsvector, text, boolean, boolean, text, text, uuid[]) from public, anon, authenticated;

-- ---------- 3. the availability signal ----------
alter table public.coach_rank_signals add column next_available_at timestamptz;

create or replace function public.coach_rank_signals_refresh(p_profile uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_n int;
begin
  if p_profile is null then
    delete from public.coach_rank_signals s
     where not exists (select 1 from public.coach_profiles cp where cp.id = s.coach_profile_id and cp.status = 'published');
  end if;

  insert into public.coach_rank_signals as t (
    coach_profile_id, completeness, credentials, verified_credentials, completed_bookings, completed_relationships,
    requests_180d, responded_48h, requests_90d, saves_90d, views_30d, last_active_at, last_public_post_at,
    has_availability, next_available_at, computed_at)
  select cp.id,
         public.coach_rank_completeness(cp.id),
         (select count(*) from public.coach_certifications ce where ce.coach_profile_id = cp.id),
         (select count(*) from public.coach_certifications ce where ce.coach_profile_id = cp.id and ce.verification_status = 'verified'),
         (select count(*) from public.bookings b where b.coach_id = cp.user_id and b.status = 'completed'),
         (select count(*) from public.trainer_clients tc
           where tc.coach_id = cp.user_id and tc.status = 'ended' and tc.started_at is not null
             and (tc.end_reason = 'goals_reached' or tc.ended_at - tc.started_at >= interval '28 days')),
         rq.n, rq.answered, rq.recent,
         (select count(*) from public.coach_saves sv where sv.coach_profile_id = cp.id and sv.created_at > now() - interval '90 days'),
         (select count(*) from public.marketplace_events e
           where e.coach_profile_id = cp.id and e.event = 'profile_view' and e.created_at > now() - interval '30 days'),
         (select au.last_sign_in_at from auth.users au where au.id = cp.user_id),
         (select max(p.created_at) from public.social_posts p
           where p.user_id = cp.user_id and p.visibility = 'public' and p.deleted_at is null),
         exists (select 1 from public.coach_availability a where a.coach_id = cp.user_id and a.active),
         -- the soonest free public slot in 14 days: what the booking page would offer anyone
         (select min(x.start_at)
            from public.coach_services s
            join public.users cu on cu.id = cp.user_id
            cross join lateral public.booking_slots_internal(
              s.id, (now() at time zone coalesce(nullif(cu.timezone, ''), 'UTC'))::date, 14, null) x
           where s.coach_profile_id = cp.id and s.active and s.bookable and s.booking_access = 'public'
             and exists (select 1 from public.coach_availability a where a.coach_id = cp.user_id and a.active)),
         now()
  from public.coach_profiles cp
  cross join lateral (
    select count(*)::int as n,
           count(*) filter (where r.status in ('accepted', 'declined') and r.resolved_at <= r.created_at + interval '48 hours')::int as answered,
           count(*) filter (where r.created_at > now() - interval '90 days')::int as recent
    from public.coaching_requests r
    where r.coach_id = cp.user_id and r.created_at > now() - interval '180 days'
      and not (r.status = 'cancelled' and r.resolved_at < r.created_at + interval '48 hours')
      and not (r.status = 'pending' and r.created_at > now() - interval '48 hours')
  ) rq
  where cp.status = 'published' and (p_profile is null or cp.id = p_profile)
  on conflict (coach_profile_id) do update set
    completeness = excluded.completeness, credentials = excluded.credentials,
    verified_credentials = excluded.verified_credentials, completed_bookings = excluded.completed_bookings,
    completed_relationships = excluded.completed_relationships, requests_180d = excluded.requests_180d,
    responded_48h = excluded.responded_48h, requests_90d = excluded.requests_90d, saves_90d = excluded.saves_90d,
    views_30d = excluded.views_30d, last_active_at = excluded.last_active_at,
    last_public_post_at = excluded.last_public_post_at, has_availability = excluded.has_availability,
    next_available_at = excluded.next_available_at, computed_at = excluded.computed_at;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke execute on function public.coach_rank_signals_refresh(uuid) from public, anon, authenticated;

-- ---------- 4. the one ranking layer, extended ----------
drop function public.search_coaches(text, text, text, boolean, boolean, text[], int, int, int, text, boolean, text, int, int, boolean, boolean, uuid, boolean);
drop function public.coach_ranked(text, text, text, boolean, boolean, text[], int, int, int, text, boolean, text, boolean, boolean, uuid, boolean);

/**
 * Every coach the search matches, in order, with the parts of the score.
 * Internal: anon and authenticated cannot call it (the parts are not
 * public); search_coaches() and admin_coach_ranking() do.
 */
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
  p_available boolean default null
) returns table (
  profile_id uuid, ord bigint, relevance real, trust real, quality real, responsiveness real, activity real,
  engagement real, cold_start real, placement real, score numeric, saved_at timestamptz, signals jsonb,
  exact_name boolean, rating_bayes real, next_available_at timestamptz
) language sql stable security definer set search_path = public, extensions as $$
  with params as (
    select case when public.coach_search_tsquery(p_query) is null then null
                else public.search_normalize(btrim(p_query)) end as q,
           nullif(lower(btrim(coalesce(p_country, ''))), '') as country,
           nullif(lower(btrim(coalesce(p_city, ''))), '') as city,
           nullif(array_remove(coalesce(p_specializations, '{}'), ''), '{}') as specs,
           nullif(array_remove(coalesce(p_service_kinds, '{}'), ''), '{}') as kinds,
           nullif(array_remove(coalesce(p_languages, '{}'), ''), '{}') as langs,
           case when p_min_rating between 1 and 5 then p_min_rating end as min_rating,
           upper(coalesce(nullif(btrim(p_currency), ''), 'RON')) as currency,
           case when p_sort in ('recommended', 'relevance', 'experience', 'followers', 'newest', 'saved', 'rating', 'availability')
                then p_sort else 'recommended' end as sort
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
                                  or public.search_normalize(coalesce(u.username, '')) = ltrim(pr.q, '@ '))) as exact_name
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
    select m.id, m.published_at, m.coaching_since, m.exact_name, m.review_count,
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
         s.score, s.saved_at, s.signals, s.exact_name, round(s.rating_bayes::numeric, 3)::real, s.next_available_at
  from scored s cross join params pr;
$$;
revoke execute on function public.coach_ranked(text, text, text, boolean, boolean, text[], int, int, int, text, boolean, text,
                                              boolean, boolean, uuid, boolean, text[], text[], numeric, boolean)
  from public, anon, authenticated;

-- ---------- 5. search_coaches: the public door ----------
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
  p_available boolean default null
) returns jsonb language sql stable security definer set search_path = public, extensions as $$
  with params as (
    select nullif(lower(btrim(coalesce(p_city, ''))), '') as city,
           upper(coalesce(nullif(btrim(p_currency), ''), 'RON')) as currency,
           -- up to 10 pages of 24: "Load more" grows one listing (lib/coach-discovery.ts)
           greatest(1, least(coalesce(p_limit, 24), 240)) as lim,
           greatest(0, least(coalesce(p_offset, 0), 1000)) as off
  ),
  ranked as (
    select r.profile_id, r.ord, r.saved_at, r.next_available_at
    from public.coach_ranked(p_query, p_country, p_city, p_online, p_in_person, p_specializations, p_min_years,
                             p_price_min, p_price_max, p_currency, p_accepting, p_sort, p_verified, p_hybrid, p_gym, p_saved,
                             p_service_kinds, p_languages, p_min_rating, p_available) r
  ),
  page as (
    select r.ord, r.saved_at, r.next_available_at, cp.id, cp.user_id, cp.slug, cp.headline, cp.online, cp.in_person,
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
        'location', (select jsonb_build_object('city', c.name, 'city_en', coalesce(c.name_en, c.name),
                                               'country_code', c.country_code)
                       from public.coach_locations l join public.cities c on c.id = l.city_id
                      where l.coach_profile_id = p.id
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
revoke execute on function public.search_coaches(text, text, text, boolean, boolean, text[], int, int, int, text, boolean, text, int, int,
                                                 boolean, boolean, uuid, boolean, text[], text[], numeric, boolean) from public;
grant execute on function public.search_coaches(text, text, text, boolean, boolean, text[], int, int, int, text, boolean, text, int, int,
                                                boolean, boolean, uuid, boolean, text[], text[], numeric, boolean) to anon, authenticated;

-- ---------- 6. the admin's inspector: same layer, by name ----------
create or replace function public.admin_coach_ranking(
  p_query text default null, p_city text default null, p_specializations text[] default null,
  p_online boolean default null, p_in_person boolean default null, p_profile uuid default null, p_limit int default 50
) returns table (
  ord bigint, profile_id uuid, slug text, display_name text, verified boolean, relevance real, trust real,
  quality real, responsiveness real, activity real, engagement real, cold_start real, placement real,
  score numeric, signals jsonb
) language plpgsql stable security definer set search_path = public as $$
begin
  perform public.admin_assert();
  return query
  select r.ord, r.profile_id, cp.slug, public.public_display_name(u.username, u.full_name),
         cp.verification_status = 'verified', r.relevance, r.trust, r.quality, r.responsiveness, r.activity,
         r.engagement, r.cold_start, r.placement, r.score, r.signals
  from public.coach_ranked(p_query => p_query, p_city => p_city, p_online => p_online, p_in_person => p_in_person,
                           p_specializations => p_specializations, p_accepting => false) r
  join public.coach_profiles cp on cp.id = r.profile_id
  join public.users u on u.id = cp.user_id
  where p_profile is null or r.profile_id = p_profile
  order by r.ord
  limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

-- ---------- 7. facets: languages, service kinds, and counts per specialization ----------
create or replace function public.coach_discovery_facets()
returns jsonb language sql stable security definer set search_path = public as $$
  with live as (
    select cp.id from public.coach_profiles cp join public.users u on u.id = cp.user_id
    where cp.status = 'published' and u.suspended_at is null
      and not exists (select 1 from public.account_deletion_requests d where d.user_id = cp.user_id)
  )
  select jsonb_build_object(
    -- every active specialization (the filter lists them all); `coaches` = published coaches with it
    'specializations', coalesce((select jsonb_agg(jsonb_build_object('slug', s.slug, 'name_en', s.name_en, 'name_ro', s.name_ro,
                                                                     'coaches', (select count(*)::int from public.coach_specializations cs
                                                                                  join live on live.id = cs.coach_profile_id
                                                                                 where cs.specialization_id = s.id))
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
                                 group by c.id) x), '[]'::jsonb),
    'gyms', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'city', x.city,
                                                          'coaches', x.n) order by x.name)
                        from (select g.id, g.name, min(c.slug) city, count(distinct l.coach_profile_id)::int n
                                from public.gyms g
                                join public.coach_locations l on l.gym_id = g.id
                                join public.cities c on c.id = l.city_id
                                join live on live.id = l.coach_profile_id
                               where g.status = 'active'
                               group by g.id) x), '[]'::jsonb),
    -- only languages some published coach speaks: a filter that can only return nothing is noise
    'languages', coalesce((select jsonb_agg(jsonb_build_object('code', x.code, 'name_en', x.name_en, 'name_ro', x.name_ro,
                                                               'native_name', x.native_name, 'coaches', x.n) order by x.sort_order)
                             from (select l.code, l.name_en, l.name_ro, l.native_name, l.sort_order,
                                          count(distinct cl.coach_profile_id)::int n
                                     from public.languages l
                                     join public.coach_languages cl on cl.language_code = l.code
                                     join live on live.id = cl.coach_profile_id
                                    group by l.code) x), '[]'::jsonb),
    'service_kinds', coalesce((select jsonb_agg(jsonb_build_object('kind', x.kind, 'coaches', x.n) order by x.kind)
                                 from (select sv.kind, count(distinct sv.coach_profile_id)::int n
                                         from public.coach_services sv
                                         join live on live.id = sv.coach_profile_id
                                        where sv.active
                                        group by sv.kind) x), '[]'::jsonb)
  );
$$;

-- refill the signals with the new column
select public.coach_rank_signals_refresh();
