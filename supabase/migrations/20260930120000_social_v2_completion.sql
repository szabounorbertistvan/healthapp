-- HealthApp schema · social v2, completed
--
-- 20260930110000_social_v2 gave the feed replies, comment mentions and the
-- notifications they produce. This one finishes the job without rewriting it:
-- can_see_post() is still the one post-visibility predicate, and every table
-- and RPC below builds on the ones already there.
--
-- 1. Profile privacy. Until now social_profile() and social_streak() answered
--    anybody signed in with anybody's workout count, PR count and streak — the
--    RPCs are security definer, so hiding the numbers in the page would have
--    changed nothing for someone calling PostgREST directly. Two settings on
--    users, and can_see_stats() as the one predicate:
--      stats_visibility          public (default — today's behaviour) /
--                                followers / private
--      fitness_score_visibility  private (default) / followers / public
--    The Fitness Score is computed in TypeScript from private sets, so another
--    person's profile cannot compute it. It shows the SNAPSHOT the owner last
--    published (users.fitness_score_public) and only if they opted in.
--
-- 2. Badges, awarded. `badges` and `user_badges` have existed since the
--    engagement migration with nothing writing them. award_badges_for() checks
--    every criterion against real rows and inserts what was earned; triggers
--    call it when a workout is completed, a check-in is written, a challenge
--    is finished or a food day is logged, and the existing history is
--    backfilled at the end of this file. A badge cannot be claimed — nothing a
--    client sends can insert into user_badges (no insert policy).
--
-- 3. Two post types: 'achievement' and 'fitness_score'. An achievement post's
--    payload is REBUILT by a trigger from the catalog and the award row, so
--    the snapshot is the server's, not the browser's, and a badge the author
--    has not earned cannot be posted at all.
--
-- 4. Snapshots are immutable. posts_update allowed an owner to rewrite any
--    column of their own post, payload included. The update grant is now
--    column-level: text, visibility and deleted_at. Comments likewise: body
--    only, stamped with edited_at.
--
-- 5. Mentions in post captions, stored as rows exactly like comment mentions
--    and notified under the same rule: only when the mentioned person can
--    already see the post.
--
-- 6. Replies paged: a thread carries its first three replies; the rest come
--    from social_comment_replies() on a cursor.
--
-- 7. People: search paged (offset), people pending deletion left out,
--    suggestions that fall back to the most-followed people when you follow
--    nobody yet, and a profile's public programs.

-- ---------- 1. profile privacy ----------
alter table public.users
  add column if not exists stats_visibility text not null default 'public'
    check (stats_visibility in ('public', 'followers', 'private')),
  add column if not exists fitness_score_visibility text not null default 'private'
    check (fitness_score_visibility in ('public', 'followers', 'private')),
  add column if not exists fitness_score_public smallint
    check (fitness_score_public is null or fitness_score_public between 0 and 100),
  add column if not exists fitness_score_public_at timestamptz;

comment on column public.users.stats_visibility is
  'Who sees workout / PR / challenge counts, streak and badges on the social profile.';
comment on column public.users.fitness_score_visibility is
  'Who sees fitness_score_public on the social profile. Private by default: opt-in.';
comment on column public.users.fitness_score_public is
  'The Fitness Score the owner last published to their profile — a snapshot, never recomputed for other readers.';

-- The two settings are the owner's to change through the account form. The
-- snapshot itself goes through set_public_fitness_score(), which stamps the time.
grant update (stats_visibility, fitness_score_visibility) on table public.users to authenticated;

/**
 * May the caller see this person's activity numbers (counts, streak, badges)?
 * Yourself, then the setting, then the relationships that already reach
 * further than this: an active coach sees the underlying sessions anyway, and
 * an admin sees the admin panel.
 */
create or replace function public.can_see_stats(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.users u
    where u.id = p_user
      and (
        u.id = auth.uid()
        or u.stats_visibility = 'public'
        or (u.stats_visibility = 'followers' and public.is_following(u.id))
        or public.is_active_coach_of(u.id)
        or public.is_admin()
      )
  );
$$;
grant execute on function public.can_see_stats(uuid) to authenticated;

/** The same question for the Fitness Score snapshot, which has its own setting. */
create or replace function public.can_see_fitness_score(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.users u
    where u.id = p_user
      and (
        u.id = auth.uid()
        or u.fitness_score_visibility = 'public'
        or (u.fitness_score_visibility = 'followers' and public.is_following(u.id))
      )
  );
$$;
grant execute on function public.can_see_fitness_score(uuid) to authenticated;

/**
 * Publish your current Fitness Score to your profile. The number is computed
 * by the app from your own sets (packages/shared/fitness-score); what is
 * stored is only the number and when. Only ever your own row.
 */
create or replace function public.set_public_fitness_score(p_score int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;
  if p_score is null or p_score < 0 or p_score > 100 then
    raise exception 'score out of range' using errcode = '22023';
  end if;
  update public.users
  set fitness_score_public = p_score, fitness_score_public_at = now()
  where id = auth.uid();
end;
$$;
revoke execute on function public.set_public_fitness_score(int) from public, anon;
grant execute on function public.set_public_fitness_score(int) to authenticated;

-- ---------- someone's streak, now behind the setting ----------
-- Same numbers as 20260913130000; the only change is the gate. A person with
-- private stats reads as 0 / 0 to everybody but themselves, their coach and
-- an admin — the same as someone who has never trained, which is the point.
create or replace function public.social_streak(p_user uuid)
returns table (current_days int, longest_days int)
language sql stable security definer set search_path = public as $$
  with tz as (
    select coalesce(u.timezone, 'Europe/Bucharest') as name from public.users u where u.id = p_user
  ),
  days as (
    select distinct (s.started_at at time zone (select name from tz))::date as d
    from public.logged_sessions s
    where s.user_id = p_user and s.completed_at is not null
      and public.can_see_stats(p_user)
  ),
  runs as (
    select d, d - (row_number() over (order by d))::int as grp from days
  ),
  streaks as (
    select min(d) as s, max(d) as e, count(*)::int as len from runs group by grp
  ),
  today as (
    select (now() at time zone (select name from tz))::date as d
  )
  select
    coalesce((select st.len from streaks st, today where st.e >= today.d - 1 order by st.e desc limit 1), 0),
    coalesce((select max(st.len) from streaks st), 0);
$$;
grant execute on function public.social_streak(uuid) to authenticated;

-- ---------- 2. badges ----------
-- Icons are names the app maps to its own glyphs; nothing renders them as markup.
update public.badges set icon = 'dumbbell' where slug in ('first-workout', 'workouts-10', 'workouts-50') and icon is null;
update public.badges set icon = 'flame'    where slug in ('streak-7', 'streak-30') and icon is null;
update public.badges set icon = 'check'    where slug = 'first-checkin' and icon is null;
update public.badges set icon = 'trophy'   where slug = 'first-pr' and icon is null;
update public.badges set icon = 'food'     where slug = 'nutrition-week' and icon is null;

insert into public.badges (slug, name_en, name_ro, icon, sort) values
  ('workouts-100',    '100 workouts',              '100 de antrenamente',        'dumbbell', 9),
  ('streak-100',      '100-day streak',            'Serie de 100 de zile',       'flame',    10),
  ('prs-10',          '10 personal records',       '10 recorduri personale',     'trophy',   11),
  ('first-challenge', 'First challenge completed', 'Prima provocare finalizată', 'target',   12)
on conflict (slug) do nothing;

alter type public.notification_category add value if not exists 'badge_earned';

/**
 * The longest run of consecutive local days with a completed workout — the
 * same gaps-and-islands rule social_streak() uses, ungated, for the award
 * engine only (never granted: it would bypass stats_visibility).
 */
create or replace function public.longest_workout_streak(p_user uuid)
returns int language sql stable security definer set search_path = public as $$
  with tz as (
    select coalesce(u.timezone, 'Europe/Bucharest') as name from public.users u where u.id = p_user
  ),
  days as (
    select distinct (s.started_at at time zone (select name from tz))::date as d
    from public.logged_sessions s
    where s.user_id = p_user and s.completed_at is not null
  ),
  runs as (
    select d - (row_number() over (order by d))::int as grp from days
  )
  select coalesce(max(n), 0)::int from (select count(*) as n from runs group by grp) x;
$$;
revoke execute on function public.longest_workout_streak(uuid) from public, anon, authenticated;

/**
 * Award every badge this person has earned and does not have yet; return the
 * slugs that were new. Idempotent — the primary key (user_id, badge_id) makes a
 * second run a no-op. Engine-only: not granted to anyone, called by the
 * triggers below and the backfill at the end of this file.
 */
create or replace function public.award_badges_for(p_user uuid, p_notify boolean default true)
returns setof text language plpgsql security definer set search_path = public as $$
declare
  v_workouts int;
  v_streak int;
  v_prs int;
  v_checkins int;
  v_challenges int;
  v_food_run int;
  v_earned text[] := '{}';
  v_slug text;
  v_name text;
  v_name_ro text;
begin
  if p_user is null then return; end if;

  select count(*)::int into v_workouts
  from public.logged_sessions where user_id = p_user and completed_at is not null;
  v_streak := public.longest_workout_streak(p_user);
  select count(*)::int into v_prs from public.logged_sets where user_id = p_user and is_pr;
  select count(*)::int into v_checkins from public.check_ins where user_id = p_user;
  select count(*)::int into v_challenges
  from public.challenge_participants where user_id = p_user and completed_at is not null;

  -- Seven consecutive days with food logged. Only computed when the badge is
  -- still missing: it walks every logged day.
  if not exists (select 1 from public.user_badges ub join public.badges b on b.id = ub.badge_id
                 where ub.user_id = p_user and b.slug = 'nutrition-week') then
    select coalesce(max(n), 0)::int into v_food_run from (
      select count(*) as n from (
        select d - (row_number() over (order by d))::int as grp
        from (select distinct date as d from public.food_logs where user_id = p_user) days
      ) runs group by grp
    ) x;
  else
    v_food_run := 0;
  end if;

  if v_workouts >= 1   then v_earned := array_append(v_earned, 'first-workout'); end if;
  if v_workouts >= 10  then v_earned := array_append(v_earned, 'workouts-10'); end if;
  if v_workouts >= 50  then v_earned := array_append(v_earned, 'workouts-50'); end if;
  if v_workouts >= 100 then v_earned := array_append(v_earned, 'workouts-100'); end if;
  if v_streak >= 7     then v_earned := array_append(v_earned, 'streak-7'); end if;
  if v_streak >= 30    then v_earned := array_append(v_earned, 'streak-30'); end if;
  if v_streak >= 100   then v_earned := array_append(v_earned, 'streak-100'); end if;
  if v_prs >= 1        then v_earned := array_append(v_earned, 'first-pr'); end if;
  if v_prs >= 10       then v_earned := array_append(v_earned, 'prs-10'); end if;
  if v_checkins >= 1   then v_earned := array_append(v_earned, 'first-checkin'); end if;
  if v_challenges >= 1 then v_earned := array_append(v_earned, 'first-challenge'); end if;
  if v_food_run >= 7   then v_earned := array_append(v_earned, 'nutrition-week'); end if;

  for v_slug, v_name, v_name_ro in
    with inserted as (
      insert into public.user_badges (user_id, badge_id)
      select p_user, b.id from public.badges b where b.slug = any(v_earned)
      on conflict (user_id, badge_id) do nothing
      returning badge_id
    )
    select b.slug, b.name_en, b.name_ro from inserted i join public.badges b on b.id = i.badge_id
  loop
    if p_notify then
      -- Both names travel in the payload so the card reads in the reader's
      -- language; body stays English for push-dispatch, like the other rows.
      insert into public.notifications (user_id, category, title, body, payload)
      values (p_user, 'badge_earned', 'Achievement unlocked', v_name,
              jsonb_build_object('badge_slug', v_slug, 'profile_id', p_user,
                                 'name_en', v_name, 'name_ro', v_name_ro));
    end if;
    return next v_slug;
  end loop;
end;
$$;
revoke execute on function public.award_badges_for(uuid, boolean) from public, anon, authenticated;

/**
 * Trigger wrapper. A badge is a nicety; finishing a workout is not — so any
 * failure in the award path is logged and swallowed rather than rolling back
 * the write that triggered it.
 */
create or replace function public.award_badges_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    perform public.award_badges_for(new.user_id, true);
  exception when others then
    raise warning 'award_badges_for(%) failed: %', new.user_id, sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists logged_sessions_award_badges on public.logged_sessions;
create trigger logged_sessions_award_badges
  after insert or update of completed_at on public.logged_sessions
  for each row when (new.completed_at is not null)
  execute function public.award_badges_trigger();

drop trigger if exists check_ins_award_badges on public.check_ins;
create trigger check_ins_award_badges after insert on public.check_ins
  for each row execute function public.award_badges_trigger();

drop trigger if exists challenge_participants_award_badges on public.challenge_participants;
create trigger challenge_participants_award_badges
  after update of completed_at on public.challenge_participants
  for each row when (new.completed_at is not null and old.completed_at is null)
  execute function public.award_badges_trigger();

-- Food is logged many times a day; once the week badge exists this trigger has
-- nothing left to decide, so it stops early rather than recounting.
create or replace function public.food_logs_award_badges()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.user_badges ub join public.badges b on b.id = ub.badge_id
             where ub.user_id = new.user_id and b.slug = 'nutrition-week') then
    return new;
  end if;
  begin
    perform public.award_badges_for(new.user_id, true);
  exception when others then
    raise warning 'award_badges_for(%) failed: %', new.user_id, sqlerrm;
  end;
  return new;
end;
$$;
drop trigger if exists food_logs_award_badges on public.food_logs;
create trigger food_logs_award_badges after insert on public.food_logs
  for each row execute function public.food_logs_award_badges();

/**
 * A person's badges, for their profile. Empty unless the caller may see their
 * stats. `shared` says whether the owner already posted it — answered only to
 * the owner, since it is about their own feed.
 */
create or replace function public.social_badges(p_user uuid)
returns table (slug text, name_en text, name_ro text, icon text, awarded_at timestamptz, shared boolean)
language sql stable security definer set search_path = public as $$
  select b.slug, b.name_en, b.name_ro, b.icon, ub.awarded_at,
    (p_user = auth.uid() and exists (
      select 1 from public.social_posts p
      where p.user_id = p_user and p.type = 'achievement' and p.deleted_at is null
        and p.payload ->> 'badge_slug' = b.slug))
  from public.user_badges ub
  join public.badges b on b.id = ub.badge_id
  where ub.user_id = p_user
    and public.can_see_stats(p_user)
  order by ub.awarded_at desc, b.sort;
$$;
grant execute on function public.social_badges(uuid) to authenticated;

-- ---------- 3. two new post types ----------
alter table public.social_posts drop constraint if exists social_posts_type_check;
alter table public.social_posts add constraint social_posts_type_check
  check (type in ('workout', 'pr', 'challenge_completed', 'progress', 'text', 'streak', 'program',
                  'achievement', 'fitness_score'));

-- Once per badge, once per Fitness Score milestone.
create unique index if not exists social_posts_one_per_badge
  on public.social_posts (user_id, (payload ->> 'badge_slug'))
  where type = 'achievement' and deleted_at is null;
create unique index if not exists social_posts_one_per_score_milestone
  on public.social_posts (user_id, (payload ->> 'milestone'))
  where type = 'fitness_score' and deleted_at is null;

/**
 * What a new post may carry, checked where no client can skip it.
 *
 *   · a data post's payload.kind matches its type — a 'pr' post cannot carry
 *     a workout tile, a 'text' post carries no payload at all;
 *   · an achievement is rebuilt from the catalog and the award row, and
 *     refused outright if the author has not earned it;
 *   · a Fitness Score post is a whole number 0..100, with a milestone at or
 *     under it from the fixed list.
 */
create or replace function public.social_posts_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_badge record;
  v_score int;
  v_milestone int;
begin
  if new.type = 'text' then
    new.payload := null;
    return new;
  end if;
  if new.payload is not null and new.payload ->> 'kind' is distinct from new.type then
    raise exception 'payload kind does not match post type' using errcode = '22023';
  end if;

  if new.type = 'achievement' then
    select b.slug, b.name_en, b.name_ro, b.icon, ub.awarded_at into v_badge
    from public.user_badges ub join public.badges b on b.id = ub.badge_id
    where ub.user_id = new.user_id and b.slug = new.payload ->> 'badge_slug';
    if not found then
      raise exception 'badge not earned' using errcode = '42501';
    end if;
    new.payload := jsonb_build_object(
      'kind', 'achievement', 'badge_slug', v_badge.slug, 'name_en', v_badge.name_en,
      'name_ro', v_badge.name_ro, 'icon', v_badge.icon, 'awarded_at', v_badge.awarded_at);
  elsif new.type = 'fitness_score' then
    begin
      v_score := (new.payload ->> 'score')::int;
      v_milestone := (new.payload ->> 'milestone')::int;
    exception when others then
      raise exception 'fitness score payload is malformed' using errcode = '22023';
    end;
    if v_score is null or v_score < 0 or v_score > 100
       or v_milestone is null or v_milestone not in (25, 50, 60, 70, 80, 90, 100)
       or v_milestone > v_score then
      raise exception 'fitness score payload is out of range' using errcode = '22023';
    end if;
    -- Only the three known keys cross into the feed.
    new.payload := jsonb_build_object(
      'kind', 'fitness_score', 'score', v_score, 'milestone', v_milestone,
      'band', coalesce(new.payload ->> 'band', null));
  end if;
  return new;
end;
$$;
drop trigger if exists social_posts_guard on public.social_posts;
create trigger social_posts_guard before insert on public.social_posts
  for each row execute function public.social_posts_guard();

-- ---------- 4. snapshots are immutable ----------
-- The owner may re-caption, change who sees it, or delete it. Nothing else:
-- the payload is what was published, and an update policy alone cannot say
-- which columns. The policy still says whose row.
revoke update on table public.social_posts from authenticated;
grant update (text, visibility, deleted_at) on table public.social_posts to authenticated;

alter table public.social_comments add column if not exists edited_at timestamptz;
comment on column public.social_comments.edited_at is
  'Set when the author changes the body after posting; null for an untouched comment.';

revoke update on table public.social_comments from authenticated;
grant update (body) on table public.social_comments to authenticated;

create or replace function public.social_comments_mark_edited()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.body is distinct from old.body then
    new.edited_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists social_comments_edited on public.social_comments;
create trigger social_comments_edited before update on public.social_comments
  for each row execute function public.social_comments_mark_edited();

-- Editing is only for a post you can still see: unfollowing a followers-only
-- author ends your ability to change what you wrote there, as it ends reading it.
drop policy if exists comments_update on public.social_comments;
create policy comments_update on public.social_comments for update to authenticated
  using (user_id = auth.uid() and public.can_see_post(post_id))
  with check (user_id = auth.uid() and public.can_see_post(post_id));

-- ---------- 5. mentions in post captions ----------
create table if not exists public.social_post_mentions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.social_posts (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (post_id, user_id)
);
create index if not exists social_post_mentions_user_idx
  on public.social_post_mentions (user_id, created_at desc);
alter table public.social_post_mentions enable row level security;

grant select, insert, delete on table public.social_post_mentions to authenticated;
grant select, insert, delete on table public.social_post_mentions to service_role;

drop policy if exists post_mentions_select on public.social_post_mentions;
create policy post_mentions_select on public.social_post_mentions for select to authenticated
  using (public.can_see_post(post_id));

drop policy if exists post_mentions_insert on public.social_post_mentions;
create policy post_mentions_insert on public.social_post_mentions for insert to authenticated
  with check (exists (select 1 from public.social_posts p
                      where p.id = post_id and p.user_id = auth.uid() and p.deleted_at is null));

drop policy if exists post_mentions_delete on public.social_post_mentions;
create policy post_mentions_delete on public.social_post_mentions for delete to authenticated
  using (exists (select 1 from public.social_posts p where p.id = post_id and p.user_id = auth.uid()));

/**
 * Can a given person (not the caller) see a post? The rule of can_see_post(),
 * asked on somebody else's behalf — for deciding whether a mention may notify
 * them. Never granted: answering it for arbitrary pairs would expose who
 * follows whom through a side door.
 */
create or replace function public.user_can_see_post(p_user uuid, p_post uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.social_posts p
    where p.id = p_post
      and p.deleted_at is null
      and (
        p.user_id = p_user
        or p.visibility = 'public'
        or (p.visibility = 'followers'
            and (exists (select 1 from public.social_follows f
                         where f.follower_id = p_user and f.following_id = p.user_id)
                 or exists (select 1 from public.trainer_clients tc
                            where tc.coach_id = p_user and tc.client_id = p.user_id
                              and tc.status = 'active')))
      )
  );
$$;
revoke execute on function public.user_can_see_post(uuid, uuid) from public, anon, authenticated;

/** "Maria mentioned you in a post" — never yourself, never unseeable, never twice. */
create or replace function public.notify_post_mention()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_post public.social_posts;
  v_actor text;
begin
  select * into v_post from public.social_posts where id = new.post_id;
  if not found or v_post.user_id = new.user_id then
    return new;
  end if;
  if not public.user_can_see_post(new.user_id, new.post_id) then
    return new;
  end if;
  if exists (
    select 1 from public.notifications n
    where n.user_id = new.user_id and n.category = 'new_mention'
      and n.payload ->> 'post_id' = new.post_id::text
      and not (n.payload ? 'comment_id')
  ) then
    return new;
  end if;
  select coalesce(u.username, u.full_name) into v_actor from public.users u where u.id = v_post.user_id;
  insert into public.notifications (user_id, category, title, body, payload)
  values (new.user_id, 'new_mention', v_actor, left(coalesce(v_post.text, ''), 140),
          jsonb_build_object('post_id', v_post.id, 'actor_id', v_post.user_id));
  return new;
end;
$$;
drop trigger if exists social_post_mentions_notify on public.social_post_mentions;
create trigger social_post_mentions_notify after insert on public.social_post_mentions
  for each row execute function public.notify_post_mention();

-- ---------- the feed and one post, now carrying caption mentions ----------
-- Same select as 20260930110000 plus one column; the return shape changes, so
-- both are dropped and recreated. The coach branch from 20260921100000 stays.
drop function if exists public.social_feed(int, timestamptz, uuid, text, text);
create function public.social_feed(
  p_limit int default 20,
  p_before timestamptz default null,
  p_author uuid default null,
  p_scope text default 'following',
  p_type text default null
)
returns table (
  id uuid, user_id uuid, author_name text, author_username text, author_avatar text,
  type text, text text, payload jsonb, visibility text, created_at timestamptz,
  activity_id uuid, challenge_id uuid,
  kudos_count int, comment_count int, my_kudos boolean, kudos_names text[], mentions jsonb
) language sql stable security definer set search_path = public as $$
  select
    p.id, p.user_id,
    coalesce(u.username, u.full_name) as author_name, u.username, u.avatar_url,
    p.type, p.text, p.payload, p.visibility, p.created_at,
    p.activity_id, p.challenge_id,
    (select count(*)::int from public.social_reactions r where r.post_id = p.id),
    (select count(*)::int from public.social_comments c where c.post_id = p.id),
    exists (select 1 from public.social_reactions r where r.post_id = p.id and r.user_id = auth.uid()),
    coalesce((select array_agg(x.name order by x.created_at, x.id) from (
      select coalesce(ru.username, ru.full_name) as name, r.created_at, r.id
      from public.social_reactions r join public.users ru on ru.id = r.user_id
      where r.post_id = p.id order by r.created_at, r.id limit 2
    ) x), '{}'),
    coalesce((
      select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'username', mu.username))
      from public.social_post_mentions m join public.users mu on mu.id = m.user_id
      where m.post_id = p.id
    ), '[]'::jsonb)
  from public.social_posts p
  join public.users u on u.id = p.user_id
  where p.deleted_at is null
    and (p_before is null or p.created_at < p_before)
    and (p_type is null or p.type = p_type)
    and (
      case
        when p_author is not null then p.user_id = p_author
        when coalesce(p_scope, 'following') = 'mine' then p.user_id = auth.uid()
        when coalesce(p_scope, 'following') = 'all' then true
        else (p.user_id = auth.uid() or public.is_following(p.user_id))
      end
    )
    and (
      p.user_id = auth.uid()
      or p.visibility = 'public'
      or (p.visibility = 'followers'
          and (public.is_following(p.user_id) or public.is_active_coach_of(p.user_id)))
    )
  order by p.created_at desc, p.id desc
  limit greatest(1, least(p_limit, 50));
