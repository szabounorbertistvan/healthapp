-- Coach Discovery: disciplines beyond the gym (2026-11-16)
--
-- The taxonomy stays the one table it always was — public.specializations,
-- linked to coaches by coach_specializations (many per coach, at most one
-- primary) and validated by coach_apply_specializations() (active slugs only,
-- at most 8, the primary among them). This migration only widens it:
--
--   1. two columns: `category` (the group a picker shows it under) and
--      `parent_id` (one level: a style under its discipline — Vinyasa under
--      Yoga). Slugs remain the identifiers; labels stay name_en / name_ro.
--   2. the eleven existing rows get a group, a place in the order and, where
--      it helps discovery, a parent. None is renamed by slug, retired or
--      unlinked: every coach keeps exactly the specializations they chose.
--      `mobility` is relabelled "Mobility & Flexibility" (same slug, same URL).
--   3. thirty-four new rows. A new slug is skipped when a coach page, an old
--      coach link (coach_slug_redirects), a city or a country already answers
--      /coaches/<slug>: the landing page would otherwise shadow it.
--   4. a filter on a discipline includes its styles (coach_ranked), a word
--      that names a discipline still ranks a headline above a service for a
--      coach who did not tick it (coach_token_score), the facet
--      count of a discipline counts its styles' coaches once each, and the
--      search card says which specialization is the primary one.
--
-- Not added on purpose: "Personal Training" is already a service kind
-- (coach_services.kind = 'personal_training', filterable as such);
-- "Bodyweight Training" is folded into Calisthenics, "General Mobility" and
-- "Mobility & Flexibility" into the existing `mobility`, "Athletic
-- Performance" is the existing `sports-performance`. Nothing clinical: no
-- rehabilitation, physiotherapy or medical category.

-- ============================================================================
-- 1. columns and the one-level rule
-- ============================================================================

alter table public.specializations
  add column category text not null default 'other'
    check (category in ('strength', 'mind_body', 'functional', 'endurance', 'combat', 'other')),
  add column parent_id uuid references public.specializations (id) on delete restrict,
  add constraint specializations_parent_not_self check (parent_id is null or parent_id <> id);
create index specializations_parent_idx on public.specializations (parent_id) where parent_id is not null;

-- A style hangs under a top-level discipline of the same group; a discipline
-- with styles cannot itself become a style, nor move to another group alone.
create or replace function public.specializations_check_parent()
returns trigger language plpgsql set search_path = public as $$
declare
  v_parent public.specializations;
begin
  if new.parent_id is not null then
    select * into v_parent from public.specializations where id = new.parent_id;
    if v_parent.parent_id is not null then
      raise exception 'SPECIALIZATION_ONE_LEVEL' using errcode = '23514';
    end if;
    if v_parent.category <> new.category then
      raise exception 'SPECIALIZATION_PARENT_CATEGORY' using errcode = '23514';
    end if;
    if exists (select 1 from public.specializations c where c.parent_id = new.id) then
      raise exception 'SPECIALIZATION_ONE_LEVEL' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'UPDATE' and new.category is distinct from old.category
     and exists (select 1 from public.specializations c where c.parent_id = new.id and c.category <> new.category) then
    raise exception 'SPECIALIZATION_PARENT_CATEGORY' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger specializations_check_parent before insert or update of parent_id, category on public.specializations
  for each row execute function public.specializations_check_parent();

-- ============================================================================
-- 2. the existing eleven: a group and an order; labels kept except one
-- ============================================================================

update public.specializations s set category = v.category, sort_order = v.sort_order
from (values
  ('weight-loss',         'strength',   110),
  ('muscle-building',     'strength',   120),
  ('hypertrophy',         'strength',   121),
  ('bodybuilding',        'strength',   122),
  ('strength',            'strength',   130),
  ('powerlifting',        'strength',   131),
  ('sports-performance',  'strength',   140),
  ('mobility',            'mind_body',  220),
  ('functional-training', 'functional', 300),
  ('beginners',           'other',      640),
  ('nutrition',           'other',      650)
) v(slug, category, sort_order)
where s.slug = v.slug;

-- "Mobility" covered flexibility all along; the label now says so (slug and URL unchanged)
update public.specializations
   set name_en = 'Mobility & Flexibility', name_ro = 'Mobilitate și flexibilitate'
 where slug = 'mobility' and name_en = 'Mobility' and name_ro = 'Mobilitate';

-- ============================================================================
-- 3. the new disciplines
-- ============================================================================

