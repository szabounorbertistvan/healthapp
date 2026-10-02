-- HealthApp schema · Coach Discovery: the public coach page (/coaches/[slug])
--
-- 20261020100000 opened one anonymous door, coach_public_profile(slug). The
-- page needs a little more, and every addition keeps the same rule: an
-- anonymous caller reaches nothing but what a published coach chose to make
-- public, through a security definer function with a fixed output.
--
-- 1. coach_public_visible(slug): the one gate, shared by every function below
--    — published profile, account not suspended or being deleted, no block
--    between the reader and the coach. Internal: no API role may call it.
--
-- 2. coach_public_profile(slug) grows:
--      certifications[].year (the onboarding spec now shows the year);
--      stats: public posts, and — only when the coach's own privacy setting
--      is 'public' — completed workouts and badges (stats_visibility) and the
--      Fitness Score they published (fitness_score_visibility). The
--      'followers' level is not honoured here: an anonymous reader follows
--      nobody, and a signed-in one sees the full social profile instead.
--
-- 3. coach_public_posts(slug): the coach's `public` posts only (never
--    'followers' or 'private'), newest first, text and counts. No pictures:
--    post media is delivered through /api/media, which requires a session by
--    design (20261016100000), so a signed-in reader gets the Social V2 feed.
--
-- 4. coach_public_programs(slug): the coach's `public` routines as the cards
--    Discover renders (program_card_rows), with the author's public name
--    replacing coalesce(username, full_name) — full_name may be an e-mail.
--
-- 5. coach_viewer_state(profile): signed-in only. What the page's buttons
--    need to know about this reader: self, following, already this coach's
--    client, another coach active, a pending request (no duplicates).

-- ---------- 1. the gate ----------
create or replace function public.coach_public_visible(p_slug text)
returns table (profile_id uuid, user_id uuid)
language sql stable security definer set search_path = public as $$
  select cp.id, cp.user_id
  from public.coach_profiles cp
  join public.users u on u.id = cp.user_id
  where cp.slug = lower(btrim(coalesce(p_slug, '')))
    and cp.status = 'published'
    and u.suspended_at is null
    and not exists (select 1 from public.account_deletion_requests d where d.user_id = cp.user_id)
    and not public.social_blocked_between(auth.uid(), cp.user_id);
$$;
revoke execute on function public.coach_public_visible(text) from public, anon, authenticated;

-- ---------- 2. the profile ----------
/**
 * One published coach profile by slug, for anyone. The field list IS the
 * public contract: adding a key here publishes it. See 20261020100000 for
 * what may never appear. Null for anything coach_public_visible() refuses.
 */
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

-- ---------- 3. public posts ----------
create or replace function public.coach_public_posts(p_slug text, p_limit int default 6)
returns table (
  id uuid, type text, text text, created_at timestamptz, reactions int, comments int, photos int
) language sql stable security definer set search_path = public as $$
  select p.id, p.type, p.text, p.created_at,
         (select count(*)::int from public.social_reactions r where r.post_id = p.id),
         (select count(*)::int from public.social_comments c where c.post_id = p.id),
         (select count(*)::int from public.social_post_media m where m.post_id = p.id)
  from public.coach_public_visible(p_slug) g
  join public.social_posts p on p.user_id = g.user_id
  where p.visibility = 'public'
    and p.deleted_at is null
  order by p.created_at desc
  limit greatest(1, least(coalesce(p_limit, 6), 12));
$$;

-- ---------- 4. public programs ----------
-- The cards as program_card_rows() builds them, for the coach's `public`
-- routines only; author_name is the public name, never full_name.
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
           to_jsonb(r) || jsonb_build_object(
             'author_name', (select public.public_display_name(u.username, u.full_name)
                             from public.users u where u.id = r.author_id),
             'saved', false, 'is_mine', false, 'assigned_by_coach', false)
           order by ids.updated_at desc), '[]'::jsonb)
  from ids
  join public.program_card_rows(array(select id from ids)) r on r.id = ids.id;
$$;

-- ---------- 5. what the buttons need to know about this reader ----------
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
  where cp.id = p_profile
    and auth.uid() is not null
    and cp.status = 'published';
$$;

-- ---------- grants ----------
revoke execute on function public.coach_public_profile(text) from public;
grant execute on function public.coach_public_profile(text) to anon, authenticated;
revoke execute on function public.coach_public_posts(text, int) from public;
grant execute on function public.coach_public_posts(text, int) to anon, authenticated;
revoke execute on function public.coach_public_programs(text, int) from public;
grant execute on function public.coach_public_programs(text, int) to anon, authenticated;
revoke execute on function public.coach_viewer_state(uuid) from public, anon;
grant execute on function public.coach_viewer_state(uuid) to authenticated;