$$;
grant execute on function public.social_feed(int, timestamptz, uuid, text, text) to authenticated;

drop function if exists public.social_post(uuid);
create function public.social_post(p_post uuid)
returns table (
  id uuid, user_id uuid, author_name text, author_username text, author_avatar text,
  type text, text text, payload jsonb, visibility text, created_at timestamptz,
  activity_id uuid, challenge_id uuid,
  kudos_count int, comment_count int, my_kudos boolean, kudos_names text[], mentions jsonb
) language sql stable security definer set search_path = public as $$
  select
    p.id, p.user_id,
    coalesce(u.username, u.full_name), u.username, u.avatar_url,
    p.type, p.text, p.payload, p.visibility, p.created_at,
    p.activity_id, p.challenge_id,
    (select count(*)::int from public.social_reactions r where r.post_id = p.id),
    (select count(*)::int from public.social_comments c where c.post_id = p.id),
    exists (select 1 from public.social_reactions r where r.post_id = p.id and r.user_id = auth.uid()),
    coalesce((select array_agg(x.name order by x.created_at, x.id) from (
      select coalesce(ru.username, ru.full_name) as name, r.created_at, r.id
      from public.social_reactions r join public.users ru on ru.id = r.user_id
      where r.post_id = p.id order by r.created_at, r.id limit 2
    ) x), '{}'),
    coalesce((
      select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'username', mu.username))
      from public.social_post_mentions m join public.users mu on mu.id = m.user_id
      where m.post_id = p.id
    ), '[]'::jsonb)
  from public.social_posts p
  join public.users u on u.id = p.user_id
  where p.id = p_post and p.deleted_at is null and public.can_see_post(p.id);
