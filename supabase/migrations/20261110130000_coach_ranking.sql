-- HealthApp schema · Coach Discovery ranking: one explainable, organic order
--
-- Before: search_coaches() ordered "recommended" by accepting clients →
-- completeness → verified → text relevance → followers. Text had to match
-- word for word ("online coaching" found only coaches who wrote "online"
-- somewhere), reviews were on the card but not in the order, and followers
-- — raw popularity — broke ties.
--
-- Now there is ONE ranking layer, coach_ranked(), which search_coaches()
-- (and so /coaches, its city and specialization listings, the Discovery
-- Home rows and saved coaches) and the admin inspector call. It returns the
-- order AND its parts, so any position can be explained; the public RPC
-- returns only the order — never a score.
--
--   score = 0.5·relevance + 0.5·base + cold_start + placement   (a query or a specialization filter)
--   score =              base + cold_start + placement          (no context)
--   base  = 0.30·trust + 0.30·quality + 0.15·responsiveness + 0.15·activity + 0.10·engagement
--
-- Every part is 0..1. With context, relevance carries half the weight, so a
-- verified coach (trust +0.55 → score +0.08) cannot overtake a clearly more
-- relevant one (a primary-specialization match against a text-only mention
-- is +0.25), but wins between equally relevant coaches.
--
--   relevance       the query read as structure first: a word naming a
--                   specialization (primary 1, listed 0.85, only in the text
--                   0.5), a city (located there 1, mentions it 0.6, online
--                   coach elsewhere 0.4 — online coaches serve everywhere,
--                   unrelated locations are not matched at all), a format
--                   (online / in person / hybrid: offers it 1, mentions it
--                   0.5); any other word must match the text (prefix 1, a
--                   typo 0.7). Every word must be answered — no phrase-level
--                   fuzziness that lets one word of two carry a query. No
--                   distances: the database has no coordinates.
--   trust           0.55 Voinic Verified + 0.30 completeness (of 5) +
--                   0.15 credentials (an admin-verified one 1, any 0.4)
--   quality         0.7 rating + 0.3 outcomes. Rating is Bayesian: the
--                   average pulled towards a neutral 3.5 by 5 virtual reviews,
--                   so 5.0 from 1 review (3.75) ranks below 4.9 from 150
--                   (4.86); no reviews is neutral, not zero. Outcomes =
--                   1 − e^(−(completed bookings + 2·completed coachings)/8).
--   responsiveness  share of requests answered within 48 h (180 days),
--                   shrunk towards 0.7 by 3 virtual requests
--   activity        signed in lately (0.4), a public post lately (0.2),
--                   accepting clients (0.2), weekly availability set (0.2)
--   engagement      1 − e^(−(saves 90 d + 2·requests 90 d + views 30 d/10)/15),
--                   weight 0.10 and saturating: popularity can never dominate
--   cold_start      a newly published, qualified coach (completeness ≥ 4 or
--                   verified): up to +0.06, fading to 0 over 45 days. Plus
--                   the neutral priors above, so "no history" is never "bad".
--   placement       always 0. Sponsored placement, when payments exist, is a
--                   separate, labelled lane here — it must never be folded
--                   into the organic weights.
--
-- Deterministic: no randomness; ties go to the newer profile, then the id,
-- and pages are slices of one row_number() — no coach on two pages.
--
-- Performance: the slow-moving counts (bookings, coachings, requests, saves,
-- views, last sign-in, last post, availability, completeness) are
-- aggregated per coach into coach_rank_signals every 15 minutes (pg_cron)
-- instead of being re-counted for every coach on every search — the
-- Discovery Home alone runs three searches. A search joins one row per
-- coach; ratings were already columns (20261106100000). A coach published
-- since the last refresh has no row yet: completeness is computed live for
-- them, everything else takes its neutral default.

-- ---------- 1. the signals ----------
create table public.coach_rank_signals (
  coach_profile_id uuid primary key references public.coach_profiles (id) on delete cascade,
  completeness smallint not null default 0,
  credentials int not null default 0,
  verified_credentials int not null default 0,
  completed_bookings int not null default 0,
  completed_relationships int not null default 0,
  requests_180d int not null default 0,
  responded_48h int not null default 0,
  requests_90d int not null default 0,
  saves_90d int not null default 0,
  views_30d int not null default 0,
  last_active_at timestamptz,
  last_public_post_at timestamptz,
  has_availability boolean not null default false,
  computed_at timestamptz not null default now()
);
alter table public.coach_rank_signals enable row level security;
revoke all on table public.coach_rank_signals from anon, authenticated;
comment on table public.coach_rank_signals is
  'Per-coach ranking inputs, refreshed every 15 minutes by coach_rank_signals_refresh(). Internal: read only by coach_ranked().';

