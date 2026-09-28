-- HealthApp schema · two reactions, one per person; photos on any post
--
-- 1. social_reactions.type grows 'love' (the peach) next to 'kudos' (the
--    flexed arm), and the uniqueness moves from (post, user, type) to
--    (post, user): a person has ONE reaction on a post. Pressing the other
--    button replaces it, pressing the same one again takes it back.
-- 2. social_react(p_post, p_type) does that flip atomically, as the caller
--    (security invoker), so reactions_insert / reactions_delete still decide
--    who may react to what. It returns the reaction the row is in afterwards
--    (null when taken back), which is what the card settles on.
-- 3. social_feed() and social_post() carry the two counts and the caller's
--    own reaction (`my_reaction`, replacing the boolean my_kudos).
--    `kudos_names` keeps naming the first two people whatever they pressed.
-- 4. social_post_kudos() lists reactions of both kinds, with the kind.
-- 5. The notification says which one arrived (payload.reaction); the
--    category stays new_kudos so nothing downstream changes. Still one
--    notification per (post, giver) — switching from the arm to the peach is
--    not a second ping.
-- 6. A text post may carry a payload if — and only if — it is a photo:
--    {"kind":"text","photo_url":…}. social_posts_guard() used to null every
--    text payload; it now keeps one that carries a picture.

-- ---------- 1. two kinds, one row per person ----------
alter table public.social_reactions drop constraint if exists social_reactions_type_check;
alter table public.social_reactions add constraint social_reactions_type_check check (type in ('kudos', 'love'));

alter table public.social_reactions drop constraint if exists social_reactions_post_id_user_id_type_key;
-- Should two rows for one person exist (they cannot today: only 'kudos' was
-- allowed and the old key covered it), keep the newest.
delete from public.social_reactions r
using public.social_reactions newer
where newer.post_id = r.post_id and newer.user_id = r.user_id
  and (newer.created_at, newer.id) > (r.created_at, r.id);
alter table public.social_reactions add constraint social_reactions_post_id_user_id_key unique (post_id, user_id);

comment on column public.social_reactions.type is
  'kudos = the flexed arm, love = the peach. One row per (post, user); social_react() flips it.';

-- ---------- 2. the flip ----------
create or replace function public.social_react(p_post uuid, p_type text)
returns text language plpgsql security invoker set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_current text;
begin
  if v_me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_type is not null and p_type not in ('kudos', 'love') then
    raise exception 'unknown reaction' using errcode = '22023';
  end if;
  select r.type into v_current from public.social_reactions r where r.post_id = p_post and r.user_id = v_me;
  -- The same button again, or an explicit null: take it back.
  if p_type is null or v_current = p_type then
    delete from public.social_reactions where post_id = p_post and user_id = v_me;
    return null;
  end if;
  -- The other button, or nothing yet: (re)place it. Delete first so the unique
  -- key never bites; the insert is what reactions_insert (can_kudos_post) guards.
  delete from public.social_reactions where post_id = p_post and user_id = v_me;
  insert into public.social_reactions (post_id, user_id, type) values (p_post, v_me, p_type);
  return p_type;
end;
$$;
grant execute on function public.social_react(uuid, text) to authenticated;

