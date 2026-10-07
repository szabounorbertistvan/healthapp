-- HealthApp schema · marketplace trust & moderation
--
-- What already existed, and is reused rather than copied:
--   * social_reports + social_report(): the ONE reporting path (posts,
--     comments, people, and coach reviews since 20261106100000). Written only
--     by the function, unreadable from the app (no select policy) — so a
--     reported coach can never learn who reported them.
--   * coach_profiles.status draft → pending_review → published ⇄ hidden,
--     suspended (admin_set_coach_profile_status, 20261029100000), and the
--     account-level users.suspended_at (admin_set_suspended). Every public door
--     — coach_public_visible(), search_coaches(), coach_sitemap(), the slug
--     redirect, booking services/slots, reviews — already requires
--     status = 'published' and a live account, so suspending or unpublishing
--     takes a coach out of /coaches, its city and specialization listings,
--     the sitemap and search at once. Nothing is deleted: relationships,
--     bookings, messages and reviews stay.
--   * coach verification (admin_set_coach_verification_status, 20261101100000)
--     and per-credential status; credential numbers were never public.
--   * review hiding (admin_set_review_status, 20261106100000): a hidden review
--     stays in the table, leaves the public list and the aggregates
--     (coach_review_stats_refresh counts published only), and comes back on
--     restore.
--
-- What this adds:
--   1. A coach profile is the fifth report target (reported_coach_profile_id),
--      with one more reason, fake_credentials (coach reports only). The other
--      reasons asked for already exist: inappropriate, false_information
--      ("misleading information"), impersonation, harassment, spam, other.
--   2. Reports get a resolution: resolved_at, resolved_by, resolution_note.
--      status keeps its three values — open, reviewed (= resolved),
--      dismissed — which 20261009100000 reserved for this stage.
--   3. The admin's queue: admin_reports(), admin_report_counts(),
--      admin_resolve_report(). Admin only (admin_assert), audited.
--   4. Coaches are told what moderation decided about their listing
--      (category 'marketplace'): verification approved / rejected, profile
--      approved / returned / unpublished / suspended / restored, a review
--      about them hidden. Never who decided, never a report or a reporter.

-- ---------- 1–2. the reports table ----------
alter table public.social_reports
  add column if not exists reported_coach_profile_id uuid references public.coach_profiles (id) on delete cascade,
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by uuid references public.users (id) on delete set null,
  add column if not exists resolution_note text
    check (resolution_note is null or char_length(resolution_note) between 1 and 1000);

alter table public.social_reports drop constraint social_reports_one_target;
alter table public.social_reports add constraint social_reports_one_target
  check (num_nonnulls(reported_user_id, reported_post_id, reported_comment_id, reported_review_id, reported_coach_profile_id) = 1);

alter table public.social_reports drop constraint social_reports_reason;
alter table public.social_reports add constraint social_reports_reason
  check (reason in ('spam', 'harassment', 'inappropriate', 'false_information', 'hate', 'impersonation', 'scam',
                    'fake_credentials', 'other'));
-- credentials belong to a coach profile; anything else reported "fake credentials" is a mistake
alter table public.social_reports add constraint social_reports_credentials_on_coach
  check (reason <> 'fake_credentials' or reported_coach_profile_id is not null);

-- earlier closures (a review hidden) had no time: the report's own stands in
update public.social_reports set resolved_at = created_at where status <> 'open' and resolved_at is null;
alter table public.social_reports add constraint social_reports_resolution
  check ((status = 'open') = (resolved_at is null));

create unique index social_reports_one_per_coach on public.social_reports (reporter_id, reported_coach_profile_id, reason)
  where reported_coach_profile_id is not null;
create index social_reports_open_idx on public.social_reports (created_at) where status = 'open';
create index social_reports_coach_idx on public.social_reports (reported_coach_profile_id) where reported_coach_profile_id is not null;

comment on table public.social_reports is
  'User reports of a post, a comment, a person, a coach review or a coach profile. Written only by social_report(), resolved only by admin RPCs; unreadable from the app (no select policy), so nobody learns who reported them.';

