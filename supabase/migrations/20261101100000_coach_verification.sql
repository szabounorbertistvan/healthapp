-- HealthApp schema · Coach Discovery: verification & trust signals
--
-- What existed (20261020100000): coach_verifications (one admin-written row
-- per identity / certification / business check) and coach_certifications
-- (name, issuer, year, an admin-only verification_status, a private
-- document_ref). What was missing: a coach-level status the coach can ask
-- for and read, a reason when it is refused, and credential details.
--
-- 1. coach_profiles.verification_status: unverified | pending | verified |
--    rejected, plus the coach's request (requested_at, message) and the
--    admin's decision (decided_at / by, note, the reason shown to the coach).
--    The owner reads these (table-level select) and never writes them: none
--    is in the owner's column update grant. "Voinic Verified" means exactly
--    verification_status = 'verified': nothing else (a complete profile, a
--    credential, a verified coach_verifications row on its own) implies it.
--    Profiles that already had a verified coach_verifications row start as
--    verified, so nothing that showed a badge loses it.
--
-- 2. coach_certifications gains credential_number (owner and admins only;
--    never on the public page) and expires_on. Editing either resets the
--    credential to unverified, like name / issuer / year already did.
--    Credentials are self-reported until an admin verifies each one
--    (admin_set_certification_status, unchanged); a coach still cannot write
--    verification_status (no grant). Editing stays draft-only (pre-moderation).
--
-- 3. request_coach_verification(message): the owner asks, unverified |
--    rejected -> pending, only with a complete profile (coach_profile_missing,
--    returned instead of raised, like submit), never while suspended. Their
--    unverified / rejected credentials become pending with it.
--
-- 4. admin_set_coach_verification_status(profile, status, note), admin only,
--    audited:  pending -> verified | rejected,  rejected -> pending,
--              verified -> rejected (a revocation). A rejection needs a note.
--
-- 5. The public page, the search card and the verified filter read the new
--    status. The ranking is unchanged: "verified" stays one tie-breaker in
--    the recommended order, as before. The public page shows a credential's
--    expires_on, never its number. The admin review returns the request,
--    the decision and every credential with its number and note.
--
-- No KYC, no document upload, no external certificate checks.

-- ---------- 1. the coach-level status ----------
alter table public.coach_profiles
  add column verification_status text not null default 'unverified'
    check (verification_status in ('unverified', 'pending', 'verified', 'rejected')),
  add column verification_requested_at timestamptz,
  add column verification_message text check (verification_message is null or char_length(verification_message) <= 1000),
  add column verification_decided_at timestamptz,
  add column verification_decided_by uuid references public.users (id) on delete set null,
  add column verification_note text check (verification_note is null or char_length(verification_note) <= 1000);
create index coach_profiles_verification_pending_idx on public.coach_profiles (verification_requested_at)
  where verification_status = 'pending';

update public.coach_profiles cp set verification_status = 'verified', verification_decided_at = now()
 where exists (select 1 from public.coach_verifications v where v.coach_profile_id = cp.id and v.status = 'verified');

-- ---------- 2. credential details ----------
alter table public.coach_certifications
  add column credential_number text check (credential_number is null or char_length(btrim(credential_number)) between 1 and 80),
  add column expires_on date check (expires_on is null or expires_on between date '1950-01-01' and date '2100-12-31');
grant select (credential_number, expires_on) on table public.coach_certifications to authenticated;
grant insert (credential_number, expires_on) on table public.coach_certifications to authenticated;
grant update (credential_number, expires_on) on table public.coach_certifications to authenticated;

create or replace function public.coach_certifications_reset_verification()
returns trigger language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon')
     and (new.name, new.issuer, new.year, new.credential_number, new.expires_on)
         is distinct from (old.name, old.issuer, old.year, old.credential_number, old.expires_on) then
    new.verification_status := 'unverified';
    new.verified_at := null;
    new.verified_by := null;
  end if;
  return new;
end;
$$;