/** The five completeness checks the directory has used since 20261022100000, for one profile. */
create or replace function public.coach_rank_completeness(p_profile uuid)
returns smallint language sql stable security definer set search_path = public as $$
  select (case when cp.cover_url is not null then 1 else 0 end
          + case when char_length(coalesce(cp.about, '')) >= 200 then 1 else 0 end
          + case when exists (select 1 from public.coach_certifications ce where ce.coach_profile_id = cp.id) then 1 else 0 end
          + case when exists (select 1 from public.coach_languages cl where cl.coach_profile_id = cp.id) then 1 else 0 end
          + case when exists (select 1 from public.coach_services sv where sv.coach_profile_id = cp.id and sv.active
                              and sv.price_public and sv.price_cents is not null) then 1 else 0 end)::smallint
  from public.coach_profiles cp where cp.id = p_profile;
$$;
revoke execute on function public.coach_rank_completeness(uuid) from public, anon, authenticated;

/** Recount the signals of every published coach (or one). Rows of coaches no longer published go. */
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
    has_availability, computed_at)
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
         now()
  from public.coach_profiles cp
  cross join lateral (
    -- a request counts once it has had 48 hours, unless the client withdrew it inside them
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
    computed_at = excluded.computed_at;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke execute on function public.coach_rank_signals_refresh(uuid) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('coach-rank-signals', '*/15 * * * *', $cron$ select public.coach_rank_signals_refresh(); $cron$);
  end if;
end;
$$;

-- ---------- 2. reading the query ----------
/**
 * The typed words, each classified: 'stop' (generic marketplace words —
 * coach, trainer, in, la…), a format ('online', 'in_person', 'hybrid'), a
 * specialization or a city from the catalogs (whole word; a specialization
 * also by a 5+ letter prefix, "bodybuild"), else 'text'. Only [a-z0-9]
 * tokens ever reach a tsquery.
 */
create or replace function public.coach_query_tokens(p_query text)
returns table (n int, tok text, kind text, ids uuid[])
language sql stable security definer set search_path = public, extensions as $$
  with toks as (
    select t.tok, t.n::int as n
    from regexp_split_to_table(public.search_normalize(coalesce(p_query, '')), '[^a-z0-9]+') with ordinality as t(tok, n)
    where t.tok <> ''
  ),
  classified as (
    select t.n, t.tok,
           case
             when t.tok = any (array['coach', 'coaches', 'coaching', 'coachi', 'trainer', 'trainers', 'training', 'personal',
                                     'antrenor', 'antrenoare', 'antrenori', 'antrenament', 'antrenamente', 'pt',
                                     'in', 'la', 'din', 'de', 'si', 'cu', 'pentru', 'the', 'a', 'an', 'and', 'of', 'for',
                                     'near', 'me', 'my', 'with']) then 'stop'
             when t.tok = any (array['online', 'remote', 'virtual', 'distanta', 'distance']) then 'online'
             when t.tok = any (array['hybrid', 'hibrid']) then 'hybrid'
             when t.tok = any (array['person', 'inperson', 'fizic', 'presential', 'fata']) then 'in_person'
             else null end as fixed,
           (select array_agg(s.id order by s.id) from public.specializations s
             where s.active and char_length(t.tok) >= 4
               and (t.tok = any (regexp_split_to_array(public.search_normalize(s.name_en || ' ' || coalesce(s.name_ro, '') || ' ' || replace(s.slug, '-', ' ')), '[^a-z0-9]+'))
                    or (char_length(t.tok) >= 5 and exists (
                          select 1 from regexp_split_to_table(public.search_normalize(s.name_en || ' ' || coalesce(s.name_ro, '')), '[^a-z0-9]+') w
                          where w like t.tok || '%')))) as spec_ids,
           (select array_agg(c.id order by c.id) from public.cities c
             where char_length(t.tok) >= 3
               and t.tok = any (regexp_split_to_array(public.search_normalize(c.name || ' ' || coalesce(c.name_en, '') || ' ' || replace(c.slug, '-', ' ')), '[^a-z0-9]+'))) as city_ids
    from toks t
  )
  select c.n, c.tok,
         coalesce(c.fixed, case when c.spec_ids is not null then 'spec' when c.city_ids is not null then 'city' else 'text' end),
         case when c.fixed is not null then null when c.spec_ids is not null then c.spec_ids else c.city_ids end
  from classified c;
$$;
revoke execute on function public.coach_query_tokens(text) from public, anon, authenticated;

/**
 * How well one coach answers one token, 0..1; 0 = not at all. A token is
 * satisfied above 0. A text word matches as a prefix (1) or, 4+ letters, as
 * a near miss (word_similarity ≥ 0.45: a typo, 0.7) — per word, so a
 * two-word query is never answered by one of its words alone.
 */
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
    else case when p_doc @@ to_tsquery('simple', p_tok || ':*') then 1
              when char_length(p_tok) >= 4 and extensions.word_similarity(p_tok, coalesce(p_text, '')) >= 0.45 then 0.7
              else 0 end
  end)::real;
$$;
revoke execute on function public.coach_token_score(uuid, tsvector, text, boolean, boolean, text, text, uuid[]) from public, anon, authenticated;