do $$
declare
  v_skipped text[];
begin
  create temporary table new_specializations (slug text, name_en text, name_ro text, category text, sort_order int, parent text)
    on commit drop;
  insert into new_specializations values
    -- strength & fitness
    ('general-fitness',              'General Fitness',              'Fitness general',                    'strength',   100, null),
    ('body-recomposition',           'Body Recomposition',           'Recompoziție corporală',             'strength',   115, null),
    ('strength-conditioning',        'Strength & Conditioning',      'Forță și condiție fizică',           'strength',   132, 'strength'),
    ('sports-specific-conditioning', 'Sports-Specific Conditioning', 'Pregătire fizică specifică sportului','strength',  141, 'sports-performance'),
    -- yoga & pilates
    ('yoga',                         'Yoga',                         'Yoga',                               'mind_body',  200, null),
    ('hatha-yoga',                   'Hatha Yoga',                   'Hatha yoga',                         'mind_body',  201, 'yoga'),
    ('vinyasa-yoga',                 'Vinyasa Yoga',                 'Vinyasa yoga',                       'mind_body',  202, 'yoga'),
    ('yin-yoga',                     'Yin Yoga',                     'Yin yoga',                           'mind_body',  203, 'yoga'),
    ('ashtanga-yoga',                'Ashtanga Yoga',                'Ashtanga yoga',                      'mind_body',  204, 'yoga'),
    ('pilates',                      'Pilates',                      'Pilates',                            'mind_body',  210, null),
    ('mat-pilates',                  'Mat Pilates',                  'Pilates la saltea',                  'mind_body',  211, 'pilates'),
    ('reformer-pilates',             'Reformer Pilates',             'Pilates pe reformer',                'mind_body',  212, 'pilates'),
    ('posture-movement',             'Posture & Movement',           'Postură și mișcare',                 'mind_body',  230, null),
    -- functional training
    ('trx-suspension-training',      'TRX / Suspension Training',    'TRX / antrenament în suspensie',     'functional', 310, null),
    ('hiit',                         'HIIT',                         'HIIT',                               'functional', 320, null),
    ('circuit-training',             'Circuit Training',             'Antrenament în circuit',             'functional', 330, null),
    ('calisthenics',                 'Calisthenics & Bodyweight',    'Calistenie și greutatea corpului',   'functional', 340, null),
    ('kettlebell-training',          'Kettlebell Training',          'Antrenament cu kettlebell',          'functional', 350, null),
    -- endurance & outdoor
    ('running',                      'Running',                      'Alergare',                           'endurance',  400, null),
    ('marathon-preparation',         'Marathon Preparation',         'Pregătire pentru maraton',           'endurance',  401, 'running'),
    ('cycling',                      'Cycling',                      'Ciclism',                            'endurance',  410, null),
    ('swimming',                     'Swimming',                     'Înot',                               'endurance',  420, null),
    ('triathlon',                    'Triathlon',                    'Triatlon',                           'endurance',  430, null),
    ('hiking-outdoor-fitness',       'Hiking & Outdoor Fitness',     'Drumeții și fitness în aer liber',   'endurance',  440, null),
    -- combat sports
    ('boxing',                       'Boxing',                       'Box',                                'combat',     500, null),
    ('kickboxing',                   'Kickboxing',                   'Kickbox',                            'combat',     510, null),
    ('muay-thai',                    'Muay Thai',                    'Muay Thai',                          'combat',     520, null),
    ('brazilian-jiu-jitsu',          'Brazilian Jiu-Jitsu',          'Jiu-jitsu brazilian',                'combat',     530, null),
    ('wrestling',                    'Wrestling',                    'Lupte',                              'combat',     540, null),
    ('martial-arts',                 'Martial Arts',                 'Arte marțiale',                      'combat',     550, null),
    -- more
    ('dance-fitness',                'Dance Fitness',                'Dance fitness',                      'other',      600, null),
    ('prenatal-postnatal-fitness',   'Prenatal & Postnatal Fitness', 'Fitness prenatal și postnatal',      'other',      610, null),
    ('senior-fitness',               'Senior Fitness',               'Fitness pentru seniori',             'other',      620, null),
    ('youth-athletic-development',   'Youth Athletic Development',   'Dezvoltare atletică pentru tineri',  'other',      630, null);

  -- /coaches/<slug> already answered by someone else: keep that page, skip the discipline
  select array_agg(n.slug order by n.slug) into v_skipped
  from new_specializations n
  where exists (select 1 from public.coach_profiles cp where cp.slug = n.slug)
     or exists (select 1 from public.coach_slug_redirects r where r.old_slug = n.slug)
     or exists (select 1 from public.cities c where c.slug = n.slug)
     or exists (select 1 from public.countries c where c.slug = n.slug);
  if v_skipped is not null then
    raise notice 'coach disciplines: slug taken, not added: %', v_skipped;
  end if;

  insert into public.specializations (slug, name_en, name_ro, category, sort_order)
  select n.slug, n.name_en, n.name_ro, n.category, n.sort_order
  from new_specializations n
  where n.slug <> all (coalesce(v_skipped, '{}'))
  on conflict (slug) do nothing;

  -- parents last, by slug; a skipped parent leaves its style top-level
  update public.specializations s set parent_id = p.id
  from new_specializations n join public.specializations p on p.slug = n.parent
  where s.slug = n.slug and n.parent is not null and s.parent_id is null;