-- ---------- 3. the feed ----------
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
  edited_at timestamptz
) language sql stable security definer set search_path = public as $$
  select
    p.id, p.user_id,
    coalesce(u.username, u.full_name) as author_name, u.username, u.avatar_url,
    p.type, p.text, p.payload, p.visibility, p.created_at,
    p.activity_id, p.challenge_id,
    (select count(*)::int from public.social_reactions r where r.post_id = p.id and r.type = 'kudos'),
    (select count(*)::int from public.social_reactions r where r.post_id = p.id and r.type = 'love'),
    (select count(*)::int from public.social_comments c where c.post_id = p.id),
    (select r.type from public.social_reactions r where r.post_id = p.id and r.user_id = auth.uid()),
    coalesce((select array_agg(x.name order by x.created_at, x.id) from (
      select coalesce(ru.username, ru.full_name) as name, r.created_at, r.id
      from public.social_reactions r join public.users ru on ru.id = r.user_id
      where r.post_id = p.id order by r.created_at, r.id limit 2
    ) x), '{}'),
    coalesce((
      select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'username', mu.username))
      from public.social_post_mentions m join public.users mu on mu.id = m.user_id
      where m.post_id = p.id
    ), '[]'::jsonb),
    p.edited_at
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
  kudos_count int, love_count int, comment_count int, my_reaction text, kudos_names text[], mentions jsonb,
  edited_at timestamptz
) language sql stable security definer set search_path = public as $$
  select
    p.id, p.user_id,
    coalesce(u.username, u.full_name), u.username, u.avatar_url,
    p.type, p.text, p.payload, p.visibility, p.created_at,
    p.activity_id, p.challenge_id,
    (select count(*)::int from public.social_reactions r where r.post_id = p.id and r.type = 'kudos'),
    (select count(*)::int from public.social_reactions r where r.post_id = p.id and r.type = 'love'),
    (select count(*)::int from public.social_comments c where c.post_id = p.id),
    (select r.type from public.social_reactions r where r.post_id = p.id and r.user_id = auth.uid()),
    coalesce((select array_agg(x.name order by x.created_at, x.id) from (
      select coalesce(ru.username, ru.full_name) as name, r.created_at, r.id
      from public.social_reactions r join public.users ru on ru.id = r.user_id
      where r.post_id = p.id order by r.created_at, r.id limit 2
    ) x), '{}'),
    coalesce((
      select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'username', mu.username))
      from public.social_post_mentions m join public.users mu on mu.id = m.user_id
      where m.post_id = p.id
    ), '[]'::jsonb),
    p.edited_at
  from public.social_posts p
  join public.users u on u.id = p.user_id
  where p.id = p_post and p.deleted_at is null and public.can_see_post(p.id);
$$;
grant execute on function public.social_post(uuid) to authenticated;

-- ---------- 4. who reacted, and how ----------
drop function if exists public.social_post_kudos(uuid, int, timestamptz);
create function public.social_post_kudos(p_post uuid, p_limit int default 20, p_before timestamptz default null)
returns table (user_id uuid, name text, username text, avatar_url text, type text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.user_id, coalesce(u.username, u.full_name), u.username, u.avatar_url, r.type, r.created_at
  from public.social_reactions r
  join public.users u on u.id = r.user_id
  where r.post_id = p_post
    and public.can_see_post(p_post)
    and (p_before is null or r.created_at < p_before)
  order by r.created_at desc, r.id desc
  limit greatest(1, least(p_limit, 50));
$$;
grant execute on function public.social_post_kudos(uuid, int, timestamptz) to authenticated;

-- ---------- 5. the notification names the reaction ----------
create or replace function public.notify_new_kudos()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_author uuid;
  v_giver text;
begin
  select p.user_id into v_author from public.social_posts p where p.id = new.post_id;
  if v_author is null or v_author = new.user_id then
    return new;
  end if;
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

-- ---------- 6. a text post with a photo ----------
-- As in 20260930130000, except the first branch: a text post keeps a payload
-- that is a photo and nothing else. The photo URL itself is minted by the
-- server action (resolvePostPhoto) from an upload it signed; here the shape
-- is what is enforced.
create or replace function public.social_posts_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_badge record;
  v_real record;
  v_milestone int;
begin
  if new.type = 'text' then
    if new.payload is not null
       and new.payload ->> 'kind' = 'text'
       and new.payload ->> 'photo_url' like 'https://%' then
      new.payload := jsonb_build_object(
        'kind', 'text',
        'photo_url', new.payload -> 'photo_url',
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
  end if;
  return new;
end;
$$;