-- ---------- 1. social_report: 20261106100000's, plus the coach profile ----------
create or replace function public.social_report(p_kind text, p_target uuid, p_reason text, p_details text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_details text := nullif(btrim(coalesce(p_details, '')), '');
  v_author uuid;
  v_post uuid;
  v_parent uuid;
begin
  if auth.uid() is null or not public.social_actor_active() then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_reason is null
     or p_reason not in ('spam', 'harassment', 'inappropriate', 'false_information', 'hate', 'impersonation', 'scam',
                         'fake_credentials', 'other') then
    raise exception 'unknown reason' using errcode = '22023';
  end if;
  if v_details is not null and char_length(v_details) > 500 then
    raise exception 'details too long' using errcode = '22023';
  end if;
  if p_kind is null or p_kind not in ('post', 'comment', 'user', 'review', 'coach') then
    raise exception 'unknown report target' using errcode = '22023';
  end if;
  if p_reason = 'fake_credentials' and p_kind <> 'coach' then
    raise exception 'unknown reason' using errcode = '22023';
  end if;

  -- One report per reporter and target, whatever the reason. Serialized per
  -- (reporter, target) so two concurrent calls cannot both get through.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':' || coalesce(p_target::text, ''), 0));

  if p_kind = 'post' then
    -- Missing, deleted, private, behind a block, author suspended: one answer.
    if p_target is null or not public.can_see_post(p_target) then
      raise exception 'post not found' using errcode = 'P0002';
    end if;
    select p.user_id into v_author from public.social_posts p where p.id = p_target;
    if v_author = auth.uid() then
      raise exception 'cannot report your own post' using errcode = '22023';
    end if;
    if exists (select 1 from public.social_reports r
               where r.reporter_id = auth.uid() and r.reported_post_id = p_target) then
      return;
    end if;
    insert into public.social_reports (reporter_id, reported_post_id, reason, details)
    values (auth.uid(), p_target, p_reason, v_details)
    on conflict (reporter_id, reported_post_id, reason) where reported_post_id is not null do nothing;

  elsif p_kind = 'comment' then
    -- The comment as the thread shows it: on a post the reporter may see, by
    -- an author who is listed for them, under a parent they may see. Anything
    -- else is answered like a missing comment.
    select c.user_id, c.post_id, c.parent_id into v_author, v_post, v_parent
    from public.social_comments c where c.id = p_target;
    if v_post is null or not public.can_see_post(v_post)
       or not public.social_comment_shown(v_author, v_parent) then
      raise exception 'comment not found' using errcode = 'P0002';
    end if;
    if v_author = auth.uid() then
      raise exception 'cannot report your own comment' using errcode = '22023';
    end if;
    if exists (select 1 from public.social_reports r
               where r.reporter_id = auth.uid() and r.reported_comment_id = p_target) then
      return;
    end if;
    insert into public.social_reports (reporter_id, reported_comment_id, reason, details)
    values (auth.uid(), p_target, p_reason, v_details)
    on conflict (reporter_id, reported_comment_id, reason) where reported_comment_id is not null do nothing;

  elsif p_kind = 'review' then
    -- A published review, as the public page shows it to this reporter (not
    -- behind a block with its author). The coach it is about may report it —
    -- that is their way to moderation, since they cannot remove it.
    select r.reviewer_id into v_author from public.coach_reviews r
    where r.id = p_target and r.status = 'published'
      and not public.social_blocked_between(auth.uid(), r.reviewer_id);
    if v_author is null then
      raise exception 'review not found' using errcode = 'P0002';
    end if;
    if v_author = auth.uid() then
      raise exception 'cannot report your own review' using errcode = '22023';
    end if;
    if exists (select 1 from public.social_reports r
               where r.reporter_id = auth.uid() and r.reported_review_id = p_target) then
      return;
    end if;
    insert into public.social_reports (reporter_id, reported_review_id, reason, details)
    values (auth.uid(), p_target, p_reason, v_details)
    on conflict (reporter_id, reported_review_id, reason) where reported_review_id is not null do nothing;

  elsif p_kind = 'coach' then
    -- A coach profile as the public page shows it to this reporter
    -- (coach_public_visible's rule, by id): published, account live, no block.
    -- Anything else answers like a missing profile.
    select cp.user_id into v_author
    from public.coach_profiles cp join public.users u on u.id = cp.user_id
    where cp.id = p_target and cp.status = 'published' and u.suspended_at is null
      and not exists (select 1 from public.account_deletion_requests d where d.user_id = cp.user_id)
      and not public.social_blocked_between(auth.uid(), cp.user_id);
    if v_author is null then
      raise exception 'coach not found' using errcode = 'P0002';
    end if;
    if v_author = auth.uid() then
      raise exception 'cannot report your own profile' using errcode = '22023';
    end if;
    if exists (select 1 from public.social_reports r
               where r.reporter_id = auth.uid() and r.reported_coach_profile_id = p_target) then
      return;
    end if;
    insert into public.social_reports (reporter_id, reported_coach_profile_id, reason, details)
    values (auth.uid(), p_target, p_reason, v_details)
    on conflict (reporter_id, reported_coach_profile_id, reason) where reported_coach_profile_id is not null do nothing;

  else
    if p_target = auth.uid() then
      raise exception 'cannot report yourself' using errcode = '22023';
    end if;
    -- A person may be reported after a block (either way) — the reporter
    -- already knows who it is. Missing, suspended or being deleted: one answer.
    if p_target is null
       or not exists (select 1 from public.users u where u.id = p_target and u.suspended_at is null)
       or exists (select 1 from public.account_deletion_requests d where d.user_id = p_target) then
      raise exception 'user not found' using errcode = 'P0002';
    end if;
    if exists (select 1 from public.social_reports r
               where r.reporter_id = auth.uid() and r.reported_user_id = p_target) then
      return;
    end if;
    insert into public.social_reports (reporter_id, reported_user_id, reason, details)
    values (auth.uid(), p_target, p_reason, v_details)
    on conflict (reporter_id, reported_user_id, reason) where reported_user_id is not null do nothing;
  end if;
end;
$$;
revoke execute on function public.social_report(text, uuid, text, text) from public, anon;
grant execute on function public.social_report(text, uuid, text, text) to authenticated;

-- ---------- 3. the admin's queue ----------
/** The kind of a report row, from which target column is set. */
create or replace function public.social_report_kind(r public.social_reports)
returns text language sql immutable set search_path = public as $$
  select case when r.reported_coach_profile_id is not null then 'coach'
              when r.reported_review_id is not null then 'review'
              when r.reported_comment_id is not null then 'comment'
              when r.reported_post_id is not null then 'post'
              else 'user' end;
$$;
revoke execute on function public.social_report_kind(public.social_reports) from public, anon, authenticated;

/** The reported thing's id, whatever its kind — reports of one target share it. */
create or replace function public.social_report_target(r public.social_reports)
returns uuid language sql immutable set search_path = public as $$
  select coalesce(r.reported_coach_profile_id, r.reported_review_id, r.reported_comment_id, r.reported_post_id, r.reported_user_id);
$$;
revoke execute on function public.social_report_target(public.social_reports) from public, anon, authenticated;

/**
 * Reports for /admin/reports (and a coach's own on /admin/coaches/[id]):
 * open first and oldest first by default. Each row says what was reported
 * and, for the marketplace kinds, which coach profile it concerns, so the
 * admin can open it. The reporter is shown to the admin only.
 */
create or replace function public.admin_reports(
  p_kind text default null, p_status text default 'open', p_coach_profile uuid default null,
  p_limit int default 50, p_offset int default 0
) returns table (
  id uuid, kind text, reason text, details text, status text, created_at timestamptz,
  resolved_at timestamptz, resolution_note text, reporter_id uuid, reporter_name text,
  target_id uuid, target_label text, target_user_id uuid, coach_profile_id uuid, coach_slug text, coach_status text,
  review_rating int, review_body text, review_status text, open_for_target int
) language plpgsql stable security definer set search_path = public as $$
begin
  perform public.admin_assert();
  return query
  with base as (
    select r.*, public.social_report_kind(r) as k, public.social_report_target(r) as t
    from public.social_reports r
  )
  select b.id, b.k, b.reason, b.details, b.status, b.created_at, b.resolved_at, b.resolution_note,
         b.reporter_id, public.public_display_name(ru.username, ru.full_name),
         b.t,
         case b.k
           when 'coach' then public.public_display_name(cu.username, cu.full_name)
           when 'review' then public.public_display_name(rcu.username, rcu.full_name)
           when 'user' then public.public_display_name(tu.username, tu.full_name)
           when 'post' then left(coalesce(sp.text, ''), 120)
           else left(coalesce(sc.body, ''), 120) end,
         case b.k when 'coach' then cp.user_id when 'review' then rv.coach_id when 'user' then b.reported_user_id
                  when 'post' then sp.user_id else sc.user_id end,
         coalesce(cp.id, rcp.id), coalesce(cp.slug, rcp.slug), coalesce(cp.status, rcp.status)::text,
         rv.rating::int, rv.body, rv.status::text,
         (select count(*)::int from base o where o.t = b.t and o.k = b.k and o.status = 'open')
  from base b
  left join public.users ru on ru.id = b.reporter_id
  left join public.coach_profiles cp on cp.id = b.reported_coach_profile_id
  left join public.users cu on cu.id = cp.user_id
  left join public.coach_reviews rv on rv.id = b.reported_review_id
  left join public.coach_profiles rcp on rcp.user_id = rv.coach_id
  left join public.users rcu on rcu.id = rv.coach_id
  left join public.users tu on tu.id = b.reported_user_id
  left join public.social_posts sp on sp.id = b.reported_post_id
  left join public.social_comments sc on sc.id = b.reported_comment_id
  where (p_kind is null or b.k = p_kind)
    and (p_status is null or b.status = p_status)
    and (p_coach_profile is null or cp.id = p_coach_profile or rcp.id = p_coach_profile)
  order by (b.status = 'open') desc, case when b.status = 'open' then b.created_at end asc, b.resolved_at desc nulls last, b.id
  limit greatest(1, least(coalesce(p_limit, 50), 200)) offset greatest(0, coalesce(p_offset, 0));
end;
$$;
revoke execute on function public.admin_reports(text, text, uuid, int, int) from public, anon;
grant execute on function public.admin_reports(text, text, uuid, int, int) to authenticated;

/** Open reports by kind, for the KPI tiles and the nav badge. */
create or replace function public.admin_report_counts()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb;
begin
  perform public.admin_assert();
  select jsonb_build_object(
    'open', count(*) filter (where r.status = 'open'),
    'coach', count(*) filter (where r.status = 'open' and r.reported_coach_profile_id is not null),
    'review', count(*) filter (where r.status = 'open' and r.reported_review_id is not null),
    'user', count(*) filter (where r.status = 'open' and r.reported_user_id is not null),
    'post', count(*) filter (where r.status = 'open' and r.reported_post_id is not null),
    'comment', count(*) filter (where r.status = 'open' and r.reported_comment_id is not null),
    'resolved_7d', count(*) filter (where r.status <> 'open' and r.resolved_at > now() - interval '7 days'))
  into v from public.social_reports r;
  return v;
end;
$$;
revoke execute on function public.admin_report_counts() from public, anon;
grant execute on function public.admin_report_counts() to authenticated;

/**
 * Close a report as reviewed (acted on, or nothing to act on after a look)
 * or dismissed (not a valid report). By default every open report of the
 * same target closes with it — one decision per thing reported. Only an open
 * report can be closed; audited.
 */
create or replace function public.admin_resolve_report(
  p_report uuid, p_status text, p_note text default null, p_all_for_target boolean default true
) returns int language plpgsql security definer set search_path = public as $$
declare
  v_row public.social_reports;
  v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 1000);
  v_kind text;
  v_target uuid;
  v_n int;
