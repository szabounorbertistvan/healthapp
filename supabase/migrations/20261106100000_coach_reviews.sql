-- HealthApp schema · Coach Discovery: reviews and ratings
--
-- What existed and is reused: trainer_clients (coaching, active / ended),
-- bookings (completed sessions, 20261105100000), coach_profiles, the
-- notifications table + social_notify_ok(), the block rules, social_reports +
-- social_report() (the one reporting path — a review becomes its fourth
-- target), the admin panel's admin_assert() + audit_log(), and
-- search_coaches(). Social comments are post-bound threads; a coach's answer
-- to a review is one field on the review, not a second comment system.
--
-- 1. Eligibility — a real interaction, the strongest one found:
--      coaching   a trainer_clients row with this coach that is active and
--                 started at least 7 days ago, or that has ended (it ran)
--      booking    a booking with this coach marked completed
--    Viewing a profile, a request, an accepted conversation or a pending /
--    cancelled / no-show booking is not enough. No payment is involved.
--
-- 2. One review per reviewer and coach (unique), whatever the basis — ten
--    completed sessions are still one opinion. Writing again edits the same
--    row (rating, text, edited_at); nothing is ever inserted twice.
--
-- 3. Lifecycle: published (on submit — moderation is after the fact, through
--    reports), hidden (an admin, with a reason; the reviewer can neither edit
--    nor delete it out of moderation), deleted (the reviewer: text and the
--    coach's answer are cleared, the row keeps the one-per-coach slot; writing
--    again revives it). Nobody hard-deletes a review from the app.
--
-- 4. Writes are RPCs only — the table has no insert / update / delete policy
--    or grant — so reviewer_id and coach_id come from auth.uid() and the
--    profile, never from the caller; a trigger refuses any later change to
--    them all the same. The coach answers (one response, editable), never
--    edits or removes the review; they may report it like anyone.
--
-- 5. Aggregates: coach_profiles.review_count / review_avg /
--    review_distribution, recomputed from the coach's published reviews by a
--    trigger on every change — derived, never edited (the coach has no grant
--    on them). search_coaches() reads them as columns (no per-card query)
--    and returns them on each card; it does not rank by them yet.
--
-- 6. Notices: one category, review — 'published' to the coach (a new or
--    revived review, not every edit), 'response' to the reviewer (the
--    coach's first answer).

-- ---------- 1. the table ----------
create table public.coach_reviews (
  id uuid primary key default gen_random_uuid(),
  reviewer_id uuid not null references public.users (id) on delete cascade,
  coach_id uuid not null references public.users (id) on delete cascade,
  -- what made the reviewer eligible, as found when they last wrote
  basis text not null check (basis in ('coaching', 'booking')),
  trainer_client_id uuid references public.trainer_clients (id) on delete set null,
  booking_id uuid references public.bookings (id) on delete set null,
  rating smallint not null check (rating between 1 and 5),
  body text check (body is null or (char_length(body) between 1 and 2000 and body = btrim(body))),
  status text not null default 'published' check (status in ('published', 'hidden', 'deleted')),
  coach_response text check (coach_response is null or (char_length(coach_response) between 1 and 1000 and coach_response = btrim(coach_response))),
  coach_response_at timestamptz,
  moderation_reason text check (moderation_reason is null or char_length(moderation_reason) <= 1000),
  moderated_by uuid references public.users (id) on delete set null,
  moderated_at timestamptz,
  edited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coach_reviews_not_self check (reviewer_id <> coach_id),
  constraint coach_reviews_one_per_coach unique (reviewer_id, coach_id),
  constraint coach_reviews_response_pair check ((coach_response is null) = (coach_response_at is null))
);
create trigger coach_reviews_updated before update on public.coach_reviews
  for each row execute function public.handle_updated_at();
create index coach_reviews_coach_idx on public.coach_reviews (coach_id, status, created_at desc);
create index coach_reviews_reviewer_idx on public.coach_reviews (reviewer_id);

-- who wrote it and about whom never changes, whoever runs the update
create or replace function public.coach_reviews_identity_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.reviewer_id is distinct from old.reviewer_id or new.coach_id is distinct from old.coach_id then
    raise exception 'REVIEW_IDENTITY_IMMUTABLE' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger coach_reviews_identity before update on public.coach_reviews
  for each row execute function public.coach_reviews_identity_guard();

alter table public.coach_reviews enable row level security;
-- the reviewer sees their own (any state), the coach sees what is about them
-- except what the reviewer deleted, an admin sees all; the public reads
-- through coach_public_reviews()
create policy coach_reviews_select on public.coach_reviews for select to authenticated
  using (reviewer_id = auth.uid()
         or (coach_id = auth.uid() and status <> 'deleted')
         or public.is_admin());
revoke all on table public.coach_reviews from anon, authenticated;
grant select on table public.coach_reviews to authenticated;

-- ---------- 5. aggregates ----------
alter table public.coach_profiles
  add column review_count int not null default 0 check (review_count >= 0),
  add column review_avg numeric(3, 2) check (review_avg is null or review_avg between 1 and 5),
  add column review_distribution int[] not null default '{0,0,0,0,0}' check (array_length(review_distribution, 1) = 5);

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
    where r.coach_id = p_coach and r.status = 'published'
  ) s
  where cp.user_id = p_coach;
