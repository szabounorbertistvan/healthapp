-- HealthApp schema · Coach Discovery: services / offers, complete
--
-- coach_services (20261020100000) already holds what a coach offers: name,
-- description, kind, price, currency, price_unit, price_public, active and
-- sort_order, owner-only RLS, editable in draft. It is extended, not
-- duplicated:
--
-- 1. delivery: how the service reaches the client:
--      online | in_person | hybrid | digital (a program or plan, no live sessions)
--    Backfilled from kind (personal / group training are in person).
-- 2. duration_value + duration_unit (minutes | days | weeks | months), both or
--    neither: "60 minutes", "12 weeks". Optional.
-- 3. price_unit learns free, week and year. The pricing model is derived from
--    it, never stored twice:
--      free                 free (no price)
--      session | package    one-time (per session, per package)
--      week | month | year  recurring, the unit IS the billing period
--      custom               on request (no price)
--    No payments, subscriptions or booking exist: this only describes the offer.
-- 4. kind learns training_program (a custom plan) and training_nutrition.
--    Still text + check, so the next kind is one constraint swap.
-- 5. currency: one of the currencies the form offers (RON, EUR, USD, GBP, MDL).
-- 6. Operational switches on a non-draft profile: coach_set_service_active()
--    and coach_reorder_services() let a coach turn a service off/on and reorder
--    while pending, published or hidden (never suspended). Content (name,
--    description, price, ...) still changes only in draft, under review, as
--    decided on 2026-10-01. Turning off the last active service of a
--    non-draft profile is refused: a public profile must offer something.
-- 7. The public profile and the admin review return delivery and duration.
--    Inactive services were never public (sv.active) and still are not.

-- ---------- 1-5. columns and constraints ----------
alter table public.coach_services
  add column delivery text not null default 'online'
    check (delivery in ('online', 'in_person', 'hybrid', 'digital')),
  add column duration_value int check (duration_value is null or duration_value between 1 and 1000),
  add column duration_unit text check (duration_unit is null or duration_unit in ('minutes', 'days', 'weeks', 'months')),
  add constraint coach_services_duration_pair check ((duration_value is null) = (duration_unit is null)),
  add constraint coach_services_currency_known check (currency in ('RON', 'EUR', 'USD', 'GBP', 'MDL'));

update public.coach_services set delivery = case when kind in ('personal_training', 'group_coaching') then 'in_person' else 'online' end;

alter table public.coach_services drop constraint coach_services_kind_check;
alter table public.coach_services add constraint coach_services_kind_check
  check (kind in ('online_coaching', 'personal_training', 'nutrition_coaching', 'group_coaching',
                  'consultation', 'training_program', 'training_nutrition', 'other'));

alter table public.coach_services drop constraint coach_services_price_unit_check;
alter table public.coach_services add constraint coach_services_price_unit_check
  check (price_unit in ('session', 'package', 'week', 'month', 'year', 'free', 'custom'));
-- free is free: no price (0 is accepted and means the same)
alter table public.coach_services add constraint coach_services_free_no_price
  check (price_unit <> 'free' or coalesce(price_cents, 0) = 0);

-- the coach writes the new columns like the others (still draft-only through RLS)
grant insert (delivery, duration_value, duration_unit) on table public.coach_services to authenticated;
grant update (delivery, duration_value, duration_unit) on table public.coach_services to authenticated;

-- a free service needs no price (20261020100000, one line changed)
create or replace function public.coach_profile_missing(p_profile uuid default null)
returns text[] language plpgsql stable security definer set search_path = public as $$
declare
  v_cp public.coach_profiles;
  v_avatar text;