begin
  perform public.admin_assert();
  if p_status is null or p_status not in ('reviewed', 'dismissed') then
    raise exception 'BAD_STATUS' using errcode = '22023';
  end if;
  select * into v_row from public.social_reports where id = p_report for update;
  if v_row.id is null then
    raise exception 'REPORT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_row.status <> 'open' then
    raise exception 'REPORT_CLOSED' using errcode = '22023';
  end if;
  v_kind := public.social_report_kind(v_row);
  v_target := public.social_report_target(v_row);

  update public.social_reports r
     set status = p_status, resolved_at = now(), resolved_by = auth.uid(), resolution_note = v_note
   where r.status = 'open'
     and (r.id = p_report
          or (coalesce(p_all_for_target, true)
              and public.social_report_kind(r) = v_kind and public.social_report_target(r) = v_target));
  get diagnostics v_n = row_count;

  perform public.audit_log('ADMIN_ACTION', 'social_report', p_report::text, null,
    jsonb_build_object('op', 'report_resolve', 'status', p_status, 'kind', v_kind, 'target', v_target,
                       'closed', v_n, 'note', v_note));
  return v_n;
end;
$$;
revoke execute on function public.admin_resolve_report(uuid, text, text, boolean) from public, anon;
grant execute on function public.admin_resolve_report(uuid, text, text, boolean) to authenticated;

