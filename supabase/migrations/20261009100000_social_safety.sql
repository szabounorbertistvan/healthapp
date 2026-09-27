-- Social 2.0 · Safety, completing Block / Mute / Report
--
-- Block, mute and report were built in 20261007100000; notifications learned
-- about blocks in 20261008100000 (social_notify_ok). Nothing here duplicates
-- them. This closes the gaps a safety pass found:
--
-- 1. A comment can be reported, not only a post or a person. The target is
--    the comment's id alone — the post it belongs to is read from the row,
--    never taken from the client, so there is no "comment of another post"
--    to forge. Reporting a comment you may not see (its post hidden, deleted,
--    or behind a block) answers exactly like a comment that does not exist.
-- 2. Three more reasons people actually need — hate, impersonation, scam —
--    added to the existing list (nothing renamed, old reports stay valid).
-- 3. A report is unique per reporter + target + reason: the same person may
--    report one post as spam and, separately, as a scam; the same report
--    twice is still a quiet no-op.
-- 4. A `status` column ('open' by default) so a later moderation stage has
--    somewhere to write. No workflow, no reader: the table still has no
--    select policy and no grant — nobody reads reports through the app.
--
-- Unchanged on purpose: the block (two-way, atomic follow removal, no
-- restore on unblock), the mute (feed and stories tray only; follows,
-- profile and notifications untouched), and social_notify_ok.

-- ---------- 1–4. the reports table ----------
alter table public.social_reports
  add column if not exists reported_comment_id uuid references public.social_comments (id) on delete cascade;
alter table public.social_reports
  add column if not exists status text not null default 'open';

-- The "exactly one target" and reason checks were unnamed; find them by what they say.
do $$
declare
  v_name text;
begin
  for v_name in
    select c.conname from pg_constraint c
    where c.conrelid = 'public.social_reports'::regclass and c.contype = 'c'
      and (pg_get_constraintdef(c.oid) like '%reported_user_id IS NULL%'
           or pg_get_constraintdef(c.oid) like '%reason%')
  loop
    execute format('alter table public.social_reports drop constraint %I', v_name);
  end loop;
end;
$$;

alter table public.social_reports add constraint social_reports_one_target
  check (num_nonnulls(reported_user_id, reported_post_id, reported_comment_id) = 1);
alter table public.social_reports add constraint social_reports_reason
  check (reason in ('spam', 'harassment', 'inappropriate', 'false_information', 'hate', 'impersonation', 'scam', 'other'));
alter table public.social_reports add constraint social_reports_status
  check (status in ('open', 'reviewed', 'dismissed'));

drop index if exists public.social_reports_one_per_post;
drop index if exists public.social_reports_one_per_user;
create unique index social_reports_one_per_post on public.social_reports (reporter_id, reported_post_id, reason)
  where reported_post_id is not null;
create unique index social_reports_one_per_user on public.social_reports (reporter_id, reported_user_id, reason)
  where reported_user_id is not null;
create unique index social_reports_one_per_comment on public.social_reports (reporter_id, reported_comment_id, reason)
  where reported_comment_id is not null;

comment on table public.social_reports is
  'User reports of a post, a comment or a person. Written only by social_report(); unreadable from the app (no select policy). status is for a future moderation stage; nothing writes it yet.';

-- ---------- the write: 20261007100000's function, plus comments and the new reasons ----------
create or replace function public.social_report(p_kind text, p_target uuid, p_reason text, p_details text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_details text := nullif(btrim(coalesce(p_details, '')), '');
  v_author uuid;
  v_post uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_reason is null
     or p_reason not in ('spam', 'harassment', 'inappropriate', 'false_information', 'hate', 'impersonation', 'scam', 'other') then
    raise exception 'unknown reason' using errcode = '22023';
  end if;
  if v_details is not null and char_length(v_details) > 500 then
    raise exception 'details too long' using errcode = '22023';
  end if;

  if p_kind = 'post' then
    -- Missing, deleted, private, behind a block: one answer for all of them.
    if p_target is null or not public.can_see_post(p_target) then
      raise exception 'post not found' using errcode = 'P0002';
    end if;
    select p.user_id into v_author from public.social_posts p where p.id = p_target;
    if v_author = auth.uid() then
      raise exception 'cannot report your own post' using errcode = '22023';
    end if;
    insert into public.social_reports (reporter_id, reported_post_id, reason, details)
    values (auth.uid(), p_target, p_reason, v_details)
    on conflict (reporter_id, reported_post_id, reason) where reported_post_id is not null do nothing;

  elsif p_kind = 'comment' then
    -- The post is the comment's own, read here; the same single answer for
    -- a missing comment and one on a post the reporter may not see.
    select c.user_id, c.post_id into v_author, v_post from public.social_comments c where c.id = p_target;
    if v_post is null or not public.can_see_post(v_post)
       or public.social_blocked_between(auth.uid(), v_author) then
      raise exception 'comment not found' using errcode = 'P0002';
    end if;
    if v_author = auth.uid() then
      raise exception 'cannot report your own comment' using errcode = '22023';
    end if;
    insert into public.social_reports (reporter_id, reported_comment_id, reason, details)
    values (auth.uid(), p_target, p_reason, v_details)
    on conflict (reporter_id, reported_comment_id, reason) where reported_comment_id is not null do nothing;

  elsif p_kind = 'user' then
    if p_target = auth.uid() then
      raise exception 'cannot report yourself' using errcode = '22023';
    end if;
    -- A person may be reported after being blocked, so existence is the only test.
    if p_target is null or not exists (select 1 from public.users u where u.id = p_target) then
      raise exception 'user not found' using errcode = 'P0002';
    end if;
    insert into public.social_reports (reporter_id, reported_user_id, reason, details)
    values (auth.uid(), p_target, p_reason, v_details)
    on conflict (reporter_id, reported_user_id, reason) where reported_user_id is not null do nothing;

  else
    raise exception 'unknown report target' using errcode = '22023';
  end if;
end;
$$;
revoke execute on function public.social_report(text, uuid, text, text) from public, anon;
grant execute on function public.social_report(text, uuid, text, text) to authenticated;