$$;
revoke execute on function public.coach_review_stats_refresh(uuid) from public, anon, authenticated;

create or replace function public.coach_reviews_after_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.coach_review_stats_refresh(coalesce(new.coach_id, old.coach_id));
  return null;
end;
$$;
revoke execute on function public.coach_reviews_after_change() from public, anon, authenticated;
create trigger coach_reviews_stats after insert or update of rating, status or delete on public.coach_reviews
  for each row execute function public.coach_reviews_after_change();

-- ---------- 1b. eligibility ----------
/**
 * The strongest real interaction between a reviewer and a coach, or no row:
 * coaching (active for 7 days, or ended after it started), else the latest
 * completed booking. Internal; review_state / submit read it.
 */
create or replace function public.coach_review_eligibility(p_reviewer uuid, p_coach uuid)
returns table (basis text, trainer_client_id uuid, booking_id uuid)
language sql stable security definer set search_path = public as $$
  (select 'coaching'::text, tc.id, null::uuid
   from public.trainer_clients tc
   where tc.client_id = p_reviewer and tc.coach_id = p_coach and tc.started_at is not null
     and ((tc.status = 'active' and tc.started_at <= now() - interval '7 days') or tc.status = 'ended')
   order by (tc.status = 'active') desc, tc.started_at desc
   limit 1)
  union all
  (select 'booking'::text, null::uuid, b.id
   from public.bookings b
   where b.client_id = p_reviewer and b.coach_id = p_coach and b.status = 'completed'
   order by b.start_at desc
   limit 1)
  limit 1;
$$;
revoke execute on function public.coach_review_eligibility(uuid, uuid) from public, anon, authenticated;

-- ---------- 6. the notice ----------
alter type public.notification_category add value if not exists 'review';

