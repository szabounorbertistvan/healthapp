-- Social 2.0 · Share + Save
--
-- 1. SAVE. social_post_saves is a private bookmark: (user, post) once, only
--    for a post the saver may see right now, only ever read or removed by
--    the saver. No count of saves exists anywhere, and saving notifies no one.
--
-- 2. SHARE TO VOINIC. A new post type, 'shared_post', whose payload is only a
--    reference: {kind, original_post_id}. The smallest schema change that
--    works — social_posts already carries type + payload, and the snapshot
--    guard already rebuilds payloads server-side, so a share is one more
--    branch there. The guard resolves a share of a share to the original,
--    refuses a post the sharer may not see (deleted, private, followers-only
--    without following, suspended or deleting author) and your own post, and
--    throws away anything else the client put in the payload.
--
--    Deliberately NOT a snapshot. A workout or badge post snapshots the
--    author's own data; a share would be snapshotting someone else's post,
--    which would keep it on screen after its author deleted it or narrowed
--    who may see it. So the original is read live, per reader, at read time:
--    each reader sees it only if they may see the original themselves; if
--    not — deleted, hidden, author suspended — the share says "Original post
--    unavailable" and shows nothing of it.
--
-- 3. social_feed / social_post gain two columns — `saved` and `shared` (the
--    original, as a reader may see it, or null) — so a page is still one
--    read. Their bodies are 20261003100000's with those two columns added and
--    one more guard: a caller with no session gets nothing (Supabase's default
--    privileges gave anon EXECUTE, and scope 'all' listed public posts to it).
--    social_saved_posts() is the /saved page: newest saved first, cursor on
--    the save time, the saver's own list only.
--
-- No share counter: nothing counts or exposes how often a post was shared.
--
-- Depends on 20261003100000_social_follow_lists.sql (is_listed_user).

-- ---------- 1. the post type ----------
alter table public.social_posts drop constraint if exists social_posts_type_check;
alter table public.social_posts add constraint social_posts_type_check
  check (type in ('workout', 'pr', 'challenge_completed', 'progress', 'text', 'streak', 'program',
                  'achievement', 'fitness_score', 'shared_post'));

-- ---------- 2. the guard: 20261002100000's body plus the shared_post branch ----------
create or replace function public.social_posts_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_badge record;
  v_real record;
  v_milestone int;
  v_original uuid;
  v_orig public.social_posts;
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
  end if;
  return new;
end;
$$;

-- ---------- 3. saves ----------
create table public.social_post_saves (
  user_id uuid not null references public.users (id) on delete cascade,
  post_id uuid not null references public.social_posts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);
comment on table public.social_post_saves is
  'Private bookmarks. Readable and removable only by the saver; never counted or shown to the author.';
create index social_post_saves_user_created_idx on public.social_post_saves (user_id, created_at desc, post_id desc);

alter table public.social_post_saves enable row level security;
create policy post_saves_select on public.social_post_saves for select to authenticated
  using (user_id = auth.uid());
-- can_see_post() is the feed's own rule (deleted, private, followers, coach);
-- the author must also still be listed.
create policy post_saves_insert on public.social_post_saves for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.can_see_post(post_id)
    and exists (select 1 from public.social_posts p where p.id = post_id and public.is_listed_user(p.user_id))
  );
create policy post_saves_delete on public.social_post_saves for delete to authenticated
  using (user_id = auth.uid());
-- Insert names the two key columns only: the save time is the server's.
revoke all on table public.social_post_saves from anon, authenticated;
grant select, delete on table public.social_post_saves to authenticated;
grant insert (user_id, post_id) on table public.social_post_saves to authenticated;

-- ---------- 4. the feed, one post, and the saved list ----------
-- The original of a share, as the CALLER may see it — or null.
create or replace function public.social_shared_original(p_payload jsonb)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', o.id, 'user_id', o.user_id,
    'author_name', coalesce(ou.username, ou.full_name), 'author_avatar', ou.avatar_url,
    'type', o.type, 'text', o.text, 'payload', o.payload, 'visibility', o.visibility,
    'created_at', o.created_at,
    'mentions', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'username', mu.username))
      from public.social_post_mentions m join public.users mu on mu.id = m.user_id
      where m.post_id = o.id
    ), '[]'::jsonb))
  from public.social_posts o
  join public.users ou on ou.id = o.user_id
  where p_payload ->> 'kind' = 'shared_post'
    and o.id = (p_payload ->> 'original_post_id')::uuid
    and auth.uid() is not null
    and public.can_see_post(o.id)
    and public.is_listed_user(o.user_id);
$$;
revoke execute on function public.social_shared_original(jsonb) from public, anon;
grant execute on function public.social_shared_original(jsonb) to authenticated;

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
  kudos_count int, comment_count int, my_kudos boolean, kudos_names text[], mentions jsonb,
  edited_at timestamptz, saved boolean, shared jsonb
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
    ), '[]'::jsonb),
    p.edited_at,
    exists (select 1 from public.social_post_saves sv where sv.post_id = p.id and sv.user_id = auth.uid()),
    case when p.type = 'shared_post' then public.social_shared_original(p.payload) end
  from public.social_posts p
  join public.users u on u.id = p.user_id
  where auth.uid() is not null
    and p.deleted_at is null
    and (p.user_id = auth.uid() or public.is_listed_user(p.user_id))
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
revoke execute on function public.social_feed(int, timestamptz, uuid, text, text) from public, anon;
grant execute on function public.social_feed(int, timestamptz, uuid, text, text) to authenticated;

drop function if exists public.social_post(uuid);
create function public.social_post(p_post uuid)
returns table (
  id uuid, user_id uuid, author_name text, author_username text, author_avatar text,
  type text, text text, payload jsonb, visibility text, created_at timestamptz,
  activity_id uuid, challenge_id uuid,
  kudos_count int, comment_count int, my_kudos boolean, kudos_names text[], mentions jsonb,
  edited_at timestamptz, saved boolean, shared jsonb
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
    ), '[]'::jsonb),
    p.edited_at,
    exists (select 1 from public.social_post_saves sv where sv.post_id = p.id and sv.user_id = auth.uid()),
    case when p.type = 'shared_post' then public.social_shared_original(p.payload) end
  from public.social_posts p
  join public.users u on u.id = p.user_id
  where p.id = p_post and auth.uid() is not null and p.deleted_at is null and public.can_see_post(p.id)
    and (p.user_id = auth.uid() or public.is_listed_user(p.user_id));
$$;
revoke execute on function public.social_post(uuid) from public, anon;
grant execute on function public.social_post(uuid) to authenticated;

-- /saved: the caller's own saves only — there is no parameter naming a user.
-- A saved post the caller may no longer see (deleted, hidden, author
-- suspended) drops out; the save row stays, harmless, until they remove it.
create or replace function public.social_saved_posts(p_limit int default 20, p_before timestamptz default null)
returns table (
  id uuid, user_id uuid, author_name text, author_username text, author_avatar text,
  type text, text text, payload jsonb, visibility text, created_at timestamptz,
  activity_id uuid, challenge_id uuid,
  kudos_count int, comment_count int, my_kudos boolean, kudos_names text[], mentions jsonb,
  edited_at timestamptz, saved boolean, shared jsonb, saved_at timestamptz
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
    ), '[]'::jsonb),
    p.edited_at,
    true,
    case when p.type = 'shared_post' then public.social_shared_original(p.payload) end,
    sv.created_at
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
revoke execute on function public.social_saved_posts(int, timestamptz) from public, anon;
grant execute on function public.social_saved_posts(int, timestamptz) to authenticated;
