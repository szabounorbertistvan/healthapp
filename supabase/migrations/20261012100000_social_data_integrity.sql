-- Social 2.0 · Data integrity: the server builds what the feed shows
--
-- 1. SNAPSHOTS. A workout, PR, challenge or streak post carried whatever
--    numbers the client put in its payload; social_posts_guard only checked
--    that the payload's kind matched the post type. The server action built
--    honest payloads, but a hand-made PostgREST insert could post "500 kg ×
--    20" or a 365-day streak. The guard now rebuilds each of them from the
--    database at the moment of posting, and keeps only identifiers from the
--    client:
--      workout             activity_id (your completed session); the photo
--                          URL survives only if it is a Cloudinary upload in
--                          your own folder (the server action mints it)
--      pr                  activity_id + payload.set_id (a set of yours in
--                          that session that the PR engine flagged)
--      challenge_completed challenge_id (a challenge you completed)
--      streak              payload.milestone + payload.streak_start (a run of
--                          your own workout days that really started that day
--                          and really reached that milestone)
--    The numbers are computed exactly as the app computes them (the
--    training-load formula shared with the leaderboards, the Epley 1RM capped
--    at 12 reps, the local-day streak rule). Anything that is not yours, not
--    there, or not reached is refused with the guard's existing P0002 — one
--    answer for missing and forbidden alike. Only inserts are checked, so
--    every post already published is left exactly as it is.
--
-- 2. MENTIONS. A mention row was accepted for any user the author named by
--    id, whether or not "@handle" was in the text. Now a mention row is kept
--    only if the person's username is one of the handles the text actually
--    contains — parsed here with the same rule as extractMentionHandles()
--    (packages/shared/src/mentions.ts: the username format, the character
--    that may precede "@", lower-cased, the first ten) — and only if they may
--    appear to the author (not suspended, not being deleted, no block either
--    way) and may see the post. Anything else is dropped silently before it
--    is stored, so a fabricated mention never exists and never notifies.
--
-- 3. SUSPENDED / DELETING AUTHORS.
--    · can_see_post / user_can_see_post: a post by an account that is
--      suspended or being deleted is invisible to everyone but its author —
--      through every RPC and policy that asks them (comments, Kudos, saves,
--      shares, mentions, the post page).
--    · social_post_comments / social_comment_replies: a comment by such an
--      account leaves the thread, as it already left the preview. The
--      comment count is unchanged.
--
-- 4. PROGRAMS. program_card_rows (the card behind Discover, a profile's
--    programs and your library) and discover_programs name a program's
--    author; neither applied blocks. Both now leave out a program whose
--    author is behind a block either way — except your own programs and
--    one assigned to you by your coach, so a block never takes coaching away.
--    Anon loses EXECUTE on both, like every other social read.
--
-- Checked and left unchanged: no social surface names a challenge's creator
-- (challenge_cards returns only is_mine / is_platform), so there was nothing
-- to hide there. Mute is untouched.
--
-- Every function body below is its latest definition, found by searching all
-- earlier migrations, with only the change named here.

-- ---------- helpers (internal: no EXECUTE for anyone signed in) ----------

-- extractMentionHandles() in SQL: distinct lower-cased handles in order of
-- first appearance, at most ten.
create or replace function public.social_mention_handles(p_text text)
returns text[] language sql immutable set search_path = public as $$
  select coalesce(array_agg(h order by first_at), '{}')
  from (
    select lower(m[2]) as h, min(n) as first_at
    from regexp_matches(coalesce(p_text, ''), '(^|[^A-Za-z0-9_.@])@([A-Za-z0-9][A-Za-z0-9_.]{2,23})', 'g')
         with ordinality as r(m, n)
    group by lower(m[2])
    order by min(n)
    limit 10
  ) x;
$$;
revoke execute on function public.social_mention_handles(text) from public, anon, authenticated;

-- A mention row is real only if the text names the person and the person may
-- be named here. Returning null drops the row before it exists.
create or replace function public.social_post_mention_check()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_post public.social_posts;
  v_handle text;