create or replace function public.review_notify(p_recipient uuid, p_actor uuid, p_event text, p_review uuid, p_screen text, p_slug text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_name text;
begin
  if not public.social_notify_ok(p_recipient, p_actor) then
    return;
  end if;
  select public.public_display_name(u.username, u.full_name) into v_name from public.users u where u.id = p_actor;
  insert into public.notifications (user_id, category, title, body, payload)
  values (p_recipient, 'review',
          case p_event when 'published' then 'New review' else 'Your review got an answer' end,
          case p_event when 'published' then v_name || ' reviewed you' else v_name || ' answered your review' end,
          jsonb_build_object('review_id', p_review, 'actor_id', p_actor, 'event', p_event, 'screen', p_screen, 'slug', p_slug));
end;
$$;
revoke execute on function public.review_notify(uuid, uuid, text, uuid, text, text) from public, anon, authenticated;

-- ---------- 2/3/4. the writes ----------
/**
 * Write (or rewrite) the caller's review of a published coach: 1–5 stars,
 * optional text up to 2000. The same row every time — a new review the first
 * time, an edit after, a revival after the reviewer deleted it. A review an
 * admin hid stays hidden and is not editable (REVIEW_HIDDEN).
 */
create or replace function public.submit_coach_review(p_coach_profile uuid, p_rating int, p_body text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_coach uuid;
  v_slug text;
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
  v_basis text;
  v_tc uuid;
  v_booking uuid;
  v_row public.coach_reviews;
begin
  if not public.social_actor_active()
     or not exists (select 1 from public.users u where u.id = v_user and u.username is not null) then
    raise exception 'NOT_SIGNED_IN' using errcode = '42501';
  end if;
  select cp.user_id, cp.slug into v_coach, v_slug
  from public.coach_profiles cp join public.users u on u.id = cp.user_id
  where cp.id = p_coach_profile and cp.status = 'published' and u.suspended_at is null
    and not exists (select 1 from public.account_deletion_requests d where d.user_id = cp.user_id)
    and not public.social_blocked_between(v_user, cp.user_id);
  if v_coach is null then
    raise exception 'COACH_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_coach = v_user then
    raise exception 'CANNOT_REVIEW_SELF' using errcode = '22023';
  end if;
  if p_rating is null or p_rating not between 1 and 5 then
    raise exception 'INVALID_RATING' using errcode = '22023';
  end if;
  if char_length(v_body) > 2000 then
    raise exception 'REVIEW_TOO_LONG' using errcode = '22023';
  end if;
  select e.basis, e.trainer_client_id, e.booking_id into v_basis, v_tc, v_booking
  from public.coach_review_eligibility(v_user, v_coach) e;
  if v_basis is null then
    raise exception 'NOT_ELIGIBLE' using errcode = '42501';
  end if;

  select * into v_row from public.coach_reviews where reviewer_id = v_user and coach_id = v_coach for update;
  if v_row.id is null then
    begin
      insert into public.coach_reviews (reviewer_id, coach_id, basis, trainer_client_id, booking_id, rating, body)
      values (v_user, v_coach, v_basis, v_tc, v_booking, p_rating, v_body)
      returning * into v_row;
    exception when unique_violation then
      raise exception 'REVIEW_EXISTS' using errcode = '23505';
    end;
    perform public.review_notify(v_coach, v_user, 'published', v_row.id, 'coach_reviews', v_slug);
    return v_row.id;
  end if;
  if v_row.status = 'hidden' then
    raise exception 'REVIEW_HIDDEN' using errcode = '55000';
  end if;
  update public.coach_reviews set
    rating = p_rating, body = v_body, basis = v_basis, trainer_client_id = v_tc, booking_id = v_booking,
    status = 'published', edited_at = case when v_row.status = 'published' then now() end,
    created_at = case when v_row.status = 'deleted' then now() else created_at end
  where id = v_row.id;
  if v_row.status = 'deleted' then
    perform public.review_notify(v_coach, v_user, 'published', v_row.id, 'coach_reviews', v_slug);
  end if;
  return v_row.id;
end;
$$;
revoke execute on function public.submit_coach_review(uuid, int, text) from public, anon;
grant execute on function public.submit_coach_review(uuid, int, text) to authenticated;

/** The reviewer takes their review down: text and the coach's answer go, the row keeps its slot. */
create or replace function public.delete_my_coach_review(p_review uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status text;
begin
  select status into v_status from public.coach_reviews where id = p_review and reviewer_id = auth.uid() for update;
  if v_status is null or v_status = 'deleted' then
    raise exception 'REVIEW_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_status = 'hidden' then
    raise exception 'REVIEW_HIDDEN' using errcode = '55000';
  end if;
  update public.coach_reviews
     set status = 'deleted', body = null, coach_response = null, coach_response_at = null, edited_at = null
   where id = p_review;
end;
$$;
revoke execute on function public.delete_my_coach_review(uuid) from public, anon;
grant execute on function public.delete_my_coach_review(uuid) to authenticated;

/** The coach's one answer to a published review about them; empty clears it. The review itself is untouched. */
create or replace function public.respond_to_coach_review(p_review uuid, p_body text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_row public.coach_reviews;
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
  v_slug text;
begin
  if not public.social_actor_active() then
    raise exception 'NOT_SIGNED_IN' using errcode = '42501';
  end if;
  select * into v_row from public.coach_reviews where id = p_review and coach_id = auth.uid() and status = 'published' for update;
  if v_row.id is null then
    raise exception 'REVIEW_NOT_FOUND' using errcode = 'P0002';
  end if;
  if char_length(v_body) > 1000 then
    raise exception 'RESPONSE_TOO_LONG' using errcode = '22023';
  end if;
  update public.coach_reviews
     set coach_response = v_body, coach_response_at = case when v_body is null then null else now() end
   where id = p_review;
  if v_row.coach_response is null and v_body is not null then
    select slug into v_slug from public.coach_profiles where user_id = auth.uid();
    perform public.review_notify(v_row.reviewer_id, auth.uid(), 'response', p_review, 'coach_profile', v_slug);
  end if;
end;
$$;
revoke execute on function public.respond_to_coach_review(uuid, text) from public, anon;
grant execute on function public.respond_to_coach_review(uuid, text) to authenticated;

-- ---------- reads ----------
/**
 * A public coach page's reviews, for anyone: the aggregates (from the
 * profile's derived columns) and one page of published reviews — the
 * reviewer's public name and avatar, the stars, the text, the dates and the
 * coach's answer. A reviewer who is suspended, being deleted, or behind a
 * block with the reader is left out of the list. Nothing else about anyone.
 */
create or replace function public.coach_public_reviews(p_slug text, p_limit int default 10, p_offset int default 0)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'count', cp.review_count,
    'average', cp.review_avg,
    'distribution', to_jsonb(cp.review_distribution),
    'items', coalesce((
      select jsonb_agg(x.item order by x.created_at desc)
      from (
        select r.created_at, jsonb_build_object(
                 'id', r.id, 'rating', r.rating, 'body', r.body,
                 'created_at', r.created_at, 'edited_at', r.edited_at,
                 'reviewer_name', public.public_display_name(u.username, u.full_name),
                 'reviewer_avatar', u.avatar_url,
                 'basis', r.basis,
                 'coach_response', r.coach_response, 'coach_response_at', r.coach_response_at,
                 'is_mine', r.reviewer_id = auth.uid()) as item
        from public.coach_reviews r
        join public.users u on u.id = r.reviewer_id
        where r.coach_id = v.user_id and r.status = 'published'
          and u.suspended_at is null
          and not exists (select 1 from public.account_deletion_requests d where d.user_id = u.id)
          and not public.social_blocked_between(auth.uid(), u.id)
        order by r.created_at desc
        limit greatest(1, least(coalesce(p_limit, 10), 50)) offset greatest(0, coalesce(p_offset, 0))
      ) x), '[]'::jsonb)
  )
  from public.coach_public_visible(p_slug) v
  join public.coach_profiles cp on cp.id = v.profile_id;
$$;
revoke execute on function public.coach_public_reviews(text, int, int) from public;
grant execute on function public.coach_public_reviews(text, int, int) to anon, authenticated;

/** May the signed-in reader review this coach, and their review if they wrote one. */
create or replace function public.my_coach_review_state(p_coach_profile uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'eligible', cp.user_id <> auth.uid()
                and exists (select 1 from public.coach_review_eligibility(auth.uid(), cp.user_id)),
    'basis', (select e.basis from public.coach_review_eligibility(auth.uid(), cp.user_id) e),
    'review', (select jsonb_build_object('id', r.id, 'rating', r.rating, 'body', r.body, 'status', r.status,
                                         'created_at', r.created_at, 'edited_at', r.edited_at,
                                         'coach_response', r.coach_response)
               from public.coach_reviews r
               where r.reviewer_id = auth.uid() and r.coach_id = cp.user_id and r.status <> 'deleted'))
  from public.coach_profiles cp
  where cp.id = p_coach_profile and auth.uid() is not null and cp.status = 'published'
    and not public.social_blocked_between(auth.uid(), cp.user_id);
$$;
revoke execute on function public.my_coach_review_state(uuid) from public, anon;
grant execute on function public.my_coach_review_state(uuid) to authenticated;

/** The coach's reviews about themselves (published and hidden), newest first, with the aggregates. */
create or replace function public.coach_my_reviews()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'count', cp.review_count, 'average', cp.review_avg, 'distribution', to_jsonb(cp.review_distribution),
    'slug', cp.slug,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'rating', r.rating, 'body', r.body, 'status', r.status,
               'created_at', r.created_at, 'edited_at', r.edited_at,
               'reviewer_name', public.public_display_name(u.username, u.full_name), 'reviewer_avatar', u.avatar_url,
               'basis', r.basis, 'coach_response', r.coach_response, 'coach_response_at', r.coach_response_at)
             order by r.created_at desc)
      from public.coach_reviews r join public.users u on u.id = r.reviewer_id
      where r.coach_id = cp.user_id and r.status in ('published', 'hidden')), '[]'::jsonb))
  from public.coach_profiles cp
  where cp.user_id = auth.uid();
