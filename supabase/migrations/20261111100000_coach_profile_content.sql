-- HealthApp schema · Coach profile content: approach, experience, client goals, social links
--
-- The public coach page read like a database record: who, a bio, services.
-- What people deciding on a coach also ask — how do you work, what have you
-- done, who is this for, where can I see more of you — had nowhere to live,
-- so coaches crammed it into `about`. Four fields, all coach-provided (the
-- page labels them as the coach's own words; nothing here is Voinic-verified):
--
--   approach            how they coach (≤ 1500)
--   experience_summary  professional background in their words (≤ 1500)
--   client_goals        who they suit, as closed codes (≤ 6) — not free text,
--                       so the page can translate them and nobody can write
--                       "guaranteed 10 kg in a month" into a badge
--   social_links        instagram / tiktok / youtube / facebook / linkedin
--                       handles and one https website. Handles, not URLs: the
--                       app builds the link, so no javascript: or look-alike
--                       domain can reach the page.
--
-- They are content, so they follow every content rule already there:
-- editable directly only in draft (the edit lock), through a staged revision
-- once published (snapshot / apply), part of the search text (lower weight
-- than name, headline and specializations — 20261111110000).
--
-- The public payload gains them plus `availability` (bookable at all, and the
-- next free slot of a public bookable service in the coach's own zone): the
-- same information coach_booking_slots() already gives anyone, summarised so
-- the page can say "Next free slot: Tue 10:00" above the fold.
--
-- coach_public_profile() and admin_coach_review() are extended by layering:
-- the previous definitions become *_base (internal, no grants) and the public
-- names return base || coach_profile_content(). One builder per field, no
-- 100-line copy to drift.

-- ---------- 1. columns ----------
create or replace function public.coach_social_links_valid(p jsonb)
returns boolean language sql immutable set search_path = public as $$
  select p is not null and jsonb_typeof(p) = 'object'
     and not exists (select 1 from jsonb_object_keys(p) k
                     where k not in ('instagram', 'tiktok', 'youtube', 'facebook', 'linkedin', 'website'))
     and not exists (select 1 from jsonb_each(p) e where jsonb_typeof(e.value) <> 'string')
     and coalesce(p ->> 'instagram', 'x') ~ '^[A-Za-z0-9._]{1,30}$'
     and coalesce(p ->> 'tiktok', 'xx') ~ '^[A-Za-z0-9._]{2,24}$'
     and coalesce(p ->> 'youtube', 'xxx') ~ '^@?[A-Za-z0-9._-]{3,100}$'
     and coalesce(p ->> 'facebook', 'xxxxx') ~ '^[A-Za-z0-9.]{5,50}$'
     and coalesce(p ->> 'linkedin', 'xxx') ~ '^[A-Za-z0-9-]{3,100}$'
     and coalesce(p ->> 'website', 'https://x.ro') ~ '^https://[A-Za-z0-9.-]+\.[A-Za-z]{2,}(/[^\s<>"''`]*)?$'
     and char_length(coalesce(p ->> 'website', '')) <= 200;
$$;

alter table public.coach_profiles
  add column approach text check (approach is null or char_length(approach) <= 1500),
  add column experience_summary text check (experience_summary is null or char_length(experience_summary) <= 1500),
  add column client_goals text[] not null default '{}'
    check (cardinality(client_goals) <= 6
           and client_goals <@ array['fat_loss', 'muscle_gain', 'strength', 'endurance', 'general_fitness',
                                     'sport_performance', 'mobility', 'healthy_habits', 'beginners', 'return_to_training']),
  add column social_links jsonb not null default '{}'::jsonb check (public.coach_social_links_valid(social_links));

comment on column public.coach_profiles.approach is 'How the coach works, in their own words. Coach-provided, shown as such.';
comment on column public.coach_profiles.client_goals is 'Closed codes: who the coach suits. Translated by the app; never free text.';
comment on column public.coach_profiles.social_links is 'Handles (and one https website), never URLs: the app builds every link.';

grant update (approach, experience_summary, client_goals, social_links) on table public.coach_profiles to authenticated;

-- ---------- 2. the edit lock knows them ----------
create or replace function public.coach_profiles_edit_lock()
returns trigger language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon')
     and old.status <> 'draft'
     and (new.slug, new.headline, new.about, new.cover_url, new.coaching_since, new.online, new.in_person,
          new.approach, new.experience_summary, new.client_goals, new.social_links)
         is distinct from
         (old.slug, old.headline, old.about, old.cover_url, old.coaching_since, old.online, old.in_person,
          old.approach, old.experience_summary, old.client_goals, old.social_links)
  then
    raise exception 'PROFILE_LOCKED' using errcode = '55000';
  end if;
  return new;
end;
$$;

-- ---------- 3. staged revisions carry them ----------
create or replace function public.coach_profile_snapshot(p_profile uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'headline', cp.headline, 'about', cp.about, 'coaching_since', cp.coaching_since,
    'online', cp.online, 'in_person', cp.in_person,
    'approach', cp.approach, 'experience_summary', cp.experience_summary,
    'client_goals', to_jsonb(cp.client_goals), 'social_links', cp.social_links,
    'specializations', coalesce((select jsonb_agg(jsonb_build_object('slug', s.slug, 'is_primary', cs.is_primary)
                                                  order by cs.is_primary desc, s.sort_order)
                                 from public.coach_specializations cs join public.specializations s on s.id = cs.specialization_id
                                 where cs.coach_profile_id = cp.id), '[]'::jsonb),
    'languages', coalesce((select jsonb_agg(cl.language_code order by cl.language_code)
                           from public.coach_languages cl where cl.coach_profile_id = cp.id), '[]'::jsonb),
    'locations', coalesce((select jsonb_agg(jsonb_build_object('city_slug', c.slug, 'gym_name', l.gym_name, 'gym_id', l.gym_id)
                                            order by l.created_at)
                           from public.coach_locations l join public.cities c on c.id = l.city_id
                           where l.coach_profile_id = cp.id), '[]'::jsonb),
    'services', coalesce((select jsonb_agg(jsonb_build_object(
                              'id', sv.id, 'name', sv.name, 'description', sv.description, 'kind', sv.kind,
                              'delivery', sv.delivery, 'duration_value', sv.duration_value, 'duration_unit', sv.duration_unit,
                              'price_cents', sv.price_cents, 'currency', sv.currency, 'price_unit', sv.price_unit,
                              'price_public', sv.price_public, 'active', sv.active, 'sort_order', sv.sort_order)
                            order by sv.sort_order, sv.created_at)
                          from public.coach_services sv where sv.coach_profile_id = cp.id), '[]'::jsonb),
    'certifications', coalesce((select jsonb_agg(jsonb_build_object(
                                    'id', ce.id, 'name', ce.name, 'issuer', ce.issuer, 'year', ce.year,
                                    'credential_number', ce.credential_number, 'expires_on', ce.expires_on,
                                    'sort_order', ce.sort_order, 'verification_status', ce.verification_status)
                                  order by ce.sort_order, ce.created_at)
                                from public.coach_certifications ce where ce.coach_profile_id = cp.id), '[]'::jsonb))
  from public.coach_profiles cp where cp.id = p_profile;
$$;
revoke execute on function public.coach_profile_snapshot(uuid) from public, anon, authenticated;

-- The previous apply stays the body for everything it already knew; the new
-- fields are applied after it, each only when the payload carries its key —
-- a revision opened before this migration (no key) keeps the live value.
alter function public.coach_revision_apply(uuid, jsonb) rename to coach_revision_apply_base;
revoke execute on function public.coach_revision_apply_base(uuid, jsonb) from public, anon, authenticated;

create or replace function public.coach_revision_apply(p_profile uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.coach_revision_apply_base(p_profile, p);
  update public.coach_profiles set
    approach = case when p ? 'approach' then nullif(btrim(coalesce(p ->> 'approach', '')), '') else approach end,
    experience_summary = case when p ? 'experience_summary'
                              then nullif(btrim(coalesce(p ->> 'experience_summary', '')), '') else experience_summary end,
    client_goals = case when p ? 'client_goals' and jsonb_typeof(p -> 'client_goals') = 'array'
                        then array(select distinct jsonb_array_elements_text(p -> 'client_goals')) else client_goals end,
    social_links = case when p ? 'social_links' and jsonb_typeof(p -> 'social_links') = 'object'
                        then p -> 'social_links' else social_links end
  where id = p_profile;
end;
$$;
revoke execute on function public.coach_revision_apply(uuid, jsonb) from public, anon, authenticated;

-- ---------- 4. what the page shows ----------
/** The content fields as the public page and the admin review read them. */
create or replace function public.coach_profile_content(p_profile uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'approach', cp.approach,
    'experience_summary', cp.experience_summary,
    'client_goals', to_jsonb(cp.client_goals),
    'social_links', cp.social_links)
  from public.coach_profiles cp where cp.id = p_profile;
$$;
revoke execute on function public.coach_profile_content(uuid) from public, anon, authenticated;

/**
 * Bookable at all, and the next free slot within 14 days across the coach's
 * public bookable services — the same slots coach_booking_slots() serves to
 * anyone, reduced to one instant. In the reader's terms (their own bookings
 * are not free time for them), like the booking page.
 */
create or replace function public.coach_public_availability(p_profile uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'bookable', exists (select 1 from public.coach_services s
                         where s.coach_profile_id = cp.id and s.active and s.bookable and s.booking_access = 'public'),
    'timezone', case when public.booking_timezone_valid(u.timezone) then u.timezone end,
    'next_slot_at', (select min(x.start_at)
                       from public.coach_services s
                       cross join lateral public.booking_slots_internal(
                         s.id, (now() at time zone coalesce(nullif(u.timezone, ''), 'UTC'))::date, 14, auth.uid()) x
                      where s.coach_profile_id = cp.id and s.active and s.bookable and s.booking_access = 'public'))
  from public.coach_profiles cp join public.users u on u.id = cp.user_id
  where cp.id = p_profile;
$$;
revoke execute on function public.coach_public_availability(uuid) from public, anon, authenticated;

alter function public.coach_public_profile(text) rename to coach_public_profile_base;
revoke execute on function public.coach_public_profile_base(text) from public, anon, authenticated;

/** The public page (20261021100000 and after), plus content and availability. Same visibility: base decides. */
create or replace function public.coach_public_profile(p_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select b || public.coach_profile_content((b ->> 'id')::uuid)
           || jsonb_build_object('availability', public.coach_public_availability((b ->> 'id')::uuid))
  from (select public.coach_public_profile_base(p_slug) as b) x
  where x.b is not null;
$$;
revoke execute on function public.coach_public_profile(text) from public;
grant execute on function public.coach_public_profile(text) to anon, authenticated;

alter function public.admin_coach_review(uuid) rename to admin_coach_review_base;
revoke execute on function public.admin_coach_review_base(uuid) from public, anon, authenticated;

create or replace function public.admin_coach_review(p_profile uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb;
begin
  v := public.admin_coach_review_base(p_profile);  -- asserts admin
  return case when v is null then null else v || public.coach_profile_content(p_profile) end;
end;
$$;
revoke execute on function public.admin_coach_review(uuid) from public, anon;
grant execute on function public.admin_coach_review(uuid) to authenticated;