begin
  select * into v_post from public.social_posts where id = new.post_id;
  -- Not the author inserting: post_mentions_insert (RLS) refuses it, with its
  -- own error — this check is only about what an author may claim.
  if v_post.user_id is distinct from auth.uid() then
    return new;
  end if;
  select lower(u.username) into v_handle from public.users u where u.id = new.user_id;
  if v_handle is null
     or not (v_handle = any (public.social_mention_handles(v_post.text)))
     or not public.is_listed_user(new.user_id)
     or not public.user_can_see_post(new.user_id, new.post_id) then
    return null;
  end if;
  return new;
end;
$$;
revoke execute on function public.social_post_mention_check() from public, anon, authenticated;
drop trigger if exists social_post_mentions_check on public.social_post_mentions;
create trigger social_post_mentions_check before insert on public.social_post_mentions
  for each row execute function public.social_post_mention_check();

create or replace function public.social_comment_mention_check()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_comment public.social_comments;
  v_handle text;
begin
  select * into v_comment from public.social_comments where id = new.comment_id;
  -- Not the comment's author inserting: comment_mentions_insert (RLS) refuses it.
  if v_comment.user_id is distinct from auth.uid() then
    return new;
  end if;
  select lower(u.username) into v_handle from public.users u where u.id = new.user_id;
  if v_handle is null
     or not (v_handle = any (public.social_mention_handles(v_comment.body)))
     or not public.is_listed_user(new.user_id)
     or not public.user_can_see_post(new.user_id, v_comment.post_id) then
    return null;
  end if;
  return new;
end;
$$;
revoke execute on function public.social_comment_mention_check() from public, anon, authenticated;
drop trigger if exists social_comment_mentions_check on public.social_comment_mentions;
create trigger social_comment_mentions_check before insert on public.social_comment_mentions
  for each row execute function public.social_comment_mention_check();

-- ---------- 1. the snapshots (social_posts_guard, from 20261005100000) ----------
create or replace function public.social_posts_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_badge record;
  v_real record;
  v_milestone int;
  v_original uuid;
  v_orig public.social_posts;
  v_session public.logged_sessions;
  v_set public.logged_sets;
  v_challenge public.challenges;
  v_name text;
  v_sets int;
  v_volume numeric;
  v_rpe numeric;
  v_exercises int;
  v_prs int;
  v_duration int;
  v_photo text;
  v_started timestamptz;
  v_start date;
  v_tz text;