begin
  if p_profile is null then
    select * into v_cp from public.coach_profiles where user_id = auth.uid();
  else
    select * into v_cp from public.coach_profiles where id = p_profile;
  end if;
  if v_cp.id is null or (v_cp.user_id <> auth.uid() and not public.is_admin()) then
    raise exception 'NO_COACH_PROFILE' using errcode = 'P0002';
  end if;
  select avatar_url into v_avatar from public.users where id = v_cp.user_id;

  return array_remove(array[
    case when nullif(btrim(v_cp.headline), '') is null then 'HEADLINE' end,
    case when nullif(btrim(v_cp.about), '') is null then 'ABOUT' end,
    case when not exists (select 1 from public.coach_specializations cs
                          join public.specializations s on s.id = cs.specialization_id and s.active
                          where cs.coach_profile_id = v_cp.id) then 'SPECIALIZATION' end,
    -- "at least one location, or online": a coach must say how they work, and
    -- in person needs somewhere to be
    case when not v_cp.online and not v_cp.in_person then 'DELIVERY_MODE' end,
    case when v_cp.in_person and not exists (select 1 from public.coach_locations l
                                             where l.coach_profile_id = v_cp.id) then 'LOCATION' end,
    case when not exists (select 1 from public.coach_services sv
                          where sv.coach_profile_id = v_cp.id and sv.active) then 'SERVICE' end,
    case when exists (select 1 from public.coach_services sv
                      where sv.coach_profile_id = v_cp.id and sv.active
                        and sv.price_unit not in ('custom', 'free') and sv.price_cents is null) then 'SERVICE_PRICE' end,
    case when nullif(btrim(v_avatar), '') is null then 'AVATAR' end,
    case when v_cp.slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or public.coach_slug_reserved(v_cp.slug) then 'SLUG' end,
    case when v_cp.coaching_since > extract(year from now())::int then 'COACHING_SINCE' end
  ], null);
end;
$$;

-- ---------- 6. operational switches ----------
/**
 * Turn one of the caller's own services on or off, in any status but
 * suspended. Refuses LAST_ACTIVE_SERVICE when it would leave a non-draft
 * profile with nothing on offer.
 */
create or replace function public.coach_set_service_active(p_service uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_profile uuid;
  v_status text;
begin
  select cp.id, cp.status into v_profile, v_status
  from public.coach_services sv
  join public.coach_profiles cp on cp.id = sv.coach_profile_id
  where sv.id = p_service and cp.user_id = auth.uid()
  for update of cp;
  if v_profile is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_status = 'suspended' then
    raise exception 'PROFILE_LOCKED' using errcode = '55000';
  end if;
  if not coalesce(p_active, false) and v_status <> 'draft' and not exists (
       select 1 from public.coach_services sv
       where sv.coach_profile_id = v_profile and sv.active and sv.id <> p_service) then
    raise exception 'LAST_ACTIVE_SERVICE' using errcode = '55000';
  end if;
  update public.coach_services set active = coalesce(p_active, false) where id = p_service;
end;
$$;

/**
 * The caller's services in this order (sort_order = position). The list must
 * be exactly the caller's services, no more, no fewer, no one else's.
 */
create or replace function public.coach_reorder_services(p_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare
  v_profile uuid;
  v_status text;
begin
  select id, status into v_profile, v_status from public.coach_profiles where user_id = auth.uid() for update;
  if v_profile is null then
    raise exception 'NO_COACH_PROFILE' using errcode = 'P0002';
  end if;
  if v_status = 'suspended' then
    raise exception 'PROFILE_LOCKED' using errcode = '55000';
  end if;
  if coalesce(cardinality(p_ids), 0) <> (select count(*) from public.coach_services where coach_profile_id = v_profile)
     or (select count(distinct x) from unnest(p_ids) x) <> cardinality(p_ids)
     or exists (select 1 from unnest(p_ids) x
                where not exists (select 1 from public.coach_services sv
                                  where sv.id = x and sv.coach_profile_id = v_profile)) then
    raise exception 'BAD_ORDER' using errcode = '22023';
  end if;
  update public.coach_services sv set sort_order = o.n - 1
  from unnest(p_ids) with ordinality as o(id, n)
  where sv.id = o.id;
end;
$$;

revoke execute on function public.coach_set_service_active(uuid, boolean) from public, anon;
grant execute on function public.coach_set_service_active(uuid, boolean) to authenticated;
revoke execute on function public.coach_reorder_services(uuid[]) from public, anon;
grant execute on function public.coach_reorder_services(uuid[]) to authenticated;

-- ---------- 7. the public page and the admin review show delivery and duration ----------
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
    'missing', to_jsonb(public.coach_profile_missing(cp.id))
  )
  into v_result
  from public.coach_profiles cp
  join public.users u on u.id = cp.user_id
  where cp.id = p_profile;
  return v_result;
end;
$$;
-- create or replace keeps the grants of 20261021100000 / 20261029100000.