$$;
grant execute on function public.social_post(uuid) to authenticated;

-- ---------- 6. comments: edited_at, and replies paged ----------
-- A thread carries its first REPLY_PREVIEW (3) replies, oldest first, and a
-- reply_count saying how many there are; social_comment_replies() pages the rest.
drop function if exists public.social_post_comments(uuid, int, timestamptz);
create function public.social_post_comments(
  p_post uuid,
  p_limit int default 20,
  p_before timestamptz default null
)
returns table (
  id uuid, parent_id uuid, user_id uuid, author_name text, author_username text,
  author_avatar text, body text, created_at timestamptz, edited_at timestamptz,
  mentions jsonb, reply_count int
) language sql stable security definer set search_path = public as $$
  with visible as (
    select 1 where public.can_see_post(p_post)
  ),
  roots as (
    select c.*
    from public.social_comments c, visible
    where c.post_id = p_post and c.parent_id is null
      and (p_before is null or c.created_at < p_before)
    order by c.created_at desc, c.id desc
    limit greatest(1, least(coalesce(p_limit, 20), 50))
  ),
  threads as (
    select r.* from roots r
    union all
    select rep.* from roots r
    cross join lateral (
      select c.* from public.social_comments c
      where c.parent_id = r.id
      order by c.created_at, c.id
      limit 3
    ) rep
  )
  select
    t.id, t.parent_id, t.user_id,
    coalesce(u.username, u.full_name), u.username, u.avatar_url,
    t.body, t.created_at, t.edited_at,
    coalesce((
      select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'username', mu.username))
      from public.social_comment_mentions m
      join public.users mu on mu.id = m.user_id
      where m.comment_id = t.id
    ), '[]'::jsonb),
    (select count(*)::int from public.social_comments rc where rc.parent_id = t.id)
  from threads t
  join public.users u on u.id = t.user_id
  order by coalesce(t.parent_id, t.id), (t.parent_id is not null), t.created_at;
