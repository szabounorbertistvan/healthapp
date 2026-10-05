-- HealthApp schema · the public coach page: privacy hardening + a program count
--
-- A review of the /coaches/[slug] doors (20261021100000) for the coach
-- profile work of 2026-10-05:
--
-- 1. coach_public_programs() — open to anonymous callers — returned the rows
--    of program_card_rows() whole, so every card carried coach_id, client_id
--    and author_id (the coach's account id) and source_program_id (the id of
--    the program it was copied from, possibly someone else's). The profile
--    itself gives user_id to signed-in readers only; the cards now follow
--    that rule: the four ids are null. Nothing on an anonymous card used them
--    (the card links to /routines/<id>, behind sign-in).
--
-- 2. coach_viewer_state() checked only status = 'published'; it now applies
--    the same door as coach_public_visible() (account not suspended, no
--    deletion request, no block), so nothing answers for a coach the reader
--    can no longer see.
--
-- 3. coach_public_profile() stats gain 'programs': the number of public
--    programs, by the exact rule coach_public_programs() lists them — real
--    social proof for the page, never an estimate.

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
    'badges', coalesce((select jsonb_agg(v.kind || '_verified' order by v.kind)
                        from public.coach_verifications v
                        where v.coach_profile_id = cp.id and v.status = 'verified'), '[]'::jsonb),
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
                          'verified', ce.verification_status = 'verified')
                          order by ce.sort_order, ce.created_at)
                        from public.coach_certifications ce
                        where ce.coach_profile_id = cp.id), '[]'::jsonb),
    'services', coalesce((select jsonb_agg(jsonb_build_object(
                          'id', sv.id, 'name', sv.name, 'description', sv.description, 'kind', sv.kind,
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

create or replace function public.coach_public_programs(p_slug text, p_limit int default 6)
returns jsonb language sql stable security definer set search_path = public as $$
  with g as (select * from public.coach_public_visible(p_slug)),
  ids as (
    select p.id, p.updated_at from public.programs p, g
    where p.client_id = g.user_id
      and p.coach_id is null
      and p.visibility = 'public'
      and p.status <> 'archived'
      and exists (select 1 from public.program_days d where d.program_id = p.id)
    order by p.updated_at desc
    limit greatest(1, least(coalesce(p_limit, 6), 12))
  )
  select coalesce(jsonb_agg(
           -- no account ids: the coach's user id is for signed-in readers only
           -- (coach_public_profile), and source_program_id names someone else's program
           (to_jsonb(r) - 'coach_id' - 'client_id' - 'author_id' - 'source_program_id') || jsonb_build_object(
             'coach_id', null, 'client_id', null, 'author_id', null, 'source_program_id', null,
             'author_name', (select public.public_display_name(u.username, u.full_name)
                             from public.users u where u.id = r.author_id),
             'saved', false, 'is_mine', false, 'assigned_by_coach', false)
           order by ids.updated_at desc), '[]'::jsonb)
  from ids
  join public.program_card_rows(array(select id from ids)) r on r.id = ids.id;
$$;

create or replace function public.coach_viewer_state(p_profile uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'is_self', cp.user_id = auth.uid(),
    'is_following', public.is_following(cp.user_id),
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
-- create or replace keeps the grants of 20261021100000.