-- ---------- 3. the coach asks ----------
create or replace function public.request_coach_verification(p_message text default null)
returns text[] language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_status text;
  v_verification text;
  v_missing text[];
begin
  select id, status, verification_status into v_id, v_status, v_verification
  from public.coach_profiles where user_id = auth.uid() for update;
  if v_id is null then
    raise exception 'NO_COACH_PROFILE' using errcode = 'P0002';
  end if;
  if v_status = 'suspended' then
    raise exception 'PROFILE_LOCKED' using errcode = '55000';
  end if;
  if v_verification not in ('unverified', 'rejected') then
    raise exception 'BAD_TRANSITION' using errcode = '55000';
  end if;
  if char_length(coalesce(p_message, '')) > 1000 then
    raise exception 'MESSAGE_TOO_LONG' using errcode = '22023';
  end if;
  v_missing := public.coach_profile_missing(v_id);
  if cardinality(v_missing) > 0 then
    return v_missing;
  end if;
  update public.coach_profiles
     set verification_status = 'pending', verification_requested_at = now(),
         verification_message = nullif(btrim(coalesce(p_message, '')), '')
   where id = v_id;
  update public.coach_certifications set verification_status = 'pending'
   where coach_profile_id = v_id and verification_status in ('unverified', 'rejected');
  return '{}';
end;
$$;
revoke execute on function public.request_coach_verification(text) from public, anon;
grant execute on function public.request_coach_verification(text) to authenticated;

-- ---------- 4. the admin decides ----------
create or replace function public.admin_set_coach_verification_status(
  p_profile uuid, p_status text, p_note text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_cp public.coach_profiles;
  v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 1000);
begin
  perform public.admin_assert();
  select * into v_cp from public.coach_profiles where id = p_profile for update;
  if not found then
    raise exception 'NO_COACH_PROFILE' using errcode = 'P0002';
  end if;
  if not (
       (v_cp.verification_status = 'pending' and p_status in ('verified', 'rejected'))
    or (v_cp.verification_status = 'rejected' and p_status = 'pending')
    or (v_cp.verification_status = 'verified' and p_status = 'rejected')
  ) then
    raise exception 'BAD_TRANSITION' using errcode = '22023';
  end if;
  if p_status = 'rejected' and v_note is null then
    raise exception 'REASON_REQUIRED' using errcode = '22023';
  end if;

  update public.coach_profiles set
    verification_status = p_status,
    verification_decided_at = case when p_status in ('verified', 'rejected') then now() else verification_decided_at end,
    verification_decided_by = case when p_status in ('verified', 'rejected') then auth.uid() else verification_decided_by end,
    verification_note = case when p_status = 'rejected' then v_note when p_status = 'verified' then null else verification_note end,
    verification_requested_at = case when p_status = 'pending' then now() else verification_requested_at end
  where id = p_profile;

  perform public.audit_log('ADMIN_ACTION', 'coach_profile', p_profile::text, v_cp.user_id,
    jsonb_build_object('op', 'coach_verification_status', 'from', v_cp.verification_status, 'to', p_status, 'note', v_note));
end;
$$;
revoke execute on function public.admin_set_coach_verification_status(uuid, text, text) from public, anon;
grant execute on function public.admin_set_coach_verification_status(uuid, text, text) to authenticated;

-- the queue: profile status as before, and now the verification status too
drop function public.admin_coach_profiles(text);
create function public.admin_coach_profiles(p_status text default 'pending_review', p_verification text default null)
returns table (
  id uuid, user_id uuid, slug text, display_name text, headline text, status text,
  submitted_at timestamptz, published_at timestamptz, suspended_at timestamptz, updated_at timestamptz,
  verification_status text, verification_requested_at timestamptz
) language plpgsql stable security definer set search_path = public as $$
begin
  perform public.admin_assert();
  return query
  select cp.id, cp.user_id, cp.slug, public.public_display_name(u.username, u.full_name), cp.headline,
         cp.status, cp.submitted_at, cp.published_at, cp.suspended_at, cp.updated_at,
         cp.verification_status, cp.verification_requested_at
  from public.coach_profiles cp
  join public.users u on u.id = cp.user_id
  where (p_status is null or cp.status = p_status)
    and (p_verification is null or cp.verification_status = p_verification)
  order by case when p_verification = 'pending' then cp.verification_requested_at end nulls last,
           cp.submitted_at nulls last, cp.updated_at desc
  limit 200;
