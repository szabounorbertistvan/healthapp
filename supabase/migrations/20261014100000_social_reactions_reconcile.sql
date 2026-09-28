-- HealthApp schema · reactions and post photos, carried through Social 2.0
--
-- 20261002100000_reactions_and_post_photos (live since 2026-09-28) and the
-- Social 2.0 chain (20261002110000 … 20261013100000) were written side by
-- side. The chain redefines five functions that migration had already
-- changed, from bodies that predate it: applied as they stand, the feed
-- would go back to one boolean `my_kudos`, the reaction list would lose its
-- kind, the notification would stop saying which reaction arrived, and the
-- guard would null the photo on every text post and drop a workout photo's
-- size and overlay. This puts both halves together, on the chain's latest
-- bodies:
--
-- 1. social_feed, social_post, social_saved_posts: `kudos_count` (arms),
--    `love_count` (peaches) and `my_reaction`, where the chain had one count
--    and `my_kudos`. Everything else is 20261013100000's.
-- 2. social_post_kudos: 20261007100000's block filter, and the kind.
-- 3. notify_new_kudos: 20261008100000's social_notify_ok gate, and the
--    reaction in the title, body and payload.
-- 4. social_posts_guard: 20261012100000's server-side rebuild, and
--    - a text post keeps a payload that is a photo in the author's own post
--      folder (the same rule as a workout photo), and nothing else;
--    - a workout keeps the photo's size and the overlay the author placed.
--
-- The return types change, so the three feed reads and the reaction list are
-- dropped and recreated (create or replace cannot change them).

-- ---------- 1. the feed-shaped reads ----------
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
  kudos_count int, love_count int, comment_count int, my_reaction text, kudos_names text[], mentions jsonb,
  edited_at timestamptz, saved boolean, shared jsonb, comment_preview jsonb, author_muted boolean
) language sql stable security definer set search_path = public as $$
  select
    p.id, p.user_id,
    coalesce(u.username, u.full_name) as author_name, u.username, u.avatar_url,
    p.type, p.text, p.payload, p.visibility, p.created_at,
    p.activity_id, p.challenge_id,
    (select count(*)::int from public.social_reactions r where r.post_id = p.id and r.type = 'kudos'),
    (select count(*)::int from public.social_reactions r where r.post_id = p.id and r.type = 'love'),
    public.social_visible_comment_count(p.id),
    (select r.type from public.social_reactions r where r.post_id = p.id and r.user_id = auth.uid()),
    coalesce((select array_agg(x.name order by x.created_at, x.id) from (
      select coalesce(ru.username, ru.full_name) as name, r.created_at, r.id
      from public.social_reactions r join public.users ru on ru.id = r.user_id
      where r.post_id = p.id and public.is_listed_user(r.user_id) order by r.created_at, r.id limit 2
    ) x), '{}'),
    public.social_visible_post_mentions(p.id),
    p.edited_at,
    exists (select 1 from public.social_post_saves sv where sv.post_id = p.id and sv.user_id = auth.uid()),
    case when p.type = 'shared_post' then public.social_shared_original(p.payload) end,
    public.social_comment_preview(p.id),
    public.social_is_muted(p.user_id)
  from public.social_posts p
  join public.users u on u.id = p.user_id
  where auth.uid() is not null
    and p.deleted_at is null
    and (p.user_id = auth.uid() or public.is_listed_user(p.user_id))
    -- Muted: gone from the feed, still on their own profile (p_author).
    and (p_author is not null or not public.social_is_muted(p.user_id))
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

drop function if exists public.social_post(uuid);
create function public.social_post(p_post uuid)
returns table (
  id uuid, user_id uuid, author_name text, author_username text, author_avatar text,
  type text, text text, payload jsonb, visibility text, created_at timestamptz,
  activity_id uuid, challenge_id uuid,
  kudos_count int, love_count int, comment_count int, my_reaction text, kudos_names text[], mentions jsonb,
  edited_at timestamptz, saved boolean, shared jsonb, author_muted boolean
) language sql stable security definer set search_path = public as $$
  select
    p.id, p.user_id,
    coalesce(u.username, u.full_name), u.username, u.avatar_url,
    p.type, p.text, p.payload, p.visibility, p.created_at,
    p.activity_id, p.challenge_id,
    (select count(*)::int from public.social_reactions r where r.post_id = p.id and r.type = 'kudos'),
    (select count(*)::int from public.social_reactions r where r.post_id = p.id and r.type = 'love'),
    public.social_visible_comment_count(p.id),
    (select r.type from public.social_reactions r where r.post_id = p.id and r.user_id = auth.uid()),
    coalesce((select array_agg(x.name order by x.created_at, x.id) from (
      select coalesce(ru.username, ru.full_name) as name, r.created_at, r.id
      from public.social_reactions r join public.users ru on ru.id = r.user_id
      where r.post_id = p.id and public.is_listed_user(r.user_id) order by r.created_at, r.id limit 2
    ) x), '{}'),
    public.social_visible_post_mentions(p.id),
    p.edited_at,
    exists (select 1 from public.social_post_saves sv where sv.post_id = p.id and sv.user_id = auth.uid()),
    case when p.type = 'shared_post' then public.social_shared_original(p.payload) end,
    public.social_is_muted(p.user_id)
  from public.social_posts p
  join public.users u on u.id = p.user_id
  where p.id = p_post and auth.uid() is not null and p.deleted_at is null and public.can_see_post(p.id)
    and (p.user_id = auth.uid() or public.is_listed_user(p.user_id));
$$;