/** Open reports of one target are closed as reviewed when the admin acts on it (hide, suspend). */
create or replace function public.social_reports_close_for(p_kind text, p_target uuid, p_note text)
returns void language sql security definer set search_path = public as $$
  update public.social_reports r
     set status = 'reviewed', resolved_at = now(), resolved_by = auth.uid(),
         resolution_note = left(nullif(btrim(coalesce(p_note, '')), ''), 1000)
   where r.status = 'open' and public.social_report_kind(r) = p_kind and public.social_report_target(r) = p_target;
$$;
revoke execute on function public.social_reports_close_for(text, uuid, text) from public, anon, authenticated;

-- ---------- 4. the coach is told ----------
/**
 * A moderation outcome about the coach's own listing. Fixed sentences only:
 * no moderator, no report, no reporter. The reason a coach needs to fix
 * something is on their own profile page (review_note / verification_note),
 * where it already was.
 */
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
            else '' end,
          jsonb_build_object('event', p_event,
                             'screen', case when p_event = 'review_hidden' then 'coach_reviews' else 'coach_profile_settings' end)
            || coalesce(p_payload, '{}'::jsonb));
end;
$$;
revoke execute on function public.marketplace_notify(uuid, text, jsonb) from public, anon, authenticated;

-- admin_set_coach_profile_status (20261029100000), plus the notice and the reports
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

  -- acting on the profile settles what was reported about it
  if p_status in ('suspended', 'draft') and v_cp.status in ('published', 'hidden', 'pending_review') then
    perform public.social_reports_close_for('coach', p_profile, 'profile ' || p_status);
  end if;
  perform public.marketplace_notify(v_cp.user_id,
    case
      when v_cp.status = 'suspended' then 'profile_restored'
      when p_status = 'published' then 'profile_published'
      when p_status = 'suspended' then 'profile_suspended'
      when v_cp.status = 'pending_review' then 'profile_returned'
      else 'profile_unpublished' end,
    jsonb_build_object('coach_profile_id', p_profile));
