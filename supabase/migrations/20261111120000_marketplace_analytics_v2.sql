-- HealthApp schema · Marketplace analytics: search, filters, service views, shares, sign-in walls
--
-- Same first-party, cookieless log (20261110120000) — same visitor hash,
-- same daily dedupe, same hourly cap, same "not your own page", same
-- retention. Five more browser events, each with at most one word of detail
-- from a closed list:
--
--   search            the directory ran a typed search. Never the text: a
--                     query can hold a name, a condition, anything — only
--                     the city / specialization context, like directory_view.
--   filter_applied    a filter was set; detail = which one (city, rating…),
--                     never its value beyond the city / specialization slugs
--                     the log already keeps.
--   service_view      a service's booking page was opened (profile target).
--   share             the profile's Share button; detail = native | copy.
--   login_required    an anonymous reader hit a sign-in wall on a profile;
--                     detail = what they wanted (contact, book, save, follow,
--                     review, message, full_profile).
--
-- Name mapping to the product's vocabulary: coach_search = search,
-- coach_filter_applied = filter_applied, coach_profile_view = profile_view,
-- coach_service_view = service_view, coach_save = cta_save (+ coach_saved),
-- coach_contact = cta_contact, coach_book = cta_book,
-- login_required_from_public_profile = login_required, coach_profile_share = share.

alter table public.marketplace_events drop constraint marketplace_events_event_check;
alter table public.marketplace_events add constraint marketplace_events_event_check check (event in (
  -- written by the browser through marketplace_track()
  'directory_view', 'profile_view', 'cta_contact', 'cta_book', 'cta_save', 'cta_full_profile', 'signup_started',
  'search', 'filter_applied', 'service_view', 'share', 'login_required',
  -- written by the database itself
  'signup_completed', 'request_sent', 'request_accepted', 'coaching_started',
  'booking_created', 'booking_completed', 'review_submitted', 'coach_saved'));
alter table public.marketplace_events
  add column detail text check (detail is null or detail ~ '^[a-z_]{1,30}$');

/** The closed detail vocabulary per event; null when the event takes none or the word is unknown. */
create or replace function public.marketplace_detail(p_event text, p_detail text)
returns text language sql immutable set search_path = public as $$
  select case
    when p_event = 'filter_applied' and p_detail = any (array[
      'city', 'country', 'gym', 'format', 'specialization', 'service_kind', 'language', 'experience', 'rating',
      'availability', 'price', 'verified', 'accepting', 'sort']) then p_detail
    when p_event = 'share' and p_detail = any (array['native', 'copy']) then p_detail
    when p_event = 'login_required' and p_detail = any (array[
      'contact', 'book', 'save', 'follow', 'review', 'message', 'full_profile']) then p_detail
    else null end;
$$;

drop function public.marketplace_track(text, text, text, text, text, text, text);

/**
 * Record a view or a click. Returns whether it was counted (false for a
 * bot, your own profile, a coach the public cannot see, a repeat today, or
 * past the hourly cap) — never an error for those, so a beacon is silent.
 * An unknown event is an error: that is a programming mistake.
 */
create or replace function public.marketplace_track(
  p_event text, p_slug text default null, p_source text default null, p_medium text default null,
  p_campaign text default null, p_city text default null, p_specialization text default null, p_detail text default null
) returns boolean language plpgsql volatile security definer set search_path = public as $$
declare
  v_profile uuid;
  v_coach uuid;
  v_visitor text;
  v_city text;
  v_spec text;
  v_detail text := public.marketplace_detail(p_event, p_detail);
  v_n int;
begin
  if p_event is null or p_event not in ('directory_view', 'profile_view', 'cta_contact', 'cta_book', 'cta_save',
                                        'cta_full_profile', 'signup_started', 'search', 'filter_applied',
                                        'service_view', 'share', 'login_required') then
    raise exception 'UNKNOWN_EVENT' using errcode = '22023';
  end if;
  -- events that are about one word of detail are nothing without it
  if p_event in ('filter_applied', 'share', 'login_required') and v_detail is null then
    raise exception 'UNKNOWN_DETAIL' using errcode = '22023';
  end if;
  if public.marketplace_is_bot(public.marketplace_user_agent()) then
    return false;
  end if;

  if p_event not in ('directory_view', 'search', 'filter_applied') then
    select v.profile_id, v.user_id into v_profile, v_coach from public.coach_public_visible(p_slug) v;
    if v_profile is null or v_coach = auth.uid() then
      return false;
    end if;
  else
    select c.slug into v_city from public.cities c where c.slug = lower(btrim(coalesce(p_city, '')));
    select s.slug into v_spec from public.specializations s where s.slug = lower(btrim(coalesce(p_specialization, '')));
  end if;

  v_visitor := public.marketplace_visitor();
  select count(*) into v_n from public.marketplace_events e
   where e.visitor = v_visitor and e.created_at > now() - interval '1 hour';
  if v_n >= 60 then
    return false;
  end if;

  insert into public.marketplace_events (event, coach_profile_id, visitor, signed_in, source, medium, campaign,
                                         city, specialization, detail, dedupe_key)
  values (p_event, v_profile, v_visitor, auth.uid() is not null,
          public.marketplace_clean(p_source, 40), public.marketplace_clean(p_medium, 40), public.marketplace_clean(p_campaign, 80),
          v_city, v_spec, v_detail,
          p_event || ':' || coalesce(v_profile::text, coalesce(v_city, '') || '/' || coalesce(v_spec, ''))
            || ':' || coalesce(v_detail, '') || ':' || v_visitor || ':' || current_date)
  on conflict (dedupe_key) where dedupe_key is not null do nothing;
  return found;