$$;
grant execute on function public.social_post_comments(uuid, int, timestamptz) to authenticated;

/** More replies to one comment, oldest first, after a cursor. Nothing for an unseeable post. */
create or replace function public.social_comment_replies(
  p_parent uuid,
  p_after timestamptz default null,
  p_limit int default 20
)
returns table (
  id uuid, parent_id uuid, user_id uuid, author_name text, author_username text,
  author_avatar text, body text, created_at timestamptz, edited_at timestamptz,
  mentions jsonb, reply_count int
) language sql stable security definer set search_path = public as $$
  select
    c.id, c.parent_id, c.user_id,
    coalesce(u.username, u.full_name), u.username, u.avatar_url,
    c.body, c.created_at, c.edited_at,
    coalesce((
      select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'username', mu.username))
      from public.social_comment_mentions m join public.users mu on mu.id = m.user_id
      where m.comment_id = c.id
    ), '[]'::jsonb),
    0
  from public.social_comments c
  join public.social_comments parent on parent.id = c.parent_id
  join public.users u on u.id = c.user_id
  where c.parent_id = p_parent
    and public.can_see_post(parent.post_id)
    and (p_after is null or c.created_at > p_after)
  order by c.created_at, c.id
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;
grant execute on function public.social_comment_replies(uuid, timestamptz, int) to authenticated;

