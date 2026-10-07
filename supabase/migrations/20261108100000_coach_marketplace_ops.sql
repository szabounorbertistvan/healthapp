-- HealthApp schema · Coach Discovery: the marketplace's operational side
--
-- 1. Staged revisions (decided 2026-10-07): a published coach edits without
--    going offline. Until now "Edit profile" moved a published profile back
--    to draft — off the directory until an admin approved it again — because
--    content is pre-moderated (decided 2026-10-01, re-confirmed 2026-10-05).
--    Now the published page stays live and unchanged while the coach edits a
--    copy: coach_profile_revisions holds one per profile, a jsonb payload in
--    the shape the editor already reads (profile fields + specializations,
--    languages, locations, services, certifications). An admin approves it
--    and only then does it replace the live content — pre-moderation kept,
--    nothing goes dark.
--
--    No validation is duplicated: coach_revision_check() applies the payload
--    to the real tables inside a savepoint, runs the real completeness check
--    (coach_profile_missing) and rolls back — every constraint, trigger and
--    catalog check of the live write paths judges the copy. The three set
--    RPCs become thin wrappers over coach_apply_*(profile, …), which the
--    revision apply calls too.
--
--    Out of a revision, on purpose: the slug (the public URL), the cover (an
--    upload overwrites a fixed asset, so a "pending" cover would replace the
--    live one) and the operational switches that were never moderated —
--    accepting clients, hide / show, service on/off and order, booking
--    settings. Services removed in a revision are deleted only when nothing
--    points at them (bookings, requests); otherwise they are switched off,
--    so history keeps its service.
--
-- 2. coach_marketplace_overview(): the coach's marketplace at a glance in one
--    round trip — profile state, requests, bookings, clients, unread
--    messages, services, availability, reviews. Counts of the caller's own
--    rows only; no analytics that do not exist (no profile views).
--
-- 3. A missing notice: starting coaching from a request told nobody. It now
--    tells the client (coaching_request, event 'started').

-- ---------- 1a. the set RPCs, split into an internal apply + the coach's door ----------
create or replace function public.coach_apply_specializations(p_profile uuid, p_slugs text[], p_primary text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_slugs text[] := coalesce(p_slugs, '{}');
begin
  if cardinality(v_slugs) > 8 then
    raise exception 'TOO_MANY_SPECIALIZATIONS' using errcode = '22023';
  end if;
  if exists (select unnest(v_slugs) except select slug from public.specializations where active)
     or (p_primary is not null and not (p_primary = any (v_slugs))) then
    raise exception 'UNKNOWN_SPECIALIZATION' using errcode = '22023';
  end if;
  delete from public.coach_specializations where coach_profile_id = p_profile;
  insert into public.coach_specializations (coach_profile_id, specialization_id, is_primary)
  select p_profile, s.id, s.slug = coalesce(p_primary, '')
  from public.specializations s
  where s.slug = any (v_slugs);
end;
$$;
revoke execute on function public.coach_apply_specializations(uuid, text[], text) from public, anon, authenticated;

create or replace function public.coach_set_specializations(p_slugs text[], p_primary text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.coach_apply_specializations(public.coach_my_editable_profile(), p_slugs, p_primary);
end;
$$;

create or replace function public.coach_apply_languages(p_profile uuid, p_codes text[])
returns void language plpgsql security definer set search_path = public as $$
declare
  v_codes text[] := coalesce(p_codes, '{}');
begin
  if cardinality(v_codes) > 10 then
    raise exception 'TOO_MANY_LANGUAGES' using errcode = '22023';
  end if;
  if exists (select unnest(v_codes) except select code from public.languages where active) then
    raise exception 'UNKNOWN_LANGUAGE' using errcode = '22023';
  end if;
  delete from public.coach_languages where coach_profile_id = p_profile;
  insert into public.coach_languages (coach_profile_id, language_code)
  select distinct p_profile, c from unnest(v_codes) c;
end;
$$;
revoke execute on function public.coach_apply_languages(uuid, text[]) from public, anon, authenticated;

create or replace function public.coach_set_languages(p_codes text[])
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.coach_apply_languages(public.coach_my_editable_profile(), p_codes);
end;
$$;

create or replace function public.coach_apply_locations(p_profile uuid, p_locations jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_items jsonb := coalesce(p_locations, '[]'::jsonb);
begin
  if jsonb_typeof(v_items) <> 'array' then
    raise exception 'INVALID_LOCATIONS' using errcode = '22023';
  end if;
  if jsonb_array_length(v_items) > 5 then
    raise exception 'TOO_MANY_LOCATIONS' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(v_items) e
             where not exists (select 1 from public.cities c
                               where c.slug = e ->> 'city' and c.active)) then
    raise exception 'UNKNOWN_CITY' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(v_items) e
             where char_length(btrim(coalesce(e ->> 'gym_name', ''))) > 120) then
    raise exception 'GYM_NAME_TOO_LONG' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(v_items) e
             where nullif(e ->> 'gym_id', '') is not null
               and (e ->> 'gym_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                    or not exists (select 1 from public.gyms g
                                   where g.id = (e ->> 'gym_id')::uuid and g.status = 'active'))) then
    raise exception 'GYM_NOT_FOUND' using errcode = '22023';
  end if;
  delete from public.coach_locations where coach_profile_id = p_profile;
  insert into public.coach_locations (coach_profile_id, city_id, gym_id, gym_name)
  select distinct on (c.id) p_profile, c.id, g.id, coalesce(g.name, nullif(btrim(e ->> 'gym_name'), ''))
  from jsonb_array_elements(v_items) e
  join public.cities c on c.slug = e ->> 'city'
  left join public.gyms g on g.id = (nullif(e ->> 'gym_id', ''))::uuid and g.status = 'active';