drop function if exists public.social_saved_posts(int, timestamptz);
create function public.social_saved_posts(p_limit int default 20, p_before timestamptz default null)
returns table (
  id uuid, user_id uuid, author_name text, author_username text, author_avatar text,
  type text, text text, payload jsonb, visibility text, created_at timestamptz,
  activity_id uuid, challenge_id uuid,
  kudos_count int, love_count int, comment_count int, my_reaction text, kudos_names text[], mentions jsonb,
  edited_at timestamptz, saved boolean, shared jsonb, saved_at timestamptz, comment_preview jsonb, author_muted boolean
) language sql stable security definer set search_path = public as $$
  select
    p.id, p.user_id,
    coalesce(u.username, u.full_name), u.username, u.avatar_url,
    p.type, p.text, p.payload, p.visibility, p.created_at,
    p.activity_id, p.challenge_id,
    (select count(*)::int from public.social_reactions r where r.post_id = p.id and r.type = 'kudos'),
    (select count(*)::int from public.social_reactions r where r.post_id = p.id and r.type = 'love'),
    public.social_visible_comment_count(p.id),
    (select r.type from public.social_reactions r where r.post_id = p.id and r.user_id = auth.uid()),
    coalesce((select array_agg(x.name order by x.created_at, x.id) from (
      select coalesce(ru.username, ru.full_name) as name, r.created_at, r.id
      from public.social_reactions r join public.users ru on ru.id = r.user_id
      where r.post_id = p.id and public.is_listed_user(r.user_id) order by r.created_at, r.id limit 2
    ) x), '{}'),
    public.social_visible_post_mentions(p.id),
    p.edited_at,
    true,
    case when p.type = 'shared_post' then public.social_shared_original(p.payload) end,
    sv.created_at,
    public.social_comment_preview(p.id),
    public.social_is_muted(p.user_id)
  from public.social_post_saves sv
  join public.social_posts p on p.id = sv.post_id
  join public.users u on u.id = p.user_id
  where auth.uid() is not null
    and sv.user_id = auth.uid()
    and p.deleted_at is null
    and public.can_see_post(p.id)
    and (p.user_id = auth.uid() or public.is_listed_user(p.user_id))
    and (p_before is null or sv.created_at < p_before)
  order by sv.created_at desc, p.id desc
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

-- ---------- 2. who reacted, and how ----------
drop function if exists public.social_post_kudos(uuid, int, timestamptz);
create function public.social_post_kudos(p_post uuid, p_limit int default 20, p_before timestamptz default null)
returns table (user_id uuid, name text, username text, avatar_url text, type text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.user_id, coalesce(u.username, u.full_name), u.username, u.avatar_url, r.type, r.created_at
  from public.social_reactions r
  join public.users u on u.id = r.user_id
  where r.post_id = p_post
    and public.can_see_post(p_post)
    and not public.social_blocked_between(auth.uid(), r.user_id)
    and (p_before is null or r.created_at < p_before)
  order by r.created_at desc, r.id desc
  limit greatest(1, least(p_limit, 50));
$$;

do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and p.proname in ('social_feed', 'social_post', 'social_saved_posts', 'social_post_kudos') loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;

-- ---------- 3. the notification names the reaction ----------
create or replace function public.notify_new_kudos()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_author uuid;
  v_giver text;
begin
  select p.user_id into v_author from public.social_posts p where p.id = new.post_id;
  if v_author is null or not public.social_notify_ok(v_author, new.user_id) then
    return new;
  end if;
  -- One notification per (post, giver): switching from the arm to the peach
  -- is not a second ping.
  if exists (
    select 1 from public.notifications n
    where n.user_id = v_author and n.category = 'new_kudos'
      and n.payload ->> 'post_id' = new.post_id::text
      and n.payload ->> 'actor_id' = new.user_id::text
  ) then
    return new;
  end if;
  select coalesce(u.username, u.full_name, 'Someone') into v_giver from public.users u where u.id = new.user_id;
  insert into public.notifications (user_id, category, title, body, payload)
  values (v_author, 'new_kudos',
          case when new.type = 'love' then 'New reaction' else 'New kudos' end,
          case when new.type = 'love' then v_giver || ' loved your post' else v_giver || ' gave you kudos' end,
          jsonb_build_object('post_id', new.post_id, 'actor_id', new.user_id, 'reaction', new.type));
  return new;
end;
$$;

-- ---------- 4. the guard ----------
-- 20261012100000's body; the two changes are marked "photo".
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
  v_photo_re text;
  v_started timestamptz;
  v_start date;
  v_tz text;
begin
  -- photo: the one thing a post takes from the server action as given. Kept
  -- only as a Cloudinary upload in this author's own post folder.
  v_photo_re := '^https://res\.cloudinary\.com/[^/?#]+/image/upload/([^?#]*/)?voinic/posts/'
                || new.user_id::text || '/[^/?#]+$';

  if new.type = 'text' then
    -- photo: a text post has no payload unless it carries a picture, and then
    -- the picture and nothing else.
    v_photo := new.payload ->> 'photo_url';
    if new.payload ->> 'kind' = 'text' and v_photo is not null and v_photo ~ v_photo_re then
      new.payload := jsonb_build_object(
        'kind', 'text',
        'photo_url', v_photo,
        'photo_w', new.payload -> 'photo_w',
        'photo_h', new.payload -> 'photo_h',
        'overlay', new.payload -> 'overlay');
    else
      new.payload := null;
    end if;
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
    v_photo := new.payload ->> 'photo_url';
    if v_photo is null or v_photo !~ v_photo_re then
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
      'photo_url', v_photo,
      -- photo: its size and the overlay the author placed, only with a photo.
      'photo_w', case when v_photo is not null then new.payload -> 'photo_w' end,
      'photo_h', case when v_photo is not null then new.payload -> 'photo_h' end,
      'overlay', case when v_photo is not null then new.payload -> 'overlay' end);
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
