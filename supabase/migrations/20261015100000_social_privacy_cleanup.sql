-- Social edge cases & final privacy cleanup.
--
-- An audit of every social read and write as it stands after 20261014100000,
-- from the angle of a signed-in user calling PostgREST directly — the table
-- endpoints as well as the RPCs. What it found, and what changes here:
--
-- 1. SUSPENSION WAS ENFORCED ONLY IN THE APP. (client)/layout and
--    (coach)/layout redirect a suspended account to /suspended; the database
--    let the same token post, comment, react, follow, save, publish a story,
--    create or join a challenge and file reports. Every social WRITE policy
--    now also asks social_actor_active() — signed in, not suspended, no
--    pending deletion. Deletes (your own comment, reaction, follow, save,
--    story, mute) and block / unblock stay open: they only ever take things
--    away. social_notify_ok() refuses an actor who is not active, so nothing
--    written before this migration by such an account notifies anyone.
--
-- 2. A POST DELETED BY AN ADMIN COULD BE UNDELETED BY ITS AUTHOR. The author
--    holds UPDATE on social_posts.deleted_at (it is how the app soft-deletes),
--    so `update social_posts set deleted_at = null` restored a post removed
--    by admin_delete_post. social_posts_delete_guard: from a client, deleted_at
--    only ever goes from null to the server's now(); once set it stays.
--
-- 3. TABLE ENDPOINTS BYPASSED THE RPC FILTERS. Four SELECT policies asked
--    only "may you see the post", while the RPCs also leave out authors who
--    are suspended, being deleted or behind a block:
--      social_comments          every comment and reply, so a direct count
--                               of a thread included hidden replies
--      social_reactions         the user_id of every reactor
--      social_post_mentions     every mention row, including stale ones
--      social_comment_mentions  the same, and on comments hidden from you
--    Each now applies the same rule as the reads (social_comment_shown,
--    social_post_mention_shown, social_comment_mention_shown). The author of
--    a post or comment still sees every mention row on it — the app's edit
--    path diffs against them. social_story_views: a story's owner no longer
--    reads rows of viewers who are not listed for them (social_story_viewers
--    already left them out).
--
-- 4. REPLIES UNDER A COMMENT YOU CANNOT SEE. comments_insert checks the post;
--    nothing checked the parent. Someone who was blocked by a commenter could
--    still reply under that comment by id. The depth guard now answers
--    "parent comment not found" for a parent the replier may not see — the
--    same answer as a missing one. Only on insert: editing your own reply
--    later is not affected.
--
-- 5. PEOPLE WHO ARE NOT LISTED, IN PLACES THAT NAMED THEM.
--    social_leaderboard   suspended and deleting accounts were ranked and
--                         shown on the global and following boards. They are
--                         now left out of the ranking itself: the board is
--                         recomputed on every read and they are not eligible.
--    challenge_leaderboard  the rows of suspended / deleting participants are
--                         left out of what the caller receives, exactly as
--                         blocked ones already were: ranks, values and the
--                         participant count are still computed over everyone
--                         who joined, so the challenge's history is untouched.
--    coach_challenge_progress  the same for a coach's own clients.
--    social_post_kudos    listed suspended / deleting reactors by name.
--    social_mention_candidates  offered suspended / deleting accounts in the
--                         @ autocomplete; its LIKE wildcards are now escaped.
--    social_mutual_followers  answered for a user who is not listed.
--    can_see_stats / can_see_fitness_score  (behind social_badges and
--                         social_streak, callable directly) answered for a
--                         suspended or deleting account. Their coach and an
--                         admin keep seeing stats, as before.
--
-- 6. CHALLENGES AND BLOCKS. can_see_challenge — behind challenges_select,
--    participants_join, challenge_cards and both leaderboards — ignored who
--    created the challenge. Now:
--      · a challenge whose creator is behind a block (either way) is hidden
--        from the other person, like a post; its creator always sees it;
--      · a challenge whose creator is suspended or being deleted is hidden
--        from anyone who is not already in it (or coaching someone in it):
--        people who joined keep their progress, nobody new finds it.
--    Platform challenges (no creator) are unchanged. No challenge surface
--    names its creator (challenge_cards returns is_mine / is_platform only),
--    so there was no identity to mask.
--
-- 7. REPORTS.
--    · A comment by an author the reporter may not see (suspended, deleting,
--      a block, or under a hidden parent) could be reported by id; it now
--      gets the same "comment not found" as a missing one.
--    · A suspended or deleting user could be reported by id; the same
--      "user not found" as a missing one now. A block, either way, still
--      allows a report — the reporter already knows who it is.
--    · One report per reporter and target, whatever the reason: the unique
--      indexes were per (reporter, target, reason), so one post could be
--      reported eight times. Existing rows are kept as they are; the check is
--      in social_report(), serialized per (reporter, target) with an advisory
--      lock so two concurrent calls cannot both insert.
--    · Only an active account may report.
--
-- 8. ANON. can_kudos_post, can_see_post, can_see_challenge, can_see_program,
--    challenge_cards and is_following were still executable by anon. No
--    policy or page needs that (every policy is `to authenticated`), and
--    can_see_challenge answered anon for public challenges by id.
--
-- Left as they are, on purpose: mute (it quiets the feed and the story tray,
-- it does not take anyone out of a conversation — 20261013100000); the
-- reaction COUNTS (a count(*) over the post's reactions; the names beside
-- them are already listed-only); reads by a suspended account (it cannot
-- write or notify; what it can read is what any new account could).
--
-- Every function below starts from its latest definition (named on each).