end;
$$;
revoke execute on function public.admin_coach_profiles(text, text) from public, anon;
grant execute on function public.admin_coach_profiles(text, text) to authenticated;

create or replace function public.admin_coach_profile_counts()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_result jsonb;
begin
  perform public.admin_assert();
  select jsonb_build_object(
    'draft', count(*) filter (where status = 'draft'),
    'pending_review', count(*) filter (where status = 'pending_review'),
    'published', count(*) filter (where status = 'published'),
    'hidden', count(*) filter (where status = 'hidden'),
    'suspended', count(*) filter (where status = 'suspended'),
    'verification_pending', count(*) filter (where verification_status = 'pending'))
  into v_result from public.coach_profiles;
  return v_result;
end;
$$;

-- ---------- 5. the public page, the admin review, search ----------
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
    'stats', jsonb_build_object(
      'posts', (select count(*)::int from public.social_posts p
                where p.user_id = cp.user_id and p.visibility = 'public' and p.deleted_at is null),
      -- the programs coach_public_programs() lists, counted by the same rule
      'programs', (select count(*)::int from public.programs p
                   where p.client_id = cp.user_id and p.coach_id is null and p.visibility = 'public'
                     and p.status <> 'archived'
                     and exists (select 1 from public.program_days d where d.program_id = p.id)),
      'workouts', case when u.stats_visibility = 'public' then
                    (select count(*)::int from public.logged_sessions s
                     where s.user_id = cp.user_id and s.completed_at is not null) end,
      'badges', case when u.stats_visibility = 'public' then
                  (select count(*)::int from public.user_badges ub where ub.user_id = cp.user_id) end,
      'fitness_score', case when u.fitness_score_visibility = 'public' then u.fitness_score_public::int end
    ),
    -- Voinic Verified is the coach-level decision (20261101100000); what was
    -- checked (identity / certification / business) only shows under it
    'verified', cp.verification_status = 'verified',
    'badges', case when cp.verification_status = 'verified' then
                coalesce((select jsonb_agg(v.kind || '_verified' order by v.kind)
                          from public.coach_verifications v
                          where v.coach_profile_id = cp.id and v.status = 'verified'), '[]'::jsonb)
              else '[]'::jsonb end,
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
                          'name', ce.name, 'issuer', ce.issuer, 'year', ce.year,
                          'expires_on', ce.expires_on,
                          'verified', ce.verification_status = 'verified')
                          order by ce.sort_order, ce.created_at)
                        from public.coach_certifications ce
                        where ce.coach_profile_id = cp.id), '[]'::jsonb),
    'services', coalesce((select jsonb_agg(jsonb_build_object(
                          'id', sv.id, 'name', sv.name, 'description', sv.description, 'kind', sv.kind,
                          'delivery', sv.delivery, 'duration_value', sv.duration_value,
                          'duration_unit', sv.duration_unit,
                          'price_unit', sv.price_unit, 'price_public', sv.price_public,
                          'price_cents', case when sv.price_public then sv.price_cents end,
                          'currency', case when sv.price_public then sv.currency end)
                          order by sv.sort_order, sv.created_at)
                        from public.coach_services sv
                        where sv.coach_profile_id = cp.id and sv.active), '[]'::jsonb)
  )
  from public.coach_public_visible(p_slug) g
  join public.coach_profiles cp on cp.id = g.profile_id
  join public.users u on u.id = cp.user_id;
$$;

