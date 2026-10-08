-- HealthApp schema · Coach Marketplace launch readiness (pre-monetization)
--
-- An audit of the marketplace before launch found these gaps; each is closed
-- here by extending what exists — no new system, no change to the ranking
-- formula:
--
-- 1. Ratings counted reviews the public cannot see. coach_public_reviews()
--    already leaves out reviewers who are suspended or being deleted, but
--    review_count / review_avg / review_distribution (and so the ranking's
--    Bayesian rating) still included them: a banned spam account's 5★ kept
--    lifting a coach. The aggregate now follows the list, and is recomputed
--    when a reviewer is suspended, restored, or asks for deletion.
-- 2. Engagement could be pumped. The ranking's engagement part counted every
--    coaching request in 90 days and every save: one account could cancel and
--    re-send, or throwaway accounts could save. Requests now count once per
--    client, and only requests and saves from live accounts (not suspended,
--    no deletion pending) count. Views were already one per visitor per day
--    and never the coach's own. Weights unchanged.
-- 3. Notices: an admin's decision on a coach's staged changes now tells the
--    coach (approved / sent back), like every other profile decision already
--    did; a session marked completed asks the client for a review — once, and
--    only while they have not written one for that coach.
-- 4. The public page can only offer Book when the coach has weekly hours:
--    coach_public_availability() gains has_hours.
-- 5. Operations: admin_coach_marketplace_summary() (one coach's marketplace
--    numbers and moderation history, for /admin/coaches/[id]) and
--    admin_coach_attention() (profiles that need a look: open reports,
--    rejected verification, expired credentials, a poor rating, a live
--    profile missing its essentials, a live profile on a suspended account,
--    a coach accepting clients who has not signed in for 60 days).
-- 6. A credential decision is audited with what it was before.

-- ---------- 1. ratings follow what the public sees ----------
create or replace function public.coach_review_stats_refresh(p_coach uuid)
returns void language sql security definer set search_path = public as $$
  update public.coach_profiles cp set
    review_count = s.n,
    review_avg = case when s.n > 0 then round(s.total::numeric / s.n, 2) end,
    review_distribution = array[s.r1, s.r2, s.r3, s.r4, s.r5]
  from (
    select count(*)::int as n, coalesce(sum(r.rating), 0)::int as total,
           count(*) filter (where r.rating = 1)::int as r1, count(*) filter (where r.rating = 2)::int as r2,
           count(*) filter (where r.rating = 3)::int as r3, count(*) filter (where r.rating = 4)::int as r4,
           count(*) filter (where r.rating = 5)::int as r5
    from public.coach_reviews r
    join public.users u on u.id = r.reviewer_id
    where r.coach_id = p_coach and r.status = 'published'
      -- the same reviewers coach_public_reviews() lists
      and u.suspended_at is null
      and not exists (select 1 from public.account_deletion_requests d where d.user_id = r.reviewer_id)
  ) s
  where cp.user_id = p_coach;
$$;
revoke execute on function public.coach_review_stats_refresh(uuid) from public, anon, authenticated;

/** A reviewer's account state changed: every coach they reviewed is recounted. */
create or replace function public.coach_reviews_reviewer_changed()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_user uuid;
  v_coach uuid;
begin
  -- a record's fields are resolved when read: one branch per table
  if tg_table_name = 'users' then
    v_user := new.id;
  elsif tg_op = 'DELETE' then
    v_user := old.user_id;
  else
    v_user := new.user_id;
  end if;
  for v_coach in select distinct r.coach_id from public.coach_reviews r where r.reviewer_id = v_user loop
    perform public.coach_review_stats_refresh(v_coach);
  end loop;
  return null;
end;
$$;
revoke execute on function public.coach_reviews_reviewer_changed() from public, anon, authenticated;
create trigger users_suspension_review_stats after update of suspended_at on public.users
  for each row when (old.suspended_at is distinct from new.suspended_at)
  execute function public.coach_reviews_reviewer_changed();
create trigger deletion_requests_review_stats after insert or delete on public.account_deletion_requests
  for each row execute function public.coach_reviews_reviewer_changed();

-- every coach once, under the new rule
select public.coach_review_stats_refresh(cp.user_id) from public.coach_profiles cp;