begin
  if new.type = 'text' then
    new.payload := null;
    return new;
  end if;
  if new.payload is not null and new.payload ->> 'kind' is distinct from new.type then
    raise exception 'payload kind does not match post type' using errcode = '22023';
  end if;

  if new.type = 'achievement' then
    select b.slug, b.name_en, b.name_ro, b.icon, b.category, b.rarity, b.metric, b.target, ub.awarded_at
      into v_badge
    from public.user_badges ub join public.badges b on b.id = ub.badge_id
    where ub.user_id = new.user_id and b.slug = new.payload ->> 'badge_slug';
    if not found then
      raise exception 'badge not earned' using errcode = '42501';
    end if;
    new.payload := jsonb_build_object(
      'kind', 'achievement', 'badge_slug', v_badge.slug, 'name_en', v_badge.name_en,
      'name_ro', v_badge.name_ro, 'icon', v_badge.icon, 'awarded_at', v_badge.awarded_at,
      'category', v_badge.category, 'rarity', v_badge.rarity,
      'metric', v_badge.metric, 'target', v_badge.target);
  elsif new.type = 'fitness_score' then
    select f.score, f.band into v_real from public.fitness_score_of(new.user_id) f;
    if v_real.score is null then
      raise exception 'fitness score is still building' using errcode = '22023';
    end if;
    select max(m) into v_milestone
    from unnest(array[25, 50, 60, 70, 80, 90, 100]) m
    where m <= v_real.score;
    if v_milestone is null then
      raise exception 'fitness score is below the first milestone' using errcode = '22023';
    end if;
    new.payload := jsonb_build_object(
      'kind', 'fitness_score', 'score', v_real.score, 'milestone', v_milestone, 'band', v_real.band);
  elsif new.type = 'shared_post' then
    begin
      v_original := (new.payload ->> 'original_post_id')::uuid;
    exception when invalid_text_representation then
      v_original := null;
    end;
    select * into v_orig from public.social_posts where id = v_original;
    -- A share of a share is a share of the original.
    if found and v_orig.type = 'shared_post' then
      v_original := (v_orig.payload ->> 'original_post_id')::uuid;
      select * into v_orig from public.social_posts where id = v_original;
    end if;
    -- One answer for missing, deleted, private and unfollowed alike, so the
    -- error cannot be used to learn that a hidden post exists.
    if v_orig.id is null
       or not public.user_can_see_post(new.user_id, v_orig.id)
       or not public.is_listed_user(v_orig.user_id) then
      raise exception 'post not found' using errcode = 'P0002';
    end if;
    if v_orig.user_id = new.user_id then
      raise exception 'cannot share your own post' using errcode = '22023';
    end if;
    new.payload := jsonb_build_object('kind', 'shared_post', 'original_post_id', v_orig.id);
  elsif new.type = 'workout' then
    -- Your own completed session, rebuilt with the rollup the leaderboards use.
    select * into v_session from public.logged_sessions s
    where s.id = new.activity_id and s.user_id = new.user_id and s.completed_at is not null;
    if v_session.id is null then
      raise exception 'post not found' using errcode = 'P0002';
    end if;
    select coalesce((select d.name from public.program_days d where d.id = v_session.program_day_id), 'Workout')
      into v_name;
    select
      count(ls.id) filter (where ls.reps > 0)::int,
      coalesce(sum(greatest(ls.weight_kg, 0) * ls.reps) filter (where ls.reps > 0), 0),
      avg(public.effective_rpe(ls.rpe, ls.rir)) filter (where ls.reps > 0),
      count(distinct ls.exercise_id) filter (where ls.reps > 0)::int,
      count(*) filter (where ls.is_pr)::int
      into v_sets, v_volume, v_rpe, v_exercises, v_prs
    from public.logged_sets ls where ls.session_id = v_session.id;
    v_duration := nullif(round(extract(epoch from (v_session.completed_at - v_session.started_at)) / 60)::int, 0);
    -- The photo is the one thing the server action supplies: kept only as a
    -- Cloudinary upload in this author's own folder.
    v_photo := new.payload ->> 'photo_url';
    if v_photo is null
       or v_photo !~ ('^https://res\.cloudinary\.com/[^/?#]+/image/upload/([^?#]*/)?voinic/posts/'
                      || new.user_id::text || '/[^/?#]+$') then
      v_photo := null;
    end if;
    new.payload := jsonb_build_object(
      'kind', 'workout',
      'name', v_name,
      'date', to_char(v_session.started_at at time zone 'UTC', 'YYYY-MM-DD'),
      'duration_min', v_duration,
      'exercises', v_exercises,
      'sets', v_sets,
      'volume_kg', round(v_volume)::float8,
      'load', least(100, greatest(0, public.training_load_score(
                v_volume::double precision, v_sets, v_duration, v_rpe::double precision, v_exercises))),
      'prs', v_prs,
      'photo_url', v_photo);
  elsif new.type = 'pr' then
    -- A set of yours, in the named session, that the PR engine flagged.
    select ls.* into v_set from public.logged_sets ls
    join public.logged_sessions s on s.id = ls.session_id
    where ls.id = public.social_try_uuid(new.payload ->> 'set_id')
      and ls.user_id = new.user_id and ls.is_pr
      and s.id = new.activity_id and s.user_id = new.user_id and s.completed_at is not null;
    if v_set.id is null then
      raise exception 'post not found' using errcode = 'P0002';
    end if;
    select s.started_at into v_started from public.logged_sessions s where s.id = v_set.session_id;
    new.payload := jsonb_build_object(
      'kind', 'pr',
      'exercise', coalesce((select coalesce(x.name_ro, x.name_en) from public.exercises x where x.id = v_set.exercise_id), '—'),
      -- float8: plain JSON numbers (100, 116.7), the shape the app always wrote
      'weight_kg', v_set.weight_kg::float8,
      'reps', v_set.reps,
      -- estimated1RMExact (Epley), only up to 12 reps, to one decimal; 0 outside that.
      'estimated_1rm', case
        when v_set.weight_kg > 0 and v_set.reps between 1 and 12 then
          (round((case when v_set.reps = 1 then v_set.weight_kg
                       else v_set.weight_kg * (1 + v_set.reps / 30.0) end) * 10) / 10)::float8
        else 0 end,
      'date', to_char(v_started at time zone 'UTC', 'YYYY-MM-DD'));
  elsif new.type = 'challenge_completed' then
    -- A challenge you completed; its titles and numbers from the challenge itself.
    select c.* into v_challenge from public.challenges c
    where c.id = new.challenge_id
      and exists (select 1 from public.challenge_participants p
                  where p.challenge_id = c.id and p.user_id = new.user_id and p.completed_at is not null);
    if v_challenge.id is null then
      raise exception 'post not found' using errcode = 'P0002';
    end if;
    new.payload := jsonb_build_object(
      'kind', 'challenge_completed',
      'title_en', v_challenge.title_en,
      'title_ro', v_challenge.title_ro,
      'type', v_challenge.type,
      'target', v_challenge.target_value::float8,
      'value', public.challenge_value(v_challenge.id, new.user_id)::float8);
  elsif new.type = 'streak' then
    -- A run of your own workout days (local days, users.timezone — the
    -- workout_days rule) that started on streak_start and reached the
    -- milestone. Shareable milestones: STREAK_MILESTONES from STREAK_SHARE_MIN.
    begin
      v_milestone := (new.payload ->> 'milestone')::int;
      v_start := (new.payload ->> 'streak_start')::date;
    exception when others then
      v_milestone := null;
    end;
    select coalesce(u.timezone, 'Europe/Bucharest') into v_tz from public.users u where u.id = new.user_id;
    if v_milestone is null or v_start is null
       or v_milestone not in (7, 14, 30, 60, 90, 180, 365)
       or exists (select 1 from public.logged_sessions s
                  where s.user_id = new.user_id and s.completed_at is not null
                    and (s.started_at at time zone v_tz)::date = v_start - 1)
       or (select count(distinct (s.started_at at time zone v_tz)::date) from public.logged_sessions s
           where s.user_id = new.user_id and s.completed_at is not null
             and (s.started_at at time zone v_tz)::date between v_start and v_start + (v_milestone - 1)) < v_milestone then
      raise exception 'post not found' using errcode = 'P0002';
    end if;
    new.payload := jsonb_build_object(
      'kind', 'streak',
      'streak_days', v_milestone,
      'milestone', v_milestone,
      'achieved_at', to_char(v_start + (v_milestone - 1), 'YYYY-MM-DD'),
      'streak_start', to_char(v_start, 'YYYY-MM-DD'),
      'title', v_milestone || ' Day Streak');
  end if;
  return new;