end;
$$;
revoke execute on function public.admin_set_coach_profile_status(uuid, text, text) from public, anon;
grant execute on function public.admin_set_coach_profile_status(uuid, text, text) to authenticated;

-- admin_set_coach_verification_status (20261101100000), plus the notice on a decision
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
  if p_status in ('verified', 'rejected') then
    perform public.marketplace_notify(v_cp.user_id, 'verification_' || p_status, jsonb_build_object('coach_profile_id', p_profile));
  end if;
end;
$$;
revoke execute on function public.admin_set_coach_verification_status(uuid, text, text) from public, anon;
grant execute on function public.admin_set_coach_verification_status(uuid, text, text) to authenticated;

-- admin_set_review_status (20261106100000), plus a resolution on the reports and the coach's notice
create or replace function public.admin_set_review_status(p_review uuid, p_status text, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_row public.coach_reviews;
  v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 1000);
begin
  perform public.admin_assert();
  select * into v_row from public.coach_reviews where id = p_review for update;
  if v_row.id is null then
    raise exception 'REVIEW_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not ((v_row.status = 'published' and p_status = 'hidden') or (v_row.status = 'hidden' and p_status = 'published')) then
    raise exception 'BAD_TRANSITION' using errcode = '22023';
  end if;
  if p_status = 'hidden' and v_reason is null then
    raise exception 'REASON_REQUIRED' using errcode = '22023';
  end if;
  update public.coach_reviews
     set status = p_status, moderation_reason = case when p_status = 'hidden' then v_reason end,
         moderated_by = auth.uid(), moderated_at = now()
   where id = p_review;
  perform public.social_reports_close_for('review', p_review, 'review ' || p_status);
  perform public.audit_log('ADMIN_ACTION', 'coach_review', p_review::text, v_row.reviewer_id,
    jsonb_build_object('op', 'review_status', 'from', v_row.status, 'to', p_status, 'reason', v_reason, 'coach_id', v_row.coach_id));
  if p_status = 'hidden' then
    perform public.marketplace_notify(v_row.coach_id, 'review_hidden', jsonb_build_object('review_id', p_review));
  end if;
end;
$$;
revoke execute on function public.admin_set_review_status(uuid, text, text) from public, anon;
grant execute on function public.admin_set_review_status(uuid, text, text) to authenticated;