-- ---------- 2. engagement from real, distinct people ----------
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
    has_availability, next_available_at, computed_at)
  select cp.id,
         public.coach_rank_completeness(cp.id),
         (select count(*) from public.coach_certifications ce where ce.coach_profile_id = cp.id),
         (select count(*) from public.coach_certifications ce where ce.coach_profile_id = cp.id and ce.verification_status = 'verified'),
         (select count(*) from public.bookings b where b.coach_id = cp.user_id and b.status = 'completed'),
         (select count(*) from public.trainer_clients tc
           where tc.coach_id = cp.user_id and tc.status = 'ended' and tc.started_at is not null
             and (tc.end_reason = 'goals_reached' or tc.ended_at - tc.started_at >= interval '28 days')),
         rq.n, rq.answered, rq.recent_clients,
         -- saves by live accounts only (a save of yourself is refused by a trigger)
         (select count(*) from public.coach_saves sv join public.users su on su.id = sv.user_id
           where sv.coach_profile_id = cp.id and sv.created_at > now() - interval '90 days'
             and su.suspended_at is null
             and not exists (select 1 from public.account_deletion_requests d where d.user_id = sv.user_id)),
         (select count(*) from public.marketplace_events e
           where e.coach_profile_id = cp.id and e.event = 'profile_view' and e.created_at > now() - interval '30 days'),
         (select au.last_sign_in_at from auth.users au where au.id = cp.user_id),
         (select max(p.created_at) from public.social_posts p
           where p.user_id = cp.user_id and p.visibility = 'public' and p.deleted_at is null),
         exists (select 1 from public.coach_availability a where a.coach_id = cp.user_id and a.active),
         (select min(x.start_at)
            from public.coach_services s
            join public.users cu on cu.id = cp.user_id
            cross join lateral public.booking_slots_internal(
              s.id, (now() at time zone coalesce(nullif(cu.timezone, ''), 'UTC'))::date, 14, null) x
           where s.coach_profile_id = cp.id and s.active and s.bookable and s.booking_access = 'public'
             and exists (select 1 from public.coach_availability a where a.coach_id = cp.user_id and a.active)),
         now()
  from public.coach_profiles cp
  cross join lateral (
    -- responsiveness: every request that had its 48 hours (unchanged); engagement: distinct live clients
    select count(*)::int as n,
           count(*) filter (where r.status in ('accepted', 'declined') and r.resolved_at <= r.created_at + interval '48 hours')::int as answered,
           count(distinct r.client_id) filter (
             where r.created_at > now() - interval '90 days'
               and exists (select 1 from public.users ru where ru.id = r.client_id and ru.suspended_at is null)
               and not exists (select 1 from public.account_deletion_requests d where d.user_id = r.client_id))::int as recent_clients
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
    next_available_at = excluded.next_available_at, computed_at = excluded.computed_at;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke execute on function public.coach_rank_signals_refresh(uuid) from public, anon, authenticated;

-- ---------- 3a. a revision decision tells the coach ----------
create or replace function public.marketplace_notify(p_recipient uuid, p_event text, p_payload jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_recipient is null or not exists (select 1 from public.users u where u.id = p_recipient) then
    return;
  end if;
  insert into public.notifications (user_id, category, title, body, payload)
  values (p_recipient, 'marketplace',
          case p_event
            when 'verification_verified' then 'You are Voinic Verified'
            when 'verification_rejected' then 'Verification not approved'
            when 'profile_published' then 'Your coach profile is live'
            when 'profile_returned' then 'Your coach profile needs changes'
            when 'profile_unpublished' then 'Your coach profile was unpublished'
            when 'profile_suspended' then 'Your coach profile was suspended'
            when 'profile_restored' then 'Your coach profile was restored'
            when 'review_hidden' then 'A review was hidden'
            when 'revision_approved' then 'Your profile changes are live'
            when 'revision_returned' then 'Your profile changes need another look'
            else 'Coach profile update' end,
          case p_event
            when 'verification_verified' then 'Your profile now shows the Voinic Verified badge.'
            when 'verification_rejected' then 'See the note on your coach profile page.'
            when 'profile_published' then 'Your profile can now be found in the coach directory.'
            when 'profile_returned' then 'See the note on your coach profile page.'
            when 'profile_unpublished' then 'It is no longer listed. See the note on your coach profile page.'
            when 'profile_suspended' then 'It is no longer listed. Your clients, bookings and messages are unchanged.'
            when 'profile_restored' then 'Your coach profile was restored.'
            when 'review_hidden' then 'A review on your profile was hidden after moderation.'
            when 'revision_approved' then 'Your public page now shows the changes you submitted.'
            when 'revision_returned' then 'Your public page is unchanged. See the note on your coach profile page.'
            else '' end,
          jsonb_build_object('event', p_event,
                             'screen', case when p_event = 'review_hidden' then 'coach_reviews' else 'coach_profile_settings' end)
            || coalesce(p_payload, '{}'::jsonb));
end;
$$;
revoke execute on function public.marketplace_notify(uuid, text, jsonb) from public, anon, authenticated;

alter function public.admin_decide_coach_revision(uuid, boolean, text) rename to admin_decide_coach_revision_base;
revoke execute on function public.admin_decide_coach_revision_base(uuid, boolean, text) from public, anon, authenticated;

/** admin_decide_coach_revision (20261108100000), plus the coach's notice. The base asserts admin and audits. */
create or replace function public.admin_decide_coach_revision(p_profile uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_decide_coach_revision_base(p_profile, p_approve, p_note);
  perform public.marketplace_notify((select user_id from public.coach_profiles where id = p_profile),
    case when coalesce(p_approve, false) then 'revision_approved' else 'revision_returned' end,
    jsonb_build_object('coach_profile_id', p_profile));
end;
$$;
revoke execute on function public.admin_decide_coach_revision(uuid, boolean, text) from public, anon;
grant execute on function public.admin_decide_coach_revision(uuid, boolean, text) to authenticated;

-- ---------- 3b. a completed session asks for a review ----------
create or replace function public.booking_notify(p_recipient uuid, p_actor uuid, p_event text, p_booking uuid, p_screen text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_name text;
begin
  if not public.social_notify_ok(p_recipient, p_actor) then
    return;
  end if;
  select public.public_display_name(u.username, u.full_name) into v_name from public.users u where u.id = p_actor;
  insert into public.notifications (user_id, category, title, body, payload)
  values (p_recipient, 'booking',
          case p_event when 'requested' then 'New booking request' when 'booked' then 'New booking'
                       when 'confirmed' then 'Booking confirmed' when 'declined' then 'Booking declined'
                       when 'cancelled' then 'Booking cancelled' when 'completed' then 'How was your session?'
                       else 'Upcoming session' end,
          case p_event when 'requested' then v_name || ' requested a session'
                       when 'booked' then v_name || ' booked a session'
                       when 'confirmed' then v_name || ' confirmed your session'
                       when 'declined' then v_name || ' declined your session'
                       when 'cancelled' then v_name || ' cancelled a session'
                       when 'completed' then 'You can now review ' || v_name || '.'
                       else 'Your session with ' || v_name || ' is coming up' end,
          jsonb_build_object('booking_id', p_booking, 'actor_id', p_actor, 'event', p_event, 'screen', p_screen));
end;
$$;
revoke execute on function public.booking_notify(uuid, uuid, text, uuid, text) from public, anon, authenticated;

alter function public.mark_booking(uuid, text) rename to mark_booking_base;
revoke execute on function public.mark_booking_base(uuid, text) from public, anon, authenticated;

/** mark_booking (20261105100000), plus: completed → the client is asked for a review, once, if they have none for this coach. */
create or replace function public.mark_booking(p_booking uuid, p_outcome text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_row public.bookings;
begin
  perform public.mark_booking_base(p_booking, p_outcome);
  if p_outcome = 'completed' then
    select * into v_row from public.bookings where id = p_booking;
    if not exists (select 1 from public.coach_reviews r where r.reviewer_id = v_row.client_id and r.coach_id = v_row.coach_id
                     and r.status <> 'deleted')
       and not exists (select 1 from public.notifications n where n.user_id = v_row.client_id and n.category::text = 'booking'
                         and n.payload ->> 'event' = 'completed' and n.payload ->> 'actor_id' = v_row.coach_id::text) then
      perform public.booking_notify(v_row.client_id, v_row.coach_id, 'completed', v_row.id, 'my_bookings');
    end if;
  end if;
end;
$$;
revoke execute on function public.mark_booking(uuid, text) from public, anon;
grant execute on function public.mark_booking(uuid, text) to authenticated;

-- ---------- 4. Book only with weekly hours ----------
create or replace function public.coach_public_availability(p_profile uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'bookable', exists (select 1 from public.coach_services s
                         where s.coach_profile_id = cp.id and s.active and s.bookable and s.booking_access = 'public'),
    'has_hours', exists (select 1 from public.coach_availability a where a.coach_id = cp.user_id and a.active),
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

-- ---------- 5. operations ----------
/**
 * One coach, for the admin's coach page: marketplace numbers (no client is
 * named) and the moderation history — every audited admin action on the
 * profile, its credentials, its reviews and the reports about it, newest
 * first, with who did it, from what, to what, and why.
 */
create or replace function public.admin_coach_marketplace_summary(p_profile uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_cp public.coach_profiles;
begin
  perform public.admin_assert();
  select * into v_cp from public.coach_profiles where id = p_profile;
  if v_cp.id is null then
    return null;
  end if;
  return jsonb_build_object(
    'views_30d', (select count(*) from public.marketplace_events e
                   where e.coach_profile_id = v_cp.id and e.event = 'profile_view' and e.created_at > now() - interval '30 days'),
    'saves', (select count(*) from public.coach_saves s where s.coach_profile_id = v_cp.id),
    'requests', (select jsonb_object_agg(x.status, x.n) from (
                   select r.status, count(*)::int as n from public.coaching_requests r where r.coach_id = v_cp.user_id group by r.status) x),
    'bookings', (select jsonb_object_agg(x.status, x.n) from (
                   select b.status, count(*)::int as n from public.bookings b where b.coach_id = v_cp.user_id group by b.status) x),
    'relationships', (select jsonb_object_agg(x.status, x.n) from (
                        select tc.status::text as status, count(*)::int as n from public.trainer_clients tc
                         where tc.coach_id = v_cp.user_id group by tc.status) x),
    'reviews', (select jsonb_object_agg(x.status, x.n) from (
                  select r.status, count(*)::int as n from public.coach_reviews r where r.coach_id = v_cp.user_id group by r.status) x),
    'review_count', v_cp.review_count,
    'review_avg', v_cp.review_avg,
    'open_reports', (select count(*) from public.social_reports sr
                      where sr.status = 'open'
                        and (sr.reported_coach_profile_id = v_cp.id
                             or sr.reported_review_id in (select r.id from public.coach_reviews r where r.coach_id = v_cp.user_id))),
    'services', (select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'kind', s.kind, 'active', s.active,
                                                     'bookable', s.bookable, 'price_public', s.price_public,
                                                     'price_cents', s.price_cents, 'currency', s.currency, 'price_unit', s.price_unit)
                                  order by s.active desc, s.sort_order)
                 from public.coach_services s where s.coach_profile_id = v_cp.id),
    'last_sign_in_at', (select au.last_sign_in_at from auth.users au where au.id = v_cp.user_id),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
               'at', e.created_at, 'entity', e.entity_type, 'entity_id', e.entity_id,
               'op', e.metadata ->> 'op', 'from', e.metadata ->> 'from',
               'to', coalesce(e.metadata ->> 'to', e.metadata ->> 'status',
                              case when e.metadata ? 'approved' then case when (e.metadata ->> 'approved')::boolean then 'approved' else 'returned' end end),
               'reason', coalesce(e.metadata ->> 'reason', e.metadata ->> 'note'),
               'actor', public.public_display_name(au.username, au.full_name))
             order by e.created_at desc)
      from (select * from public.admin_audit_events ev
             where ev.action = 'ADMIN_ACTION'
               and ((ev.entity_type = 'coach_profile' and ev.entity_id = v_cp.id::text)
                    or (ev.entity_type = 'coach_certification' and ev.target_user_id = v_cp.user_id)
                    or (ev.entity_type = 'coach_review' and ev.metadata ->> 'coach_id' = v_cp.user_id::text)
                    or (ev.entity_type = 'social_report' and ev.metadata ->> 'target' in (v_cp.id::text, v_cp.user_id::text)))
             order by ev.created_at desc limit 100) e
      left join public.users au on au.id = e.actor_user_id), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.admin_coach_marketplace_summary(uuid) from public, anon;
grant execute on function public.admin_coach_marketplace_summary(uuid) to authenticated;

/**
 * Coach profiles that need an admin's look, each with its reasons, worst
 * first. Signals only — nothing is decided here.
 */
create or replace function public.admin_coach_attention(p_limit int default 100)
returns table (profile_id uuid, slug text, display_name text, status text, reasons text[], open_reports int)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.admin_assert();
  return query
  with c as (
    select cp.id, cp.slug, public.public_display_name(u.username, u.full_name) as name, cp.status,
           (select count(*)::int from public.social_reports sr
             where sr.status = 'open'
               and (sr.reported_coach_profile_id = cp.id
                    or sr.reported_review_id in (select r.id from public.coach_reviews r where r.coach_id = cp.user_id))) as reports,
           array_remove(array[
             case when exists (select 1 from public.social_reports sr where sr.status = 'open' and sr.reported_coach_profile_id = cp.id)
                  then 'open_reports' end,
             case when exists (select 1 from public.social_reports sr join public.coach_reviews r on r.id = sr.reported_review_id
                                where sr.status = 'open' and r.coach_id = cp.user_id) then 'reported_reviews' end,
             case when cp.verification_status = 'rejected' then 'verification_rejected' end,
             case when cp.status in ('published', 'hidden') and exists (
                    select 1 from public.coach_certifications ce where ce.coach_profile_id = cp.id and ce.expires_on < current_date)
                  then 'expired_credentials' end,
             case when cp.review_count >= 3 and cp.review_avg < 3 then 'low_rating' end,
             case when cp.status = 'published' and (nullif(btrim(cp.headline), '') is null or nullif(btrim(cp.about), '') is null
                                                    or nullif(btrim(u.avatar_url), '') is null
                                                    or not exists (select 1 from public.coach_specializations s where s.coach_profile_id = cp.id)
                                                    or not exists (select 1 from public.coach_services s where s.coach_profile_id = cp.id and s.active))
                  then 'missing_essentials' end,
             case when cp.status = 'published' and u.suspended_at is not null then 'account_suspended' end,
             case when cp.status = 'published' and cp.accepting_clients
                       and coalesce((select au.last_sign_in_at from auth.users au where au.id = cp.user_id), cp.created_at) < now() - interval '60 days'
                  then 'inactive' end
           ], null) as reasons
    from public.coach_profiles cp join public.users u on u.id = cp.user_id
    where cp.status <> 'draft' or exists (select 1 from public.social_reports sr where sr.status = 'open' and sr.reported_coach_profile_id = cp.id)
  )
  select c.id, c.slug, c.name, c.status, c.reasons, c.reports
  from c where cardinality(c.reasons) > 0
  order by c.reports desc, cardinality(c.reasons) desc, c.slug
  limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$$;
revoke execute on function public.admin_coach_attention(int) from public, anon;
grant execute on function public.admin_coach_attention(int) to authenticated;

-- ---------- 6. credential decisions keep what they replaced ----------
alter function public.admin_set_certification_status(uuid, text, text) rename to admin_set_certification_status_base;
revoke execute on function public.admin_set_certification_status_base(uuid, text, text) from public, anon, authenticated;

create or replace function public.admin_set_certification_status(p_certification uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_from text;
  v_user uuid;
begin
  perform public.admin_assert();
  select ce.verification_status, cp.user_id into v_from, v_user
    from public.coach_certifications ce join public.coach_profiles cp on cp.id = ce.coach_profile_id
   where ce.id = p_certification;
  perform public.admin_set_certification_status_base(p_certification, p_status, p_note);
  perform public.audit_log('ADMIN_ACTION', 'coach_certification', p_certification::text, v_user,
    jsonb_build_object('op', 'certification_decision', 'from', v_from, 'to', p_status,
                       'note', left(nullif(btrim(coalesce(p_note, '')), ''), 1000)));
end;
$$;
revoke execute on function public.admin_set_certification_status(uuid, text, text) from public, anon;
grant execute on function public.admin_set_certification_status(uuid, text, text) to authenticated;

select public.coach_rank_signals_refresh();