-- ---------- the profile, behind the settings ----------
-- Follow counts stay visible to everyone (they are the social graph, which
-- social_follow_list already exposes). Activity numbers, the streak and the
-- badge count are null unless can_see_stats(); the Fitness Score is null
-- unless can_see_fitness_score(). The two settings themselves come back only
-- to their owner.
drop function if exists public.social_profile(uuid);
create function public.social_profile(p_user uuid)
returns table (
  id uuid, name text, username text, avatar_url text, city text, bio text,
  followers int, following int, posts int,
  stats_visible boolean,
  workouts int, prs int, challenges int, streak_days int, longest_streak int, badges int,
  fitness_score int, fitness_score_at timestamptz,
  is_following boolean, follows_me boolean,
  stats_visibility text, fitness_score_visibility text
) language sql stable security definer set search_path = public as $$
  select
    u.id, coalesce(u.username, u.full_name), u.username, u.avatar_url, u.city, u.bio,
    (select count(*)::int from public.social_follows f where f.following_id = u.id),
    (select count(*)::int from public.social_follows f where f.follower_id = u.id),
    (select count(*)::int from public.social_posts p
      where p.user_id = u.id and p.deleted_at is null and public.can_see_post(p.id)),
    v.ok,
    case when v.ok then (select count(*)::int from public.logged_sessions s where s.user_id = u.id and s.completed_at is not null) end,
    case when v.ok then (select count(*)::int from public.logged_sets ls where ls.user_id = u.id and ls.is_pr) end,
    case when v.ok then (select count(*)::int from public.challenge_participants cp where cp.user_id = u.id and cp.completed_at is not null) end,
    case when v.ok then st.current_days end,
    case when v.ok then st.longest_days end,
    case when v.ok then (select count(*)::int from public.user_badges ub where ub.user_id = u.id) end,
    case when public.can_see_fitness_score(u.id) then u.fitness_score_public::int end,
    case when public.can_see_fitness_score(u.id) then u.fitness_score_public_at end,
    public.is_following(u.id),
    exists (select 1 from public.social_follows f where f.follower_id = u.id and f.following_id = auth.uid()),
    case when u.id = auth.uid() then u.stats_visibility end,
    case when u.id = auth.uid() then u.fitness_score_visibility end
  from public.users u
  cross join lateral (select public.can_see_stats(u.id) as ok) v
  left join lateral public.social_streak(u.id) st on true
  where u.id = p_user
    and auth.uid() is not null;