-- ---------- 3. the one ranking layer ----------
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
  p_saved boolean default null
) returns table (
  profile_id uuid, ord bigint, relevance real, trust real, quality real, responsiveness real, activity real,
  engagement real, cold_start real, placement real, score numeric, saved_at timestamptz, signals jsonb
) language sql stable security definer set search_path = public, extensions as $$
  with params as (
    select case when public.coach_search_tsquery(p_query) is null then null
                else public.search_normalize(btrim(p_query)) end as q,
           nullif(lower(btrim(coalesce(p_country, ''))), '') as country,
           nullif(lower(btrim(coalesce(p_city, ''))), '') as city,
           nullif(array_remove(coalesce(p_specializations, '{}'), ''), '{}') as specs,
           upper(coalesce(nullif(btrim(p_currency), ''), 'RON')) as currency,
           case when p_sort in ('recommended', 'relevance', 'experience', 'followers', 'newest', 'saved')
                then p_sort else 'recommended' end as sort
  ),
  qt as (
    select t.tok, t.kind, t.ids from public.coach_query_tokens(p_query) t cross join params pr
    where pr.q is not null and t.kind <> 'stop'
  ),
  matched as (
    select cp.id, cp.user_id, cp.online, cp.in_person, cp.accepting_clients, cp.published_at, cp.coaching_since,
           cp.search_doc, cp.search_text, cp.verification_status, cp.review_count, cp.review_avg
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
                           where public.coach_token_score(cp.id, cp.search_doc, cp.search_text, cp.online, cp.in_person, qt.tok, qt.kind, qt.ids) <= 0)
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
                       (select avg(public.coach_token_score(m.id, m.search_doc, m.search_text, m.online, m.in_person, qt.tok, qt.kind, qt.ids)) from qt)
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
    select m.id, m.published_at, m.coaching_since,
           case when r.q_rel is null and r.s_rel is null then null
                else ((coalesce(r.q_rel, 0) + coalesce(r.s_rel, 0))
                      / ((r.q_rel is not null)::int + (r.s_rel is not null)::int)) end as relevance,
           -- trust
           0.55 * (m.verification_status = 'verified')::int
           + 0.30 * coalesce(sg.completeness, public.coach_rank_completeness(m.id)) / 5.0
           + 0.15 * case when coalesce(sg.verified_credentials, 0) > 0 then 1 when coalesce(sg.credentials, 0) > 0 then 0.4 else 0 end
             as trust,
           -- quality: a Bayesian rating (5 virtual 3.5-star reviews) and outcomes
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
           case when pr.sort = 'saved' then s.saved_at end desc nulls last,
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
         s.score, s.saved_at, s.signals
  from scored s cross join params pr;
$$;
revoke execute on function public.coach_ranked(text, text, text, boolean, boolean, text[], int, int, int, text, boolean, text, boolean, boolean, uuid, boolean)
  from public, anon, authenticated;

-- ---------- 4. search_coaches: the public door, same signature and cards, the new order ----------
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
  p_saved boolean default null
) returns jsonb language sql stable security definer set search_path = public, extensions as $$
  with params as (
    select nullif(lower(btrim(coalesce(p_city, ''))), '') as city,
           upper(coalesce(nullif(btrim(p_currency), ''), 'RON')) as currency,
           -- up to 10 pages of 24: "Load more" grows one listing (lib/coach-discovery.ts)
           greatest(1, least(coalesce(p_limit, 24), 240)) as lim,
           greatest(0, least(coalesce(p_offset, 0), 1000)) as off
  ),
  ranked as (
    select r.profile_id, r.ord, r.saved_at
    from public.coach_ranked(p_query, p_country, p_city, p_online, p_in_person, p_specializations, p_min_years,
                             p_price_min, p_price_max, p_currency, p_accepting, p_sort, p_verified, p_hybrid, p_gym, p_saved) r
  ),
  page as (
    select r.ord, r.saved_at, cp.id, cp.user_id, cp.slug, cp.headline, cp.online, cp.in_person, cp.coaching_since,
           cp.accepting_clients, cp.verification_status = 'verified' as verified, cp.review_count, cp.review_avg,
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

-- ---------- 5. the admin's inspector ----------
/**
 * Why a coach ranks where it does, for /admin/marketplace and
 * /admin/coaches/[id]: the same coach_ranked() the public search uses, with
 * every part and the raw signals. Accepting or not, every published coach.
 */
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
  from public.coach_ranked(p_query, null, p_city, p_online, p_in_person, p_specializations, null, null, null, 'RON',
                           false, 'recommended', null, null, null, null) r
  join public.coach_profiles cp on cp.id = r.profile_id
  join public.users u on u.id = cp.user_id
  where p_profile is null or r.profile_id = p_profile
  order by r.ord
  limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;
revoke execute on function public.admin_coach_ranking(text, text, text[], boolean, boolean, uuid, int) from public, anon;
grant execute on function public.admin_coach_ranking(text, text, text[], boolean, boolean, uuid, int) to authenticated;

-- the first fill
select public.coach_rank_signals_refresh();