end;
$$;
revoke execute on function public.marketplace_track(text, text, text, text, text, text, text, text) from public;
grant execute on function public.marketplace_track(text, text, text, text, text, text, text, text) to anon, authenticated;

-- retention: the new browser events are views / clicks (180 days)
create or replace function public.marketplace_retention()
returns void language sql security definer set search_path = public as $$
  delete from public.marketplace_events
   where created_at < now() - interval '180 days'
     and event in ('directory_view', 'profile_view', 'cta_contact', 'cta_book', 'cta_save', 'cta_full_profile', 'signup_started',
                   'search', 'filter_applied', 'service_view', 'share', 'login_required');
  delete from public.marketplace_events where created_at < now() - interval '730 days';
  delete from public.marketplace_signups where created_at < now() - interval '730 days';
  delete from public.marketplace_salts where day < current_date;
$$;
revoke execute on function public.marketplace_retention() from public, anon, authenticated;

-- ---------- reads: layered on the existing ones ----------
alter function public.coach_marketplace_analytics(int) rename to coach_marketplace_analytics_base;
revoke execute on function public.coach_marketplace_analytics_base(int) from public, anon, authenticated;

/** The coach's Performance card (20261110120000), plus service views, shares and sign-in walls on their page. */
create or replace function public.coach_marketplace_analytics(p_days int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb := public.coach_marketplace_analytics_base(p_days);
  v_cp uuid;
  v_from timestamptz := now() - make_interval(days => greatest(7, least(coalesce(p_days, 30), 180)));
begin
  if v is null then
    return null;
  end if;
  select id into v_cp from public.coach_profiles where user_id = auth.uid();
  return v || jsonb_build_object(
    'service_views', (select count(*) from public.marketplace_events e
                       where e.coach_profile_id = v_cp and e.event = 'service_view' and e.created_at >= v_from),
    'shares', (select count(*) from public.marketplace_events e
                where e.coach_profile_id = v_cp and e.event = 'share' and e.created_at >= v_from),
    'login_walls', (select count(*) from public.marketplace_events e
                     where e.coach_profile_id = v_cp and e.event = 'login_required' and e.created_at >= v_from));
end;
$$;
revoke execute on function public.coach_marketplace_analytics(int) from public, anon;
grant execute on function public.coach_marketplace_analytics(int) to authenticated;

alter function public.admin_marketplace_analytics(int) rename to admin_marketplace_analytics_base;
revoke execute on function public.admin_marketplace_analytics_base(int) from public, anon, authenticated;

/** /admin/marketplace (20261110120000), with the new events in the funnel and which filters people use. */
create or replace function public.admin_marketplace_analytics(p_weeks int default 12)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb := public.admin_marketplace_analytics_base(p_weeks);  -- asserts admin
  v_from timestamptz := now() - interval '30 days';
begin
  return v || jsonb_build_object(
    'funnel', (
      select jsonb_object_agg(f.event, f.n)
      from (select ev.event, (select count(*) from public.marketplace_events e
                               where e.event = ev.event and e.created_at >= v_from)::int as n
              from unnest(array['directory_view', 'search', 'filter_applied', 'profile_view', 'service_view', 'share',
                                'cta_contact', 'cta_book', 'cta_save', 'cta_full_profile', 'login_required',
                                'signup_started', 'signup_completed', 'request_sent', 'request_accepted', 'coaching_started',
                                'booking_created', 'booking_completed', 'review_submitted', 'coach_saved']) as ev(event)) f),
    'filters', coalesce((select jsonb_agg(jsonb_build_object('filter', x.detail, 'n', x.n) order by x.n desc, x.detail)
                           from (select e.detail, count(*)::int as n from public.marketplace_events e
                                  where e.event = 'filter_applied' and e.created_at >= v_from and e.detail is not null
                                  group by 1) x), '[]'::jsonb),
    'login_walls', coalesce((select jsonb_agg(jsonb_build_object('wanted', x.detail, 'n', x.n) order by x.n desc, x.detail)
                               from (select e.detail, count(*)::int as n from public.marketplace_events e
                                      where e.event = 'login_required' and e.created_at >= v_from and e.detail is not null
                                      group by 1) x), '[]'::jsonb));
end;
$$;
revoke execute on function public.admin_marketplace_analytics(int) from public, anon;
grant execute on function public.admin_marketplace_analytics(int) to authenticated;