create or replace function public.admin_coach_review(p_profile uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_result jsonb;
begin
  perform public.admin_assert();
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
    'stats', jsonb_build_object(
      'posts', (select count(*)::int from public.social_posts p
                where p.user_id = cp.user_id and p.visibility = 'public' and p.deleted_at is null),
      -- the programs coach_public_programs() lists, counted by the same rule
      'programs', (select count(*)::int from public.programs p
                   where p.client_id = cp.user_id and p.coach_id is null and p.visibility = 'public'
                     and p.status <> 'archived'
                     and exists (select 1 from public.program_days d where d.program_id = p.id)),
      'workouts', case when u.stats_visibility = 'public' then
                    (select count(*)::int from public.logged_sessions s
                     where s.user_id = cp.user_id and s.completed_at is not null) end,
      'badges', case when u.stats_visibility = 'public' then
                  (select count(*)::int from public.user_badges ub where ub.user_id = cp.user_id) end,
      'fitness_score', case when u.fitness_score_visibility = 'public' then u.fitness_score_public::int end
    ),
    -- Voinic Verified is the coach-level decision (20261101100000); what was
    -- checked (identity / certification / business) only shows under it
    'verified', cp.verification_status = 'verified',
    'badges', case when cp.verification_status = 'verified' then
                coalesce((select jsonb_agg(v.kind || '_verified' order by v.kind)
                          from public.coach_verifications v
                          where v.coach_profile_id = cp.id and v.status = 'verified'), '[]'::jsonb)
              else '[]'::jsonb end,
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
                          'name', ce.name, 'issuer', ce.issuer, 'year', ce.year,
                          'expires_on', ce.expires_on,
                          'verified', ce.verification_status = 'verified')
                          order by ce.sort_order, ce.created_at)
                        from public.coach_certifications ce
                        where ce.coach_profile_id = cp.id), '[]'::jsonb),
    'services', coalesce((select jsonb_agg(jsonb_build_object(
                          'id', sv.id, 'name', sv.name, 'description', sv.description, 'kind', sv.kind,
                          'delivery', sv.delivery, 'duration_value', sv.duration_value,
                          'duration_unit', sv.duration_unit,
                          'price_unit', sv.price_unit, 'price_public', sv.price_public,
                          'price_cents', case when sv.price_public then sv.price_cents end,
                          'currency', case when sv.price_public then sv.currency end)
                          order by sv.sort_order, sv.created_at)
                        from public.coach_services sv
                        where sv.coach_profile_id = cp.id and sv.active), '[]'::jsonb)
  ) || jsonb_build_object(
    'status', cp.status,
    'submitted_at', cp.submitted_at,
    'reviewed_at', cp.reviewed_at,
    'review_note', cp.review_note,
    'suspended_at', cp.suspended_at,
    'suspension_reason', cp.suspension_reason,
    'updated_at', cp.updated_at,
    'account_suspended', u.suspended_at is not null,
    'missing', to_jsonb(public.coach_profile_missing(cp.id)),
    -- verification (20261101100000): the request, the decision, and every credential as the admin sees it
    'verification_status', cp.verification_status,
    'verification_requested_at', cp.verification_requested_at,
    'verification_message', cp.verification_message,
    'verification_decided_at', cp.verification_decided_at,
    'verification_note', cp.verification_note,
    'credentials', coalesce((select jsonb_agg(jsonb_build_object(
                     'id', ce.id, 'name', ce.name, 'issuer', ce.issuer, 'year', ce.year,
                     'credential_number', ce.credential_number, 'expires_on', ce.expires_on,
                     'verification_status', ce.verification_status, 'admin_note', ce.admin_note)
                     order by ce.sort_order, ce.created_at)
                   from public.coach_certifications ce where ce.coach_profile_id = cp.id), '[]'::jsonb)
  )
  into v_result
  from public.coach_profiles cp
  join public.users u on u.id = cp.user_id
  where cp.id = p_profile;
  return v_result;
end;
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
  p_gym uuid default null
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
                               where f.follower_id = p.user_id and f.following_id = auth.uid())
      ) end order by p.ord)
      from page p cross join params pr
    ), '[]'::jsonb)
  );
$$;
-- create or replace keeps every grant above.