$$;
revoke execute on function public.coach_my_reviews() from public, anon;
grant execute on function public.coach_my_reviews() to authenticated;

-- ---------- moderation (the admin panel's pattern) ----------
/**
 * Reviews for /admin/coaches/[id] (p_coach) or, without one, the reported
 * ones across all coaches: any status, with their open report count.
 */
create or replace function public.admin_coach_reviews(p_coach uuid default null)
returns table (
  id uuid, coach_id uuid, coach_name text, reviewer_id uuid, reviewer_name text, rating smallint, body text,
  status text, basis text, coach_response text, moderation_reason text, open_reports int, created_at timestamptz
) language plpgsql stable security definer set search_path = public as $$
begin
  perform public.admin_assert();
  return query
    select r.id, r.coach_id, public.public_display_name(cu.username, cu.full_name),
           r.reviewer_id, public.public_display_name(ru.username, ru.full_name), r.rating, r.body,
           r.status, r.basis, r.coach_response, r.moderation_reason,
           (select count(*)::int from public.social_reports sr where sr.reported_review_id = r.id and sr.status = 'open'),
           r.created_at
    from public.coach_reviews r
    join public.users cu on cu.id = r.coach_id
    join public.users ru on ru.id = r.reviewer_id
    where (p_coach is not null and r.coach_id = p_coach)
       or (p_coach is null and exists (select 1 from public.social_reports sr where sr.reported_review_id = r.id and sr.status = 'open'))
    order by r.created_at desc
    limit 200;
end;
$$;
revoke execute on function public.admin_coach_reviews(uuid) from public, anon;
grant execute on function public.admin_coach_reviews(uuid) to authenticated;

/** Hide (reason required) or restore a review; its open reports are closed as reviewed. Audited. */
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
  update public.social_reports set status = 'reviewed' where reported_review_id = p_review and status = 'open';
  perform public.audit_log('ADMIN_ACTION', 'coach_review', p_review::text, v_row.reviewer_id,
    jsonb_build_object('op', 'review_status', 'from', v_row.status, 'to', p_status, 'reason', v_reason, 'coach_id', v_row.coach_id));
end;
$$;
revoke execute on function public.admin_set_review_status(uuid, text, text) from public, anon;
grant execute on function public.admin_set_review_status(uuid, text, text) to authenticated;

-- ---------- reports: a review is the fourth target of the one reporting path ----------
alter table public.social_reports
  add column if not exists reported_review_id uuid references public.coach_reviews (id) on delete cascade;
alter table public.social_reports drop constraint social_reports_one_target;
alter table public.social_reports add constraint social_reports_one_target
  check (num_nonnulls(reported_user_id, reported_post_id, reported_comment_id, reported_review_id) = 1);
create unique index social_reports_one_per_review on public.social_reports (reporter_id, reported_review_id, reason)
  where reported_review_id is not null;

-- social_report from 20261015100000, plus the review branch
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
     or p_reason not in ('spam', 'harassment', 'inappropriate', 'false_information', 'hate', 'impersonation', 'scam', 'other') then
    raise exception 'unknown reason' using errcode = '22023';
  end if;
  if v_details is not null and char_length(v_details) > 500 then
    raise exception 'details too long' using errcode = '22023';
  end if;
  if p_kind is null or p_kind not in ('post', 'comment', 'user', 'review') then
    raise exception 'unknown report target' using errcode = '22023';
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

-- ---------- search: the card carries the rating ----------
-- search_coaches from 20261102100000, same signature, plus review_count / review_avg.
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
  p_gym uuid default null,
  p_saved boolean default null
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
           case when p_sort in ('recommended', 'relevance', 'experience', 'followers', 'newest', 'saved')
                then p_sort else 'recommended' end as sort,
           -- up to 10 pages of 24: "Load more" grows one listing (lib/coach-discovery.ts)
           greatest(1, least(coalesce(p_limit, 24), 240)) as lim,
           greatest(0, least(coalesce(p_offset, 0), 1000)) as off
  ),
  matched as (
    select cp.id, cp.user_id, cp.slug, cp.headline, cp.about, cp.cover_url, cp.coaching_since,
           cp.accepting_clients, cp.online, cp.in_person, cp.published_at, cp.search_doc, cp.search_text,
           cp.verification_status,
           -- reviews (20261106100000): derived columns, read as columns — no per-card query.
           -- Returned for the card and available to a future ranking; not in the order yet.
           cp.review_count, cp.review_avg,
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
      -- the caller's own shortlist (20261102100000); anonymous callers have none
      and (p_saved is not true or exists (
            select 1 from public.coach_saves sv where sv.user_id = auth.uid() and sv.coach_profile_id = cp.id))
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
           (select sv.created_at from public.coach_saves sv
             where sv.user_id = auth.uid() and sv.coach_profile_id = m.id) as saved_at,
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
      case when pr.sort = 'saved' then s.saved_at end desc nulls last,
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
        'id', p.id,
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
        'rating', case when p.review_count > 0
                       then jsonb_build_object('average', p.review_avg, 'count', p.review_count) end,
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
                               where f.follower_id = p.user_id and f.following_id = auth.uid()),
        'is_saved', p.saved_at is not null
      ) end order by p.ord)
      from page p cross join params pr
    ), '[]'::jsonb)
  );
$$;
revoke execute on function public.search_coaches(text, text, text, boolean, boolean, text[], int, int, int, text, boolean, text, int, int, boolean, boolean, uuid, boolean) from public;
grant execute on function public.search_coaches(text, text, text, boolean, boolean, text[], int, int, int, text, boolean, text, int, int, boolean, boolean, uuid, boolean) to anon, authenticated;
