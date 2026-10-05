-- HealthApp schema · Coach Discovery: Hide / Show, and the admin review UI's reads
--
-- Decided 2026-10-05 (the user, keeping pre-moderation from 2026-10-01):
--
-- 1. A published coach can HIDE their profile and SHOW it again, instantly
--    and without a new review:
--        published --hide--> hidden --show--> published
--    Content stays locked while hidden (coach_profiles_edit_lock and every
--    coach_profile_editable() policy only open in 'draft'), so what comes
--    back is exactly what an admin approved. Show re-runs
--    coach_profile_missing() (an avatar can be removed while hidden) and
--    returns what is missing instead of raising, like submit does.
--    Every public door already requires status = 'published', so a hidden
--    coach leaves search, facets, the public page and coaching requests at
--    once; the account, posts and programs are untouched.
--    Editing a hidden profile is withdraw -> draft -> submit, as from published.
--
-- 2. admin_set_coach_profile_status() learns 'hidden': an admin may send a
--    hidden profile back to draft (with a reason) or suspend it. Admins
--    cannot hide or show: that is the coach's own switch.
--
-- 3. admin_coach_review(id): one profile for the /admin/coaches review page,
--    the same public shape as coach_public_profile() (so the page reuses the
--    real profile component as the preview), for any status, plus the review
--    fields and the open checklist. admin_coach_profile_counts(): the queue's
--    numbers per status.
--
-- The coach still never writes status: hide / show are security definer
-- functions keyed on auth.uid(), with no profile argument to point elsewhere.

alter table public.coach_profiles drop constraint coach_profiles_status_check;
alter table public.coach_profiles add constraint coach_profiles_status_check
  check (status in ('draft', 'pending_review', 'published', 'hidden', 'suspended'));

-- ---------- 1. the coach's switch ----------
create or replace function public.hide_coach_profile()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_status text;
begin
  select id, status into v_id, v_status from public.coach_profiles
  where user_id = auth.uid() for update;
  if v_id is null then
    raise exception 'NO_COACH_PROFILE' using errcode = 'P0002';
  end if;
  if v_status <> 'published' then
    raise exception 'BAD_TRANSITION' using errcode = '55000';
  end if;
  update public.coach_profiles set status = 'hidden' where id = v_id;
end;
$$;

-- hidden -> published. Returns the missing items (and stays hidden) when the
-- profile no longer passes the checklist; an empty array means it is public.
create or replace function public.show_coach_profile()
returns text[] language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_status text;
  v_missing text[];
begin
  select id, status into v_id, v_status from public.coach_profiles
  where user_id = auth.uid() for update;
  if v_id is null then
    raise exception 'NO_COACH_PROFILE' using errcode = 'P0002';
  end if;
  if v_status <> 'hidden' then
    raise exception 'BAD_TRANSITION' using errcode = '55000';
  end if;
  v_missing := public.coach_profile_missing(v_id);
  if cardinality(v_missing) > 0 then
    return v_missing;
  end if;
  update public.coach_profiles set status = 'published' where id = v_id;
  return '{}';
end;
$$;

revoke execute on function public.hide_coach_profile() from public, anon;
grant execute on function public.hide_coach_profile() to authenticated;
revoke execute on function public.show_coach_profile() from public, anon;
grant execute on function public.show_coach_profile() to authenticated;

-- withdraw from 20261020100000, plus hidden -> draft (to edit).
create or replace function public.withdraw_coach_profile()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_status text;
begin
  select id, status into v_id, v_status from public.coach_profiles
  where user_id = auth.uid() for update;
  if v_id is null then
    raise exception 'NO_COACH_PROFILE' using errcode = 'P0002';
  end if;
  if v_status not in ('pending_review', 'published', 'hidden') then
    raise exception 'BAD_TRANSITION' using errcode = '55000';
  end if;
  update public.coach_profiles set status = 'draft', submitted_at = null where id = v_id;
end;
$$;

-- ---------- 2. admin transitions (20261020100000 + hidden) ----------
create or replace function public.admin_set_coach_profile_status(
  p_profile uuid, p_status text, p_reason text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_cp public.coach_profiles;
  v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 1000);
begin
  perform public.admin_assert();
  select * into v_cp from public.coach_profiles where id = p_profile for update;
  if not found then
    raise exception 'NO_COACH_PROFILE' using errcode = 'P0002';
  end if;
  if not (
       (v_cp.status = 'pending_review' and p_status in ('published', 'draft'))
    or (v_cp.status in ('published', 'hidden') and p_status = 'draft')
    or (v_cp.status <> 'suspended' and p_status = 'suspended')
    or (v_cp.status = 'suspended' and p_status in ('published', 'draft'))
  ) then
    raise exception 'BAD_TRANSITION' using errcode = '22023';
  end if;
  if v_reason is null and (p_status = 'suspended' or (p_status = 'draft' and v_cp.status <> 'suspended')) then
    raise exception 'REASON_REQUIRED' using errcode = '22023';
  end if;

  update public.coach_profiles set
    status = p_status,
    reviewed_at = now(),
    reviewed_by = auth.uid(),
    published_at = case when p_status = 'published' then coalesce(published_at, now()) else published_at end,
    review_note = case when p_status = 'draft' then v_reason when p_status = 'published' then null else review_note end,
    suspended_at = case when p_status = 'suspended' then now() end,
    suspension_reason = case when p_status = 'suspended' then v_reason end
  where id = p_profile;

  perform public.audit_log('ADMIN_ACTION', 'coach_profile', p_profile::text, v_cp.user_id,
    jsonb_build_object('op', 'coach_profile_status', 'from', v_cp.status, 'to', p_status, 'reason', v_reason));
end;
$$;

-- ---------- 3. the admin review page ----------
/**
 * One coach profile for /admin/coaches/<id>, any status. The first part is
 * coach_public_profile()'s shape (20261028100000): the review page draws it
 * with the public page's own component. Then what only an admin sees.
 */
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
    'suspended', count(*) filter (where status = 'suspended'))
  into v_result from public.coach_profiles;
  return v_result;
end;
$$;

revoke execute on function public.admin_coach_review(uuid) from public, anon;
grant execute on function public.admin_coach_review(uuid) to authenticated;
revoke execute on function public.admin_coach_profile_counts() from public, anon;
grant execute on function public.admin_coach_profile_counts() to authenticated;