-- ---------- helpers ----------

-- The acting account may write socially: signed in, not suspended, not being deleted.
create or replace function public.social_actor_active()
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
     and exists (select 1 from public.users u where u.id = auth.uid() and u.suspended_at is null)
     and not exists (select 1 from public.account_deletion_requests d where d.user_id = auth.uid());
$$;
revoke execute on function public.social_actor_active() from public, anon;
grant execute on function public.social_actor_active() to authenticated;

-- A comment row is shown to the reader: its author is visible to them and,
-- for a reply, so is the parent's (the rule of 20261013100000, per row).
create or replace function public.social_comment_shown(p_author uuid, p_parent uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.social_author_visible(p_author)
     and (p_parent is null or exists (
       select 1 from public.social_comments pc
       where pc.id = p_parent and pc.parent_id is null and public.social_author_visible(pc.user_id)));
$$;
revoke execute on function public.social_comment_shown(uuid, uuid) from public, anon;
grant execute on function public.social_comment_shown(uuid, uuid) to authenticated;

-- A post mention row, as social_visible_post_mentions shows it. The post's
-- author sees every row on their own post.
create or replace function public.social_post_mention_shown(p_post uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.social_posts p
    join public.users mu on mu.id = p_user
    where p.id = p_post
      and (p.user_id = auth.uid()
           or (lower(mu.username) = any (public.social_mention_handles(p.text))
               and public.is_listed_user(p_user)
               and public.user_can_see_post(p_user, p.id))));
$$;
revoke execute on function public.social_post_mention_shown(uuid, uuid) from public, anon;
grant execute on function public.social_post_mention_shown(uuid, uuid) to authenticated;

-- A comment mention row, as social_visible_comment_mentions shows it, on a
-- comment the reader may see. The comment's author sees every row on it.
create or replace function public.social_comment_mention_shown(p_comment uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.social_comments c
    join public.users mu on mu.id = p_user
    where c.id = p_comment
      and public.can_see_post(c.post_id)
      and (c.user_id = auth.uid()
           or (public.social_comment_shown(c.user_id, c.parent_id)
               and lower(mu.username) = any (public.social_mention_handles(c.body))
               and public.is_listed_user(p_user)
               and public.user_can_see_post(p_user, c.post_id)
               and not public.social_blocked_between(c.user_id, p_user))));
$$;
revoke execute on function public.social_comment_mention_shown(uuid, uuid) from public, anon;
grant execute on function public.social_comment_mention_shown(uuid, uuid) to authenticated;

-- ---------- 1. writes need an active account ----------
drop policy if exists posts_insert on public.social_posts;
create policy posts_insert on public.social_posts for insert to authenticated
  with check (user_id = auth.uid() and public.social_actor_active());
drop policy if exists posts_update on public.social_posts;
create policy posts_update on public.social_posts for update to authenticated
  using (user_id = auth.uid() and public.social_actor_active())
  with check (user_id = auth.uid() and public.social_actor_active());

drop policy if exists comments_insert on public.social_comments;
create policy comments_insert on public.social_comments for insert to authenticated
  with check (user_id = auth.uid() and public.can_see_post(post_id) and public.social_actor_active());
drop policy if exists comments_update on public.social_comments;
create policy comments_update on public.social_comments for update to authenticated
  using (user_id = auth.uid() and public.can_see_post(post_id) and public.social_actor_active())
  with check (user_id = auth.uid() and public.can_see_post(post_id) and public.social_actor_active());

drop policy if exists reactions_insert on public.social_reactions;
create policy reactions_insert on public.social_reactions for insert to authenticated
  with check (user_id = auth.uid() and public.can_kudos_post(post_id) and public.social_actor_active());

drop policy if exists follows_insert on public.social_follows;
create policy follows_insert on public.social_follows for insert to authenticated
  with check (follower_id = auth.uid() and public.is_listed_user(following_id) and public.social_actor_active());

drop policy if exists post_saves_insert on public.social_post_saves;
create policy post_saves_insert on public.social_post_saves for insert to authenticated
  with check (user_id = auth.uid() and public.can_see_post(post_id)
              and exists (select 1 from public.social_posts p where p.id = post_id and public.is_listed_user(p.user_id))
              and public.social_actor_active());

drop policy if exists stories_insert on public.social_stories;
create policy stories_insert on public.social_stories for insert to authenticated
  with check (user_id = auth.uid() and public.social_actor_active());

drop policy if exists challenges_owner_insert on public.challenges;
create policy challenges_owner_insert on public.challenges for insert to authenticated
  with check (creator_id = auth.uid() and public.social_actor_active());
drop policy if exists challenges_owner_update on public.challenges;
create policy challenges_owner_update on public.challenges for update to authenticated
  using (creator_id = auth.uid() and public.social_actor_active())
  with check (creator_id = auth.uid() and public.social_actor_active());

drop policy if exists participants_join on public.challenge_participants;
create policy participants_join on public.challenge_participants for insert to authenticated
  with check (user_id = auth.uid() and public.can_see_challenge(challenge_id)
              and exists (select 1 from public.challenges c
                          where c.id = challenge_id and c.end_date >= public.my_local_today())
              and public.social_actor_active());

-- social_notify_ok from 20261008100000, plus the actor.
create or replace function public.social_notify_ok(p_recipient uuid, p_actor uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_recipient is not null
     and p_recipient is distinct from p_actor
     and exists (select 1 from public.users u where u.id = p_recipient and u.suspended_at is null)
     and not exists (select 1 from public.account_deletion_requests d where d.user_id = p_recipient)
     and (p_actor is null or (
       exists (select 1 from public.users u where u.id = p_actor and u.suspended_at is null)
       and not exists (select 1 from public.account_deletion_requests d where d.user_id = p_actor)))
     and not public.social_blocked_between(p_recipient, p_actor);
$$;

-- ---------- 2. a deleted post stays deleted ----------
create or replace function public.social_posts_delete_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.deleted_at is not distinct from old.deleted_at then
    return new;
  end if;
  -- The service role and an admin's own tools manage deletion themselves.
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;
  if old.deleted_at is not null then
    raise exception 'post not found' using errcode = 'P0002';
  end if;
  new.deleted_at := now();
  return new;
end;
$$;
revoke execute on function public.social_posts_delete_guard() from public, anon, authenticated;
drop trigger if exists social_posts_delete_guard on public.social_posts;
create trigger social_posts_delete_guard before update of deleted_at on public.social_posts
  for each row execute function public.social_posts_delete_guard();

-- ---------- 3. table reads follow the RPCs ----------
drop policy if exists comments_select on public.social_comments;
create policy comments_select on public.social_comments for select to authenticated
  using (public.can_see_post(post_id) and public.social_comment_shown(user_id, parent_id));

drop policy if exists reactions_select on public.social_reactions;
create policy reactions_select on public.social_reactions for select to authenticated
  using (public.can_see_post(post_id) and (user_id = auth.uid() or public.is_listed_user(user_id)));

drop policy if exists post_mentions_select on public.social_post_mentions;
create policy post_mentions_select on public.social_post_mentions for select to authenticated
  using (public.can_see_post(post_id) and public.social_post_mention_shown(post_id, user_id));

drop policy if exists comment_mentions_select on public.social_comment_mentions;
create policy comment_mentions_select on public.social_comment_mentions for select to authenticated
  using (public.social_comment_mention_shown(comment_id, user_id));

drop policy if exists story_views_select on public.social_story_views;
create policy story_views_select on public.social_story_views for select to authenticated
  using (viewer_id = auth.uid()
         or (exists (select 1 from public.social_stories s
                     where s.id = story_id and s.user_id = auth.uid())
             and public.is_listed_user(viewer_id)));

-- ---------- 4. a reply only under a comment you can see ----------
-- social_comment_depth_guard from 20261007100000, plus the parent's visibility on insert.
create or replace function public.social_comment_depth_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_parent public.social_comments;
begin
  if new.parent_id is null then
    return new;
  end if;
  select * into v_parent from public.social_comments where id = new.parent_id;
  -- A parent the replier may not see is answered like a missing one.
  if not found
     or (tg_op = 'INSERT' and auth.uid() is not null and not public.social_author_visible(v_parent.user_id)) then
    raise exception 'parent comment not found' using errcode = 'P0002';
  end if;
  if v_parent.parent_id is not null then
    raise exception 'replies are one level deep' using errcode = '22023';
  end if;
  if v_parent.post_id <> new.post_id then
    raise exception 'a reply belongs to the same post as its parent' using errcode = '22023';
  end if;
  return new;
end;
$$;

-- ---------- 5. people who are not listed ----------
-- social_leaderboard from 20261007100000; `people` leaves out suspended and deleting accounts.
create or replace function public.social_leaderboard(
  p_metric text,
  p_period text,
  p_scope text default 'global',
  p_limit int default 10
)
returns table (
  rank int, user_id uuid, display_name text, username text, avatar_url text,
  score numeric, secondary_score numeric, is_current_user boolean
) language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  -- Fixed vocabularies: nothing from the caller reaches the SQL as text.
  if p_metric not in ('training_load', 'volume', 'workouts', 'active_days', 'streak') then
    raise exception 'unknown leaderboard metric' using errcode = '22023';
  end if;
  if p_period not in ('week', 'month', 'all') then
    raise exception 'unknown leaderboard period' using errcode = '22023';
  end if;
  if p_scope not in ('global', 'following') then
    raise exception 'unknown leaderboard scope' using errcode = '22023';
  end if;
  if auth.uid() is null then
    return;
  end if;

  return query
  with people as (
    -- Everyone the caller may see on a board: the setting, or themselves.
    select u.id, coalesce(u.username, u.full_name) as display_name, u.username, u.avatar_url,
           u.created_at, coalesce(u.timezone, 'Europe/Bucharest') as tz,
           (now() at time zone coalesce(u.timezone, 'Europe/Bucharest'))::date as today
    from public.users u
    where (
      u.id = auth.uid()
      or u.leaderboard_visibility = 'public'
      or (u.leaderboard_visibility = 'followers' and public.is_following(u.id))
    )
    -- Not eligible at all while suspended or being deleted: not ranked, not
    -- shown. (A block is different — see `visible` below.)
    and (
      u.id = auth.uid()
      or (u.suspended_at is null
          and not exists (select 1 from public.account_deletion_requests d where d.user_id = u.id))
    )
    -- 'following' narrows the same visible set to the people the caller
    -- follows, plus themselves. It never widens it: someone who is private
    -- stays off the board even if you follow them.
    and (
      p_scope = 'global'
      or u.id = auth.uid()
      or public.is_following(u.id)
    )
  ),
  windows as (
    -- Each person's window on their own calendar: Monday → today, the 1st → today, or open.
    select p.*,
           case p_period
             when 'week' then date_trunc('week', p.today::timestamp)::date
             when 'month' then date_trunc('month', p.today::timestamp)::date
             else null
           end as period_start
    from people p
  ),
  sessions as (
    -- One row per completed session with the same rollup challenge_progress_rows()
    -- uses, scored by the mirrored formula. Every session, not only the window:
    -- a streak needs the days before it.
    select
      w.id as uid,
      (s.started_at at time zone w.tz)::date as day,
      w.period_start, w.today,
      public.training_load_score(
        coalesce(sum(greatest(ls.weight_kg, 0) * ls.reps) filter (where ls.reps > 0), 0)::double precision,
        count(ls.id) filter (where ls.reps > 0)::int,
        nullif(round(extract(epoch from (s.completed_at - s.started_at)) / 60)::int, 0),
        avg(public.effective_rpe(ls.rpe, ls.rir)) filter (where ls.reps > 0)::double precision,
        count(distinct ls.exercise_id) filter (where ls.reps > 0)::int
      ) as load,
      coalesce(sum(greatest(ls.weight_kg, 0) * ls.reps) filter (where ls.reps > 0), 0) as volume_kg
    from public.logged_sessions s
    join windows w on w.id = s.user_id
    left join public.logged_sets ls on ls.session_id = s.id
    where s.completed_at is not null
    group by w.id, s.id, s.started_at, s.completed_at, w.tz, w.period_start, w.today
  ),
  inside as (
    select * from sessions
    where (period_start is null or day >= period_start) and day <= today
  ),
  -- streak: gaps and islands over every active day, keep the runs touching the window
  days as (
    select distinct uid, day, period_start, today from sessions
  ),
  runs as (
    select uid, day, period_start, today,
           day - (row_number() over (partition by uid order by day))::int as grp
    from days
  ),
  streaks as (
    select uid, min(day) as s, max(day) as e, count(*)::int as len, period_start, today
    from runs group by uid, grp, period_start, today
  ),
  streak_score as (
    select uid, max(len) as best
    from streaks
    where (period_start is null or e >= period_start) and s <= today
    group by uid
  ),
  totals as (
    select
      i.uid,
      sum(i.load)::numeric as load,
      round(sum(i.volume_kg))::numeric as volume,
      count(*)::numeric as workouts,
      count(distinct i.day)::numeric as active_days
    from inside i
    group by i.uid
  ),
  scored as (
    select
      p.id, p.display_name, p.username, p.avatar_url, p.created_at,
      case p_metric
        when 'training_load' then coalesce(t.load, 0)
        when 'volume' then coalesce(t.volume, 0)
        when 'workouts' then coalesce(t.workouts, 0)
        when 'active_days' then coalesce(t.active_days, 0)
        else coalesce(ss.best, 0)::numeric
      end as score,
      case p_metric
        when 'training_load' then coalesce(t.volume, 0)
        when 'volume' then coalesce(t.workouts, 0)
        when 'workouts' then coalesce(t.volume, 0)
        when 'active_days' then coalesce(t.workouts, 0)
        else coalesce(t.active_days, 0)
      end as secondary
    from people p
    left join totals t on t.uid = p.id
    left join streak_score ss on ss.uid = p.id
  ),
  ranked as (
    -- Only people with something on the board; a quiet week is not a last place.
    select
      row_number() over (order by sc.score desc, sc.secondary desc, sc.created_at asc, sc.id asc)::int as rank,
      sc.*
    from scored sc
    where sc.score > 0
  ),
  -- Block (20261007100000) is applied here and only here: after the ranking,
  -- to what this caller receives. Everyone is ranked as before, so every
  -- visible person keeps their own rank number, score and place in the
  -- order; the blocked person's row simply is not handed over, and the top
  -- p_limit is filled from the next visible rows.
  visible as (
    select r.*, row_number() over (order by r.rank) as shown
    from ranked r
    where r.id = auth.uid() or not public.social_blocked_between(auth.uid(), r.id)
  )
  select v.rank, v.id, v.display_name, v.username, v.avatar_url, v.score, v.secondary, v.id = auth.uid()
  from visible v
  where v.shown <= greatest(1, least(p_limit, 50)) or v.id = auth.uid()
  order by v.rank;
end;
$$;

-- challenge_leaderboard from 20261007100000; `visible` uses is_listed_user
-- (block, suspension, deletion) where it used the block alone.
create or replace function public.challenge_leaderboard(p_challenge uuid, p_limit int default 10)
returns table (rank int, username text, value numeric, completed boolean, is_me boolean, participant_count int)
language sql stable security definer set search_path = public as $$
  with scored as (
    select p.user_id,
           coalesce(u.username, '—') as username,
           public.challenge_value(p_challenge, p.user_id) as value,
           p.completed_at is not null as completed
    from public.challenge_participants p
    join public.users u on u.id = p.user_id
    where p.challenge_id = p_challenge
      and auth.uid() is not null
      and public.can_see_challenge(p_challenge)
  ),
  ranked as (
    select s.*,
           rank() over (order by s.value desc)::int as rnk,
           row_number() over (order by s.value desc, s.username, s.user_id) as rn,
           count(*) over ()::int as total
    from scored s
  ),
  -- Ranks and the participant count are computed over everyone who joined —
  -- the challenge's history. Who is NAMED is only whoever is listed for this
  -- caller: not behind a block, not suspended, not being deleted.
  visible as (
    select r.*, row_number() over (order by r.rn) as shown
    from ranked r
    where r.user_id = auth.uid() or public.is_listed_user(r.user_id)
  )
  select v.rnk, v.username, v.value, v.completed, v.user_id = auth.uid(), v.total
  from visible v
  where v.shown <= greatest(1, least(coalesce(p_limit, 10), 100)) or v.user_id = auth.uid()
  order by v.rn;
$$;

-- coach_challenge_progress from 20261007100000; is_listed_user where it used the block alone.
create or replace function public.coach_challenge_progress()
returns table (challenge_id uuid, client_id uuid, username text, value numeric, completed boolean)
language sql stable security definer set search_path = public as $$
  select p.challenge_id, p.user_id, coalesce(u.username, '—'),
         public.challenge_value(p.challenge_id, p.user_id), p.completed_at is not null
  from public.challenge_participants p
  join public.users u on u.id = p.user_id
  where public.is_active_coach_of(p.user_id)
    and public.can_see_challenge(p.challenge_id)
    and public.is_listed_user(p.user_id);
$$;

-- social_post_kudos from 20261014100000; a reactor must be listed, not just unblocked.
create or replace function public.social_post_kudos(p_post uuid, p_limit int default 20, p_before timestamptz default null)
returns table (user_id uuid, name text, username text, avatar_url text, type text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.user_id, coalesce(u.username, u.full_name), u.username, u.avatar_url, r.type, r.created_at
  from public.social_reactions r
  join public.users u on u.id = r.user_id
  where r.post_id = p_post
    and public.can_see_post(p_post)
    and (r.user_id = auth.uid() or public.is_listed_user(r.user_id))
    and (p_before is null or r.created_at < p_before)
  order by r.created_at desc, r.id desc
  limit greatest(1, least(p_limit, 50));
$$;

-- social_mention_candidates from 20261007100000; listed only, and the query's
-- LIKE wildcards escaped (as social_follow_list does) so "_" is not "anyone".
create or replace function public.social_mention_candidates(p_query text, p_post uuid default null)
returns table (id uuid, name text, username text, avatar_url text, can_see boolean)
language sql stable security definer set search_path = public as $$
  select u.id, coalesce(u.username, u.full_name), u.username, u.avatar_url,
    (p_post is null or exists (
      select 1 from public.social_posts p
      where p.id = p_post and p.deleted_at is null
        and (p.user_id = u.id or p.visibility = 'public'
             or (p.visibility = 'followers'
                 and (exists (select 1 from public.social_follows f
                              where f.follower_id = u.id and f.following_id = p.user_id)
                      or exists (select 1 from public.trainer_clients tc
                                 where tc.coach_id = u.id and tc.client_id = p.user_id
                                   and tc.status = 'active'))))
    )) as can_see
  from public.users u
  where auth.uid() is not null
    and u.id <> auth.uid()
    and u.username is not null
    and public.is_listed_user(u.id)
    and char_length(btrim(coalesce(p_query, ''))) >= 1
    and u.username ilike replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%'
  order by can_see desc, u.username
  limit 8;
$$;

-- social_mutual_followers from 20261003100000; nothing for a user who is not listed.
create or replace function public.social_mutual_followers(p_user uuid, p_limit int default 3)
returns table (id uuid, name text, username text, avatar_url text, total int)
language sql stable security definer set search_path = public as $$
  with mutual as (
    select f.follower_id as id
    from public.social_follows f
    where f.following_id = p_user
      and auth.uid() is not null
      and (p_user = auth.uid() or public.is_listed_user(p_user))
      and f.follower_id <> auth.uid()
      and public.is_listed_user(f.follower_id)
      and exists (select 1 from public.social_follows mine
                  where mine.follower_id = auth.uid() and mine.following_id = f.follower_id)
  )
  select u.id, coalesce(u.username, u.full_name), u.username, u.avatar_url,
         (select count(*)::int from mutual)
  from mutual m
  join public.users u on u.id = m.id
  order by u.username nulls last
  limit greatest(1, least(coalesce(p_limit, 3), 20));
$$;

-- can_see_stats from 20261007100000; a suspended or deleting account's stats
-- are shown to nobody but themselves, their coach and an admin.
create or replace function public.can_see_stats(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (
    select 1 from public.users u
    where u.id = p_user
      and (
        u.id = auth.uid()
        or ((u.stats_visibility = 'public'
             or (u.stats_visibility = 'followers' and public.is_following(u.id))
             or public.is_active_coach_of(u.id)
             or public.is_admin())
            and not public.social_blocked_between(auth.uid(), u.id)
            and ((u.suspended_at is null
                  and not exists (select 1 from public.account_deletion_requests d where d.user_id = u.id))
                 or public.is_active_coach_of(u.id)
                 or public.is_admin()))
      )
  );
$$;

-- can_see_fitness_score from 20261007100000; the same for the public score.
create or replace function public.can_see_fitness_score(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (
    select 1 from public.users u
    where u.id = p_user
      and (
        u.id = auth.uid()
        or ((u.fitness_score_visibility = 'public'
             or (u.fitness_score_visibility = 'followers' and public.is_following(u.id)))
            and not public.social_blocked_between(auth.uid(), u.id)
            and u.suspended_at is null
            and not exists (select 1 from public.account_deletion_requests d where d.user_id = u.id))
      )
  );
$$;

-- ---------- 6. challenges and blocks ----------
-- can_see_challenge from 20260912100000, plus the creator.
create or replace function public.can_see_challenge(p_challenge uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.challenges c
    where c.id = p_challenge
      and (
        c.creator_id = auth.uid()
        or (
          -- the old rule: public, or someone the caller is / coaches is in it
          (c.visibility = 'public'
           or exists (
             select 1 from public.challenge_participants p
             where p.challenge_id = c.id
               and (p.user_id = auth.uid() or public.is_active_coach_of(p.user_id))))
          -- the creator: never behind a block with the caller; while suspended
          -- or being deleted, only people already in it still see it
          and (c.creator_id is null
               or (not public.social_blocked_between(auth.uid(), c.creator_id)
                   and ((exists (select 1 from public.users cu
                                 where cu.id = c.creator_id and cu.suspended_at is null)
                         and not exists (select 1 from public.account_deletion_requests d
                                         where d.user_id = c.creator_id))
                        or exists (
                          select 1 from public.challenge_participants p
                          where p.challenge_id = c.id
                            and (p.user_id = auth.uid() or public.is_active_coach_of(p.user_id))))))
        )
      )
  );
$$;

-- ---------- 7. reports ----------
-- social_report from 20261007100000.
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
  if p_kind is null or p_kind not in ('post', 'comment', 'user') then
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

-- ---------- 8. anon ----------
revoke execute on function public.can_kudos_post(uuid) from public, anon;
revoke execute on function public.can_see_post(uuid) from public, anon;
revoke execute on function public.can_see_challenge(uuid) from public, anon;
revoke execute on function public.can_see_program(uuid) from public, anon;
revoke execute on function public.challenge_cards(uuid) from public, anon;
revoke execute on function public.is_following(uuid) from public, anon;
grant execute on function public.can_kudos_post(uuid) to authenticated;
grant execute on function public.can_see_post(uuid) to authenticated;
grant execute on function public.can_see_challenge(uuid) to authenticated;
grant execute on function public.can_see_program(uuid) to authenticated;
grant execute on function public.challenge_cards(uuid) to authenticated;
grant execute on function public.is_following(uuid) to authenticated;

-- create or replace keeps grants; restated for the functions changed here.
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and p.proname in ('social_leaderboard', 'challenge_leaderboard', 'coach_challenge_progress',
                               'social_post_kudos', 'social_mention_candidates', 'social_mutual_followers',
                               'can_see_stats', 'can_see_fitness_score', 'social_report') loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