end;
$$;

-- ---------- 3. suspended / deleting authors ----------
-- can_see_post from 20261007100000, user_can_see_post from 20261007100000
create or replace function public.can_see_post(p_post uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.social_posts p
    where p.id = p_post
      and p.deleted_at is null
      and not public.social_blocked_between(auth.uid(), p.user_id)
      and (p.user_id = auth.uid()
           or (not exists (select 1 from public.users au where au.id = p.user_id and au.suspended_at is not null)
               and not exists (select 1 from public.account_deletion_requests ad where ad.user_id = p.user_id)))
      and (
        p.user_id = auth.uid()
        or p.visibility = 'public'
        or (
          p.visibility = 'followers'
          and (public.is_following(p.user_id) or public.is_active_coach_of(p.user_id))
        )
      )
  );
$$;

create or replace function public.user_can_see_post(p_user uuid, p_post uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.social_posts p
    where p.id = p_post
      and p.deleted_at is null
      and not public.social_blocked_between(p_user, p.user_id)
      and (p.user_id = p_user
           or (not exists (select 1 from public.users au where au.id = p.user_id and au.suspended_at is not null)
               and not exists (select 1 from public.account_deletion_requests ad where ad.user_id = p.user_id)))
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

-- social_post_comments from 20261007100000, social_comment_replies from 20261007100000
create or replace function public.social_post_comments(
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
      and not public.social_blocked_between(auth.uid(), c.user_id)
      and (c.user_id = auth.uid() or public.is_listed_user(c.user_id))
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
        and not public.social_blocked_between(auth.uid(), c.user_id)
        and (c.user_id = auth.uid() or public.is_listed_user(c.user_id))
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
    and not public.social_blocked_between(auth.uid(), c.user_id)
    and (c.user_id = auth.uid() or public.is_listed_user(c.user_id))
    and public.can_see_post(parent.post_id)
    and (p_after is null or c.created_at > p_after)
  order by c.created_at, c.id
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

-- ---------- 4. programs (from 20260930100000) ----------
create or replace function public.program_card_rows(p_ids uuid[])
returns table (
  id uuid, name text, description text, level text, goal text, visibility text,
  status text, coach_id uuid, client_id uuid, source_program_id uuid,
  author_id uuid, author_name text, author_username text, author_avatar text,
  days int, exercises int, total_sets int, est_minutes int,
  muscle_groups text[], equipment text[], copy_count int,
  weeks int, days_per_week int, session_minutes int, training_style text,
  featured boolean, source text,
  saved boolean, is_mine boolean, assigned_by_coach boolean,
  created_at timestamptz, updated_at timestamptz
) language sql stable security definer set search_path = public as $$
  select
    p.id, p.name, p.description, p.level, p.goal, p.visibility,
    p.status::text, p.coach_id, p.client_id, p.source_program_id,
    coalesce(p.coach_id, p.client_id) as author_id,
    coalesce(u.username, u.full_name) as author_name,
    u.username, u.avatar_url,
    coalesce(agg.days, 0) as days,
    coalesce(agg.exercises, 0) as exercises,
    coalesce(agg.total_sets, 0) as total_sets,
    -- A deterministic estimate: every set is 40 s of work plus its own rest
    -- (90 s when none is set). Mirrors estimateMinutes() in packages/shared.
    coalesce(agg.est_seconds, 0) / 60 as est_minutes,
    coalesce(agg.muscles, '{}') as muscle_groups,
    coalesce(agg.equipment, '{}') as equipment,
    p.copy_count,
    p.weeks,
    coalesce(wk.days, 0) as days_per_week,
    coalesce(sess.minutes, 0) as session_minutes,
    p.training_style,
    (p.featured_at is not null and p.visibility = 'public') as featured,
    -- Mirrors routineSource() in packages/shared/src/routines.ts.
    case when p.is_official then 'voinic'
         when p.coach_id is not null or u.role in ('coach', 'both') then 'coach'
         else 'user' end as source,
    exists (select 1 from public.program_saves s where s.program_id = p.id and s.user_id = auth.uid()) as saved,
    (coalesce(p.coach_id, p.client_id) = auth.uid()) as is_mine,
    (p.coach_id is not null and p.client_id = auth.uid()) as assigned_by_coach,
    p.created_at, p.updated_at
  from public.programs p
  join public.users u on u.id = coalesce(p.coach_id, p.client_id)
  left join lateral (
    select
      count(distinct d.id)::int as days,
      count(e.id)::int as exercises,
      coalesce(sum(e.target_sets), 0)::int as total_sets,
      coalesce(sum(e.target_sets * (40 + coalesce(e.rest_seconds, 90))), 0)::int as est_seconds,
      array_agg(distinct m) filter (where m is not null) as muscles,
      array_agg(distinct x.equipment) filter (where x.equipment is not null) as equipment
    from public.program_days d
    left join public.program_exercises e on e.program_day_id = d.id
    left join public.exercises x on x.id = e.exercise_id
    left join lateral unnest(coalesce(x.primary_muscles, '{}')) as m on true
    where d.program_id = p.id
  ) agg on true
  -- Days in the first week: "days per week" as the program states it.
  left join lateral (
    select count(*)::int as days from public.program_days d
    where d.program_id = p.id
      and d.week_index = (select min(d2.week_index) from public.program_days d2 where d2.program_id = p.id)
  ) wk on true
  -- A session's length: each day's whole minutes, averaged over the days and
  -- rounded — the detail page's figure (sessionMinutes() in packages/shared).
  left join lateral (
    select round(avg(day_minutes))::int as minutes
    from (
      select floor(coalesce(sum(e.target_sets * (40 + coalesce(e.rest_seconds, 90))), 0) / 60.0) as day_minutes
      from public.program_days d
      left join public.program_exercises e on e.program_day_id = d.id
      where d.program_id = p.id
      group by d.id
    ) per_day
  ) sess on true
  where p.id = any(p_ids)
    and public.can_see_program(p.id)
    and (coalesce(p.coach_id, p.client_id) = auth.uid()
         or p.client_id = auth.uid()
         or not public.social_blocked_between(auth.uid(), coalesce(p.coach_id, p.client_id)));
$$;

create or replace function public.discover_programs(
  p_q text default null,
  p_level text default null,
  p_goal text default null,
  p_muscle text default null,
  p_equipment text default null,
  p_sort text default 'newest',
  p_limit int default 20,
  p_offset int default 0,
  p_style text default null,
  p_max_minutes int default null,
  p_featured boolean default false
)
returns table (
  id uuid, name text, description text, level text, goal text, visibility text,
  status text, coach_id uuid, client_id uuid, source_program_id uuid,
  author_id uuid, author_name text, author_username text, author_avatar text,
  days int, exercises int, total_sets int, est_minutes int,
  muscle_groups text[], equipment text[], copy_count int,
  weeks int, days_per_week int, session_minutes int, training_style text,
  featured boolean, source text,
  saved boolean, is_mine boolean, assigned_by_coach boolean,
  created_at timestamptz, updated_at timestamptz
) language plpgsql stable security definer set search_path = public as $$
declare
  v_limit int := greatest(1, least(coalesce(p_limit, 20), 50));
  v_offset int := greatest(0, coalesce(p_offset, 0));
  v_q text := nullif(btrim(coalesce(p_q, '')), '');
  v_sort text := coalesce(p_sort, 'newest');
begin
  if auth.uid() is null then return; end if;
  if v_sort not in ('newest', 'most_copied') then
    raise exception 'unknown sort' using errcode = '22023';
  end if;
  return query
    select c.*
    from public.program_card_rows(
      array(
        select p.id
        from public.programs p
        join public.users u on u.id = coalesce(p.coach_id, p.client_id)
        where p.visibility <> 'private'
          and public.can_see_program(p.id)
          and (coalesce(p.coach_id, p.client_id) = auth.uid()
               or p.client_id = auth.uid()
               or not public.social_blocked_between(auth.uid(), coalesce(p.coach_id, p.client_id)))
          and exists (select 1 from public.program_days d where d.program_id = p.id)
          and (v_q is null
               or p.name ilike '%' || v_q || '%'
               or coalesce(u.username, u.full_name) ilike '%' || v_q || '%'
               or coalesce(p.description, '') ilike '%' || v_q || '%')
          and (p_level is null or p.level = p_level)
          and (p_goal is null or p.goal = p_goal)
          and (p_style is null or p.training_style = p_style)
          and (not coalesce(p_featured, false) or (p.featured_at is not null and p.visibility = 'public'))
          and (p_muscle is null or exists (
                select 1 from public.program_days d
                join public.program_exercises e on e.program_day_id = d.id
                join public.exercises x on x.id = e.exercise_id
                where d.program_id = p.id and p_muscle = any(x.primary_muscles)))
          and (p_equipment is null or exists (
                select 1 from public.program_days d
                join public.program_exercises e on e.program_day_id = d.id
                join public.exercises x on x.id = e.exercise_id
                where d.program_id = p.id and x.equipment = p_equipment))
          and (p_max_minutes is null or (
                select round(avg(day_minutes)) from (
                  select floor(coalesce(sum(e.target_sets * (40 + coalesce(e.rest_seconds, 90))), 0) / 60.0) as day_minutes
                  from public.program_days d
                  left join public.program_exercises e on e.program_day_id = d.id
                  where d.program_id = p.id
                  group by d.id
                ) per_day) <= p_max_minutes)
        order by
          case when v_sort = 'most_copied' then p.copy_count end desc nulls last,
          p.created_at desc
        limit v_limit offset v_offset
      )
    ) c
    order by
      case when v_sort = 'most_copied' then c.copy_count end desc nulls last,
      c.created_at desc;
end;
$$;
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('program_card_rows', 'discover_programs') loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