$$;
grant execute on function public.social_profile(uuid) to authenticated;

/** A person's published programs, newest first — exactly what Discover would show of them. */
create or replace function public.social_profile_programs(p_user uuid, p_limit int default 6)
returns table (id uuid) language sql stable security definer set search_path = public as $$
  select p.id from public.programs p
  where coalesce(p.coach_id, p.client_id) = p_user
    and p.coach_id is null
    and p.visibility <> 'private'
    and public.can_see_program(p.id)
    and exists (select 1 from public.program_days d where d.program_id = p.id)
  order by p.updated_at desc
  limit greatest(1, least(coalesce(p_limit, 6), 20));
$$;
-- Only ids are needed by the app, which then asks program_card_rows for the
-- cards — the same shape Discover renders.
grant execute on function public.social_profile_programs(uuid, int) to authenticated;

-- ---------- 7. people: paged search, suggestions with a fallback ----------
drop function if exists public.social_search_users(text, text);
create function public.social_search_users(
  p_query text,
  p_city text default null,
  p_limit int default 20,
  p_offset int default 0
)
returns table (id uuid, name text, username text, avatar_url text, city text, is_following boolean)
language sql stable security definer set search_path = public as $$
  select u.id, coalesce(u.username, u.full_name), u.username, u.avatar_url, u.city,
         public.is_following(u.id)
  from public.users u
  where auth.uid() is not null
    and u.id <> auth.uid()
    -- someone who asked to be deleted is already anonymised; they are not findable
    and not exists (select 1 from public.account_deletion_requests d where d.user_id = u.id)
    and u.suspended_at is null
    and (
      char_length(btrim(coalesce(p_query, ''))) >= 2
      or char_length(btrim(coalesce(p_city, ''))) >= 2
    )
    and (char_length(btrim(coalesce(p_query, ''))) < 2
         or u.username ilike '%' || btrim(p_query) || '%'
         or u.full_name ilike '%' || btrim(p_query) || '%')
    and (p_city is null or u.city ilike '%' || btrim(p_city) || '%')
  order by (u.username ilike btrim(coalesce(p_query, '')) || '%') desc, u.username nulls last, u.id
  limit greatest(1, least(coalesce(p_limit, 20), 50))
  offset greatest(0, least(coalesce(p_offset, 0), 1000));