end;
$$;
revoke execute on function public.coach_apply_locations(uuid, jsonb) from public, anon, authenticated;

create or replace function public.coach_set_locations(p_locations jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.coach_apply_locations(public.coach_my_editable_profile(), p_locations);
end;
$$;

-- ---------- 1b. the revision ----------
create table public.coach_profile_revisions (
  coach_profile_id uuid primary key references public.coach_profiles (id) on delete cascade,
  status text not null default 'editing' check (status in ('editing', 'pending_review', 'rejected')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  review_note text check (review_note is null or char_length(review_note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  decided_at timestamptz,
  decided_by uuid references public.users (id) on delete set null
);
create trigger coach_profile_revisions_updated before update on public.coach_profile_revisions
  for each row execute function public.handle_updated_at();
create index coach_profile_revisions_pending_idx on public.coach_profile_revisions (submitted_at) where status = 'pending_review';
alter table public.coach_profile_revisions enable row level security;
-- read and written through the RPCs below only
revoke all on table public.coach_profile_revisions from anon, authenticated;

/** The editable content of a profile, in the payload shape (what the editor reads). */
create or replace function public.coach_profile_snapshot(p_profile uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'headline', cp.headline, 'about', cp.about, 'coaching_since', cp.coaching_since,
    'online', cp.online, 'in_person', cp.in_person,
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

/**
 * Write a payload into the live tables (internal). Called for real when an
 * admin approves, and inside a rolled-back savepoint by coach_revision_check.
 */
create or replace function public.coach_revision_apply(p_profile uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_item jsonb;
  v_id uuid;
  v_keep uuid[] := '{}';
begin
  update public.coach_profiles set
    headline = nullif(btrim(coalesce(p ->> 'headline', '')), ''),
    about = nullif(btrim(coalesce(p ->> 'about', '')), ''),
    coaching_since = (p ->> 'coaching_since')::int,
    online = coalesce((p ->> 'online')::boolean, false),
    in_person = coalesce((p ->> 'in_person')::boolean, false)
  where id = p_profile;

  perform public.coach_apply_specializations(p_profile,
    array(select e ->> 'slug' from jsonb_array_elements(coalesce(p -> 'specializations', '[]')) e),
    (select e ->> 'slug' from jsonb_array_elements(coalesce(p -> 'specializations', '[]')) e
     where coalesce((e ->> 'is_primary')::boolean, false) limit 1));
  perform public.coach_apply_languages(p_profile,
    array(select jsonb_array_elements_text(coalesce(p -> 'languages', '[]'))));
  perform public.coach_apply_locations(p_profile,
    coalesce((select jsonb_agg(jsonb_build_object('city', e ->> 'city_slug', 'gym_id', e ->> 'gym_id', 'gym_name', e ->> 'gym_name'))
              from jsonb_array_elements(coalesce(p -> 'locations', '[]')) e), '[]'::jsonb));

  -- services: update the coach's own by id, insert the new ones, never touch another coach's
  for v_item in select * from jsonb_array_elements(coalesce(p -> 'services', '[]')) loop
    v_id := nullif(v_item ->> 'id', '')::uuid;
    if v_id is not null and exists (select 1 from public.coach_services where id = v_id and coach_profile_id = p_profile) then
      update public.coach_services set
        name = btrim(v_item ->> 'name'), description = nullif(btrim(coalesce(v_item ->> 'description', '')), ''),
        kind = v_item ->> 'kind', delivery = coalesce(v_item ->> 'delivery', 'online'),
        duration_value = (v_item ->> 'duration_value')::int, duration_unit = v_item ->> 'duration_unit',
        price_cents = (v_item ->> 'price_cents')::int, currency = coalesce(v_item ->> 'currency', 'RON'),
        price_unit = v_item ->> 'price_unit', price_public = coalesce((v_item ->> 'price_public')::boolean, true),
        active = coalesce((v_item ->> 'active')::boolean, true), sort_order = coalesce((v_item ->> 'sort_order')::int, 0),
        -- a plan without a live session cannot stay bookable (20261105100000)
        bookable = bookable and coalesce(v_item ->> 'delivery', 'online') <> 'digital'
      where id = v_id;
    elsif v_id is null or not exists (select 1 from public.coach_services where id = v_id) then
      v_id := coalesce(v_id, gen_random_uuid());
      insert into public.coach_services (id, coach_profile_id, name, description, kind, delivery, duration_value, duration_unit,
                                         price_cents, currency, price_unit, price_public, active, sort_order)
      values (v_id, p_profile, btrim(v_item ->> 'name'), nullif(btrim(coalesce(v_item ->> 'description', '')), ''),
              v_item ->> 'kind', coalesce(v_item ->> 'delivery', 'online'),
              (v_item ->> 'duration_value')::int, v_item ->> 'duration_unit', (v_item ->> 'price_cents')::int,
              coalesce(v_item ->> 'currency', 'RON'), v_item ->> 'price_unit', coalesce((v_item ->> 'price_public')::boolean, true),
              coalesce((v_item ->> 'active')::boolean, true), coalesce((v_item ->> 'sort_order')::int, 0));
    else
      raise exception 'NOT_FOUND' using errcode = 'P0002';
    end if;
    v_keep := v_keep || v_id;
  end loop;
  -- removed in the revision: gone when nothing points at it, switched off when history does
  delete from public.coach_services sv
   where sv.coach_profile_id = p_profile and not (sv.id = any (v_keep))
     and not exists (select 1 from public.bookings b where b.service_id = sv.id)
     and not exists (select 1 from public.coaching_requests r where r.service_id = sv.id);
  update public.coach_services set active = false, bookable = false
   where coach_profile_id = p_profile and not (id = any (v_keep)) and (active or bookable);

  -- certifications: the same, and a removed one is simply removed
  v_keep := '{}';
  for v_item in select * from jsonb_array_elements(coalesce(p -> 'certifications', '[]')) loop
    v_id := nullif(v_item ->> 'id', '')::uuid;
    if v_id is not null and exists (select 1 from public.coach_certifications where id = v_id and coach_profile_id = p_profile) then
      update public.coach_certifications set
        name = btrim(v_item ->> 'name'), issuer = nullif(btrim(coalesce(v_item ->> 'issuer', '')), ''),
        year = (v_item ->> 'year')::int, credential_number = nullif(btrim(coalesce(v_item ->> 'credential_number', '')), ''),
        expires_on = (nullif(v_item ->> 'expires_on', ''))::date, sort_order = coalesce((v_item ->> 'sort_order')::int, 0)
      where id = v_id;
    elsif v_id is null or not exists (select 1 from public.coach_certifications where id = v_id) then
      v_id := coalesce(v_id, gen_random_uuid());
      insert into public.coach_certifications (id, coach_profile_id, name, issuer, year, credential_number, expires_on, sort_order)
      values (v_id, p_profile, btrim(v_item ->> 'name'), nullif(btrim(coalesce(v_item ->> 'issuer', '')), ''),
              (v_item ->> 'year')::int, nullif(btrim(coalesce(v_item ->> 'credential_number', '')), ''),
              (nullif(v_item ->> 'expires_on', ''))::date, coalesce((v_item ->> 'sort_order')::int, 0));
    else
      raise exception 'NOT_FOUND' using errcode = 'P0002';
    end if;
    v_keep := v_keep || v_id;
  end loop;
  delete from public.coach_certifications where coach_profile_id = p_profile and not (id = any (v_keep));
end;
$$;
revoke execute on function public.coach_revision_apply(uuid, jsonb) from public, anon, authenticated;

/**
 * Judge a payload by the real thing: apply it inside a savepoint, read what
 * coach_profile_missing() says, roll back. Returns the missing codes; a
 * payload the tables refuse raises that refusal (as 22023).
 */
create or replace function public.coach_revision_check(p_profile uuid, p_payload jsonb)
returns text[] language plpgsql security definer set search_path = public as $$
declare
  v_missing text[];
  v_error text;
begin
  begin
    perform public.coach_revision_apply(p_profile, p_payload);
    v_missing := public.coach_profile_missing(p_profile);
    raise exception 'REVISION_DRY_RUN';
  exception when others then
    if sqlerrm <> 'REVISION_DRY_RUN' then
      v_error := sqlerrm;
    end if;
  end;
  if v_error is not null then
    raise exception 'INVALID_REVISION: %', v_error using errcode = '22023';
  end if;
  return coalesce(v_missing, '{}');
end;
$$;
revoke execute on function public.coach_revision_check(uuid, jsonb) from public, anon, authenticated;

-- a profile back in draft is edited directly: an open revision is moot
create or replace function public.coach_profile_revision_reset()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'draft' and old.status is distinct from 'draft' then
    delete from public.coach_profile_revisions where coach_profile_id = new.id;
  end if;
  return null;
end;
$$;
revoke execute on function public.coach_profile_revision_reset() from public, anon, authenticated;
create trigger coach_profiles_revision_reset after update of status on public.coach_profiles
  for each row execute function public.coach_profile_revision_reset();

-- ---------- 1c. the coach's doors ----------
create or replace function public.coach_my_live_profile()
returns uuid language plpgsql stable security definer set search_path = public as $$
declare
  v_id uuid;
  v_status text;
begin
  select id, status into v_id, v_status from public.coach_profiles where user_id = auth.uid();
  if v_id is null then
    raise exception 'NO_COACH_PROFILE' using errcode = 'P0002';
  end if;
  if v_status not in ('published', 'hidden') then
    raise exception 'BAD_TRANSITION' using errcode = '22023';
  end if;
  return v_id;
end;
$$;
revoke execute on function public.coach_my_live_profile() from public, anon, authenticated;

/** Start (or reopen) editing a published or hidden profile: a copy of what is live. */
create or replace function public.coach_revision_start()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_profile uuid := public.coach_my_live_profile();
begin
  insert into public.coach_profile_revisions (coach_profile_id, payload)
  values (v_profile, public.coach_profile_snapshot(v_profile))
  on conflict (coach_profile_id) do nothing;
  return (select payload from public.coach_profile_revisions where coach_profile_id = v_profile);
end;
$$;
revoke execute on function public.coach_revision_start() from public, anon;
grant execute on function public.coach_revision_start() to authenticated;

/** The caller's open revision with what it still lacks, or null. */
create or replace function public.coach_my_revision()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_rev public.coach_profile_revisions;
begin
  select r.* into v_rev from public.coach_profile_revisions r
  join public.coach_profiles cp on cp.id = r.coach_profile_id
  where cp.user_id = auth.uid() and cp.status in ('published', 'hidden');
  if v_rev.coach_profile_id is null then
    return null;
  end if;
  return jsonb_build_object('status', v_rev.status, 'review_note', v_rev.review_note,
    'submitted_at', v_rev.submitted_at, 'updated_at', v_rev.updated_at, 'payload', v_rev.payload,
    'missing', to_jsonb(public.coach_revision_check(v_rev.coach_profile_id, v_rev.payload)));
end;
$$;
revoke execute on function public.coach_my_revision() from public, anon;
grant execute on function public.coach_my_revision() to authenticated;

/**
 * Save the whole copy (the editor patches it and sends it back). Judged by
 * the real tables first; incomplete is fine (checked on submit), invalid is
 * refused. Saving while in review takes it out of review, like a draft.
 */
create or replace function public.coach_revision_save(p_payload jsonb)
returns text[] language plpgsql security definer set search_path = public as $$
declare
  v_profile uuid := public.coach_my_live_profile();
  v_missing text[];
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'INVALID_REVISION' using errcode = '22023';
  end if;
  if not exists (select 1 from public.coach_profile_revisions where coach_profile_id = v_profile) then
    raise exception 'NO_REVISION' using errcode = 'P0002';
  end if;
  v_missing := public.coach_revision_check(v_profile, p_payload);
  update public.coach_profile_revisions
     set payload = p_payload, status = 'editing', submitted_at = null
   where coach_profile_id = v_profile;
  return v_missing;
end;
$$;
revoke execute on function public.coach_revision_save(jsonb) from public, anon;
grant execute on function public.coach_revision_save(jsonb) to authenticated;

/** Send the copy to an admin. Returns what is missing (and changes nothing) when it is not complete. */
create or replace function public.coach_revision_submit()
returns text[] language plpgsql security definer set search_path = public as $$
declare
  v_profile uuid := public.coach_my_live_profile();
  v_payload jsonb;
  v_missing text[];
begin
  select payload into v_payload from public.coach_profile_revisions where coach_profile_id = v_profile for update;
  if v_payload is null then
    raise exception 'NO_REVISION' using errcode = 'P0002';
  end if;
  v_missing := public.coach_revision_check(v_profile, v_payload);
  if cardinality(v_missing) > 0 then
    return v_missing;
  end if;
  update public.coach_profile_revisions
     set status = 'pending_review', submitted_at = now(), review_note = null
   where coach_profile_id = v_profile;
  return '{}';
end;
$$;
revoke execute on function public.coach_revision_submit() from public, anon;
grant execute on function public.coach_revision_submit() to authenticated;

/** Throw the copy away; the live page never changed. */
create or replace function public.coach_revision_discard()
returns void language sql security definer set search_path = public as $$
  delete from public.coach_profile_revisions r
  using public.coach_profiles cp
  where cp.id = r.coach_profile_id and cp.user_id = auth.uid();
$$;
revoke execute on function public.coach_revision_discard() from public, anon;
grant execute on function public.coach_revision_discard() to authenticated;

-- ---------- 1d. the admin's doors ----------
/** One profile's revision for /admin/coaches/[id]: live and proposed, side by side. */
create or replace function public.admin_coach_revision(p_profile uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_rev public.coach_profile_revisions;
begin
  perform public.admin_assert();
  select * into v_rev from public.coach_profile_revisions where coach_profile_id = p_profile;
  if v_rev.coach_profile_id is null then
    return null;
  end if;
  return jsonb_build_object('status', v_rev.status, 'review_note', v_rev.review_note, 'submitted_at', v_rev.submitted_at,
    'live', public.coach_profile_snapshot(p_profile), 'payload', v_rev.payload,
    'missing', to_jsonb(public.coach_revision_check(p_profile, v_rev.payload)));
end;
$$;
revoke execute on function public.admin_coach_revision(uuid) from public, anon;
grant execute on function public.admin_coach_revision(uuid) to authenticated;

/** Profiles with a revision waiting for review, oldest first. */
create or replace function public.admin_coach_revisions_pending()
returns table (coach_profile_id uuid, slug text, display_name text, submitted_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.admin_assert();
  return query
    select r.coach_profile_id, cp.slug, public.public_display_name(u.username, u.full_name), r.submitted_at
    from public.coach_profile_revisions r
    join public.coach_profiles cp on cp.id = r.coach_profile_id
    join public.users u on u.id = cp.user_id
    where r.status = 'pending_review'
    order by r.submitted_at;
end;
$$;
revoke execute on function public.admin_coach_revisions_pending() from public, anon;
grant execute on function public.admin_coach_revisions_pending() to authenticated;

/** Approve (the copy replaces the live content) or reject (with a note the coach sees). Audited. */
create or replace function public.admin_decide_coach_revision(p_profile uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_rev public.coach_profile_revisions;
  v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 1000);
  v_user uuid;
begin
  perform public.admin_assert();
  select * into v_rev from public.coach_profile_revisions where coach_profile_id = p_profile for update;
  if v_rev.coach_profile_id is null or v_rev.status <> 'pending_review' then
    raise exception 'BAD_TRANSITION' using errcode = '22023';
  end if;
  select user_id into v_user from public.coach_profiles where id = p_profile;
  if coalesce(p_approve, false) then
    if cardinality(public.coach_revision_check(p_profile, v_rev.payload)) > 0 then
      raise exception 'PROFILE_INCOMPLETE' using errcode = '22023';
    end if;
    perform public.coach_revision_apply(p_profile, v_rev.payload);
    update public.coach_profiles set reviewed_at = now(), reviewed_by = auth.uid() where id = p_profile;
    delete from public.coach_profile_revisions where coach_profile_id = p_profile;
  else
    if v_note is null then
      raise exception 'REASON_REQUIRED' using errcode = '22023';
    end if;
    update public.coach_profile_revisions
       set status = 'rejected', review_note = v_note, decided_at = now(), decided_by = auth.uid()
     where coach_profile_id = p_profile;
  end if;
  perform public.audit_log('ADMIN_ACTION', 'coach_profile', p_profile::text, v_user,
    jsonb_build_object('op', 'coach_revision', 'approved', coalesce(p_approve, false), 'note', v_note));
end;
$$;
revoke execute on function public.admin_decide_coach_revision(uuid, boolean, text) from public, anon;
grant execute on function public.admin_decide_coach_revision(uuid, boolean, text) to authenticated;

-- ---------- 2. the marketplace at a glance ----------
create or replace function public.coach_marketplace_overview()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'profile', (select jsonb_build_object(
                  'id', cp.id, 'slug', cp.slug, 'status', cp.status, 'verification_status', cp.verification_status,
                  'accepting_clients', cp.accepting_clients, 'review_count', cp.review_count, 'review_avg', cp.review_avg,
                  'review_note', cp.review_note,
                  'revision_status', (select r.status from public.coach_profile_revisions r where r.coach_profile_id = cp.id))
                from public.coach_profiles cp where cp.user_id = auth.uid()),
    'requests', jsonb_build_object(
      'pending', (select count(*)::int from public.coaching_requests r where r.coach_id = auth.uid() and r.status = 'pending'),
      'accepted', (select count(*)::int from public.coaching_requests r
                   where r.coach_id = auth.uid() and r.status = 'accepted' and r.trainer_client_id is null)),
    'bookings', jsonb_build_object(
      'pending', (select count(*)::int from public.bookings b where b.coach_id = auth.uid() and b.status = 'pending' and b.start_at > now()),
      'upcoming', (select count(*)::int from public.bookings b where b.coach_id = auth.uid() and b.status = 'confirmed' and b.start_at > now()),
      'needs_outcome', (select count(*)::int from public.bookings b where b.coach_id = auth.uid() and b.status = 'confirmed' and b.start_at <= now()),
      'next', (select jsonb_build_object('start_at', b.start_at, 'end_at', b.end_at, 'timezone', b.timezone,
                                         'service_name', b.service_name, 'status', b.status,
                                         'client_name', public.public_display_name(u.username, u.full_name))
               from public.bookings b join public.users u on u.id = b.client_id
               where b.coach_id = auth.uid() and b.status in ('pending', 'confirmed') and b.start_at > now()
               order by b.start_at limit 1)),
    'clients', jsonb_build_object(
      'active', (select count(*)::int from public.trainer_clients tc where tc.coach_id = auth.uid() and tc.status = 'active'),
      'invited', (select count(*)::int from public.trainer_clients tc where tc.coach_id = auth.uid() and tc.status = 'invited')),
    'messages', jsonb_build_object(
      'unread', (select count(*)::int from public.messages m join public.conversations c on c.id = m.conversation_id
                 where c.coach_id = auth.uid() and m.sender_id = c.client_id and m.read_at is null),
      'conversations_unread', (select count(distinct c.id)::int from public.messages m join public.conversations c on c.id = m.conversation_id
                               where c.coach_id = auth.uid() and m.sender_id = c.client_id and m.read_at is null)),
    'services', (select jsonb_build_object('active', count(*) filter (where sv.active)::int,
                                           'bookable', count(*) filter (where sv.active and sv.bookable)::int)
                 from public.coach_services sv join public.coach_profiles cp on cp.id = sv.coach_profile_id
                 where cp.user_id = auth.uid()),
    'availability', jsonb_build_object(
      'blocks', (select count(*)::int from public.coach_availability a where a.coach_id = auth.uid() and a.active)),
    'reviews', jsonb_build_object(
      'latest', coalesce((select jsonb_agg(x order by x.created_at desc) from (
                  select r.id, r.rating, r.body, r.created_at, r.coach_response is not null as answered,
                         public.public_display_name(u.username, u.full_name) as reviewer_name
                  from public.coach_reviews r join public.users u on u.id = r.reviewer_id
                  where r.coach_id = auth.uid() and r.status = 'published'
                  order by r.created_at desc limit 3) x), '[]'::jsonb))
  )
  where auth.uid() is not null;
$$;
revoke execute on function public.coach_marketplace_overview() from public, anon;
grant execute on function public.coach_marketplace_overview() to authenticated;

-- ---------- 3. "started": the client is told coaching began ----------
create or replace function public.coach_request_notify(p_recipient uuid, p_actor uuid, p_event text, p_request uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_name text;
begin
  if not public.social_notify_ok(p_recipient, p_actor) then
    return;
  end if;
  select public.public_display_name(u.username, u.full_name) into v_name from public.users u where u.id = p_actor;
  insert into public.notifications (user_id, category, title, body, payload)
  values (p_recipient, 'coaching_request',
          case p_event when 'sent' then 'New coaching request' when 'accepted' then 'Request accepted'
                       when 'declined' then 'Request declined' when 'started' then 'Coaching started'
                       else 'Request cancelled' end,
          case p_event when 'sent' then v_name || ' would like to work with you'
                       when 'accepted' then v_name || ' accepted your request'
                       when 'declined' then v_name || ' declined your request'
                       when 'started' then v_name || ' started coaching you'
                       else v_name || ' cancelled their request' end,
          jsonb_build_object('request_id', p_request, 'actor_id', p_actor, 'event', p_event,
                             'screen', case when p_event in ('sent', 'cancelled') then 'coach_requests'
                                            when p_event = 'started' then 'coach'
                                            else 'my_requests' end));
end;
$$;
revoke execute on function public.coach_request_notify(uuid, uuid, text, uuid) from public, anon, authenticated;

-- start_coaching_from_request (20261103100000) plus the notice
create or replace function public.start_coaching_from_request(p_request uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_row public.coaching_requests;
  v_tc uuid;
begin
  if not public.social_actor_active() then
    raise exception 'NOT_SIGNED_IN' using errcode = '42501';
  end if;
  select * into v_row from public.coaching_requests
   where id = p_request and coach_id = auth.uid() and status = 'accepted'
   for update;
  if not found or not public.is_listed_user(v_row.client_id) then
    raise exception 'REQUEST_NOT_ACCEPTED' using errcode = '55000';
  end if;
  if v_row.trainer_client_id is not null then
    raise exception 'ALREADY_COACHED' using errcode = '55000';
  end if;
  perform 1 from public.users where id = v_row.client_id for update;
  if exists (select 1 from public.trainer_clients where client_id = v_row.client_id and status = 'active') then
    raise exception 'ALREADY_HAS_COACH' using errcode = '55000';
  end if;

  insert into public.trainer_clients (coach_id, client_id, status, started_at)
  values (v_row.coach_id, v_row.client_id, 'active', now())
  returning id into v_tc;
  insert into public.conversations (coach_id, client_id)
  values (v_row.coach_id, v_row.client_id)
  on conflict (coach_id, client_id) do nothing;
  update public.coaching_requests set trainer_client_id = v_tc where id = v_row.id;
  update public.coaching_requests set status = 'closed', resolved_at = now()
   where client_id = v_row.client_id and status = 'pending';
  perform public.coach_request_notify(v_row.client_id, auth.uid(), 'started', v_row.id);
  return v_tc;
end;
$$;

/** The caller's open revision payload, without the completeness check — what the editor's writes patch. */
create or replace function public.coach_my_revision_payload()
returns jsonb language sql stable security definer set search_path = public as $$
  select r.payload from public.coach_profile_revisions r
  join public.coach_profiles cp on cp.id = r.coach_profile_id
  where cp.user_id = auth.uid() and cp.status in ('published', 'hidden');
$$;
revoke execute on function public.coach_my_revision_payload() from public, anon;
grant execute on function public.coach_my_revision_payload() to authenticated;