end;
$$;

-- the existing styles under their discipline
update public.specializations s set parent_id = p.id
from (values ('hypertrophy', 'muscle-building'), ('bodybuilding', 'muscle-building'), ('powerlifting', 'strength')) v(child, parent)
join public.specializations p on p.slug = v.parent
where s.slug = v.child and s.parent_id is null;

-- ============================================================================
-- 4. a discipline finds its styles
-- ============================================================================

-- The slugs asked for, plus the active styles of any discipline among them.
-- Internal: called by coach_ranked() (security definer), never by a client.
create or replace function public.specialization_slugs_expand(p_slugs text[])
returns text[] language sql stable security definer set search_path = public as $$
  select case when p_slugs is null then null else array(
    select x from unnest(p_slugs) x
    union
    select c.slug from public.specializations c
      join public.specializations p on p.id = c.parent_id
     where c.active and p.slug = any (p_slugs)
  ) end;
$$;
revoke execute on function public.specialization_slugs_expand(text[]) from public, anon, authenticated;

-- The four below are their 20261111110000 definitions with only the marked
-- lines changed (same signatures, so their grants carry over).

create or replace function public.coach_token_score(
  p_profile uuid, p_doc tsvector, p_text text, p_online boolean, p_in_person boolean, p_tok text, p_kind text, p_ids uuid[]
) returns real language sql stable security definer set search_path = public, extensions as $$
  select (case p_kind
    when 'spec' then case
      when exists (select 1 from public.coach_specializations cs
                    where cs.coach_profile_id = p_profile and cs.specialization_id = any (p_ids) and cs.is_primary) then 1
      when exists (select 1 from public.coach_specializations cs
                    where cs.coach_profile_id = p_profile and cs.specialization_id = any (p_ids)) then 0.85
      -- untagged but written about (20261116100000): by the field it is in, always below a tagged coach —
      -- with thirty more discipline words, "Yoga instructor" in a headline must still beat a service name
      when p_doc @@ to_tsquery('simple', p_tok || ':*A') then 0.8
      when p_doc @@ to_tsquery('simple', p_tok || ':*B') then 0.7
      when p_doc @@ to_tsquery('simple', p_tok || ':*C') then 0.6
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
           -- a discipline includes its styles (20261116100000): Yoga finds a Vinyasa-only coach
           public.specialization_slugs_expand(nullif(array_remove(coalesce(p_specializations, '{}'), ''), '{}')) as specs,
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

create or replace function public.coach_discovery_facets()
returns jsonb language sql stable security definer set search_path = public as $$
  with live as (
    select cp.id from public.coach_profiles cp join public.users u on u.id = cp.user_id
    where cp.status = 'published' and u.suspended_at is null
      and not exists (select 1 from public.account_deletion_requests d where d.user_id = cp.user_id)
  )
  select jsonb_build_object(
    -- every active specialization with its group and parent (20261116100000); `coaches` = published
    -- coaches with it or one of its styles, each counted once — the number the filter will find
    'specializations', coalesce((select jsonb_agg(jsonb_build_object('slug', s.slug, 'name_en', s.name_en, 'name_ro', s.name_ro,
                                                                     'category', s.category,
                                                                     'parent', (select pp.slug from public.specializations pp where pp.id = s.parent_id),
                                                                     'coaches', (select count(distinct cs.coach_profile_id)::int
                                                                                   from public.coach_specializations cs
                                                                                   join live on live.id = cs.coach_profile_id
                                                                                   join public.specializations x on x.id = cs.specialization_id and x.active
                                                                                  where x.id = s.id or x.parent_id = s.id))
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