$$;
grant execute on function public.social_search_users(text, text, int, int) to authenticated;

-- Friends of friends first (counted), then — so a new account is not shown an
-- empty page — the most-followed people. Both are counts over follow edges,
-- which are public; nothing about anyone's training, food or body goes in.
drop function if exists public.social_suggested_people(int);
create function public.social_suggested_people(p_limit int default 10)
returns table (id uuid, name text, username text, avatar_url text, is_following boolean, mutuals int, followers int)
language sql stable security definer set search_path = public as $$
  with fof as (
    select f2.following_id as id, count(*)::int as mutuals
    from public.social_follows f1
    join public.social_follows f2 on f2.follower_id = f1.following_id
    where f1.follower_id = auth.uid()
      and f2.following_id <> auth.uid()
    group by f2.following_id
  ),
  popular as (
    select f.following_id as id, count(*)::int as followers
    from public.social_follows f
    where f.following_id <> auth.uid()
    group by f.following_id
    order by count(*) desc
    limit 50
  ),
  candidates as (
    select coalesce(a.id, b.id) as id, coalesce(a.mutuals, 0) as mutuals, coalesce(b.followers, 0) as followers
    from fof a full join popular b on a.id = b.id
  )
  select u.id, coalesce(u.username, u.full_name), u.username, u.avatar_url, false, c.mutuals,
         (select count(*)::int from public.social_follows f where f.following_id = u.id)
  from candidates c
  join public.users u on u.id = c.id
  where auth.uid() is not null
    and u.username is not null
    and u.suspended_at is null
    and not exists (select 1 from public.account_deletion_requests d where d.user_id = u.id)
    and not exists (select 1 from public.social_follows mine
                    where mine.follower_id = auth.uid() and mine.following_id = u.id)
  order by c.mutuals desc, c.followers desc, u.username
  limit greatest(1, least(coalesce(p_limit, 10), 20));
$$;
grant execute on function public.social_suggested_people(int) to authenticated;

-- ---------- backfill ----------
-- Award everything already earned, silently: a wall of "achievement unlocked"
-- for history that happened weeks ago would be noise, not news.
select public.award_badges_for(u.id, false) from public.users u;
