-- HealthApp schema · social v2
--
-- The feed, follows, kudos, comments and the snapshot rule all stay exactly as
-- they were. can_see_post() is still the one visibility predicate and every
-- policy and RPC below goes through it. What this migration adds is the part
-- that makes the feed a conversation rather than a noticeboard:
--
-- 1. Replies. social_comments grows `parent_id`, ONE level deep — a reply
--    answers a comment, never another reply. Depth is enforced by a trigger
--    rather than by hope, because a thread that can nest arbitrarily is a
--    thread nobody can render on a 375px phone.
--
-- 2. Mentions, stored STRUCTURALLY. The comment body keeps the literal
--    "@maria" text and is rendered as text — never as HTML — while
--    social_comment_mentions holds the resolved user ids. The renderer links
--    a handle only when a row says so, so a body that merely contains
--    "@someone" cannot fabricate a link, and nothing is ever parsed out of
--    user input at read time.
--
--    A mention grants NOTHING. The notification fires only when the mentioned
--    person can already see the post (can_see_post runs as them, via the
--    security-definer trigger), so being named in a comment on a private post
--    is silent and leads nowhere.
--
-- 3. Comment notifications. The 'new_comment' category has existed since the
--    social migration with nothing writing it. Now: the post's author hears
--    about a comment, the parent comment's author hears about a reply, and
--    neither hears about their own typing. One notification per person per
--    comment, so being both the parent author and a mentioned user is still
--    one ping.
--
-- 4. Feed scopes. social_feed() grows `p_scope`: 'following' (own + followed,
--    which is exactly what it did before and remains the default), 'all'
--    (everything the visibility rules already allow) and 'mine'.
--
-- 5. social_post() — one post by id. getPost() used to fetch fifty posts by
--    the same author and scan for the one it wanted.
--
-- 6. Suggestions and mutuals, both computed from real follow edges. No
--    ranking model, no invented affinity: "followed by people you follow",
--    counted.

-- ---------- 1. replies ----------
alter table public.social_comments
  add column if not exists parent_id uuid references public.social_comments (id) on delete cascade;
create index if not exists social_comments_parent_idx on public.social_comments (parent_id, created_at);
comment on column public.social_comments.parent_id is
  'The comment this one answers. One level only — a reply cannot itself be replied to.';

/**
 * A reply answers a top-level comment, on the same post, and nothing else.
 * Without this a client could thread arbitrarily deep, or hang a reply off a
 * comment belonging to a different post entirely.
 */
create or replace function public.social_comment_depth_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_parent public.social_comments;
begin
  if new.parent_id is null then
    return new;
  end if;
  select * into v_parent from public.social_comments where id = new.parent_id;
  if not found then
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

drop trigger if exists social_comments_depth on public.social_comments;
create trigger social_comments_depth before insert or update on public.social_comments
  for each row execute function public.social_comment_depth_guard();

-- ---------- 2. mentions ----------
create table if not exists public.social_comment_mentions (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.social_comments (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (comment_id, user_id)
);
create index if not exists social_comment_mentions_user_idx
  on public.social_comment_mentions (user_id, created_at desc);
alter table public.social_comment_mentions enable row level security;

grant select, insert, delete on table public.social_comment_mentions to authenticated;
grant select, insert, delete on table public.social_comment_mentions to service_role;

-- A mention is readable wherever its comment is, and writable only by the
-- person writing that comment. Both go through the post's visibility, so a
-- mention row can never be the way somebody reaches a post.
drop policy if exists comment_mentions_select on public.social_comment_mentions;
create policy comment_mentions_select on public.social_comment_mentions for select to authenticated
  using (exists (select 1 from public.social_comments c
                 where c.id = comment_id and public.can_see_post(c.post_id)));

drop policy if exists comment_mentions_insert on public.social_comment_mentions;
create policy comment_mentions_insert on public.social_comment_mentions for insert to authenticated
  with check (exists (select 1 from public.social_comments c
                      where c.id = comment_id and c.user_id = auth.uid() and public.can_see_post(c.post_id)));

drop policy if exists comment_mentions_delete on public.social_comment_mentions;
create policy comment_mentions_delete on public.social_comment_mentions for delete to authenticated
  using (exists (select 1 from public.social_comments c where c.id = comment_id and c.user_id = auth.uid()));

-- ---------- 3. notifications ----------
alter type public.notification_category add value if not exists 'comment_reply';
alter type public.notification_category add value if not exists 'new_mention';

/**
 * Who a comment tells, and what it tells them.
 *
 *   the post's author  → 'new_comment'   ("Maria commented on your workout.")
 *   the parent author  → 'comment_reply' ("Maria replied to your comment.")
 *
 * Never yourself, and never twice: if you wrote both the post and the comment
 * being replied to, you are told once, as a reply.
 *
 * Runs as owner because `notifications` has no insert policy for
 * authenticated — engine tables are service-role writes (rls.sql §engine).
 */
create or replace function public.notify_new_comment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_actor text;
  v_post public.social_posts;
  v_parent_author uuid;
  v_told uuid[] := '{}';
begin
  select coalesce(u.username, u.full_name) into v_actor from public.users u where u.id = new.user_id;
  select * into v_post from public.social_posts where id = new.post_id;
  if not found or v_post.deleted_at is not null then
    return new;
  end if;

  if new.parent_id is not null then
    select c.user_id into v_parent_author from public.social_comments c where c.id = new.parent_id;
    if v_parent_author is not null and v_parent_author <> new.user_id then
      insert into public.notifications (user_id, category, title, body, payload)
      values (v_parent_author, 'comment_reply', v_actor, left(new.body, 140),
              jsonb_build_object('post_id', new.post_id, 'comment_id', new.id, 'actor_id', new.user_id));
      v_told := array_append(v_told, v_parent_author);
    end if;
  end if;

  if v_post.user_id <> new.user_id and not (v_post.user_id = any(v_told)) then
    insert into public.notifications (user_id, category, title, body, payload)
    values (v_post.user_id, 'new_comment', v_actor, left(new.body, 140),
            jsonb_build_object('post_id', new.post_id, 'comment_id', new.id, 'actor_id', new.user_id));
  end if;

  return new;
end;
$$;

drop trigger if exists social_comments_notify on public.social_comments;
create trigger social_comments_notify after insert on public.social_comments
  for each row execute function public.notify_new_comment();

/**
 * Being named in a comment.
 *
 * Three refusals, all of them deliberate:
 *   · never yourself,
 *   · never someone who cannot already see the post — a mention must not be a
 *     way of pointing a stranger at private content, not even as a title,
 *   · never twice for the same comment, so the reply you were also mentioned
 *     in stays one notification.
 */
create or replace function public.notify_new_mention()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_comment public.social_comments;
  v_actor text;
  v_visible boolean;
begin
  select * into v_comment from public.social_comments where id = new.comment_id;
  if not found or v_comment.user_id = new.user_id then
    return new;
  end if;

  -- can_see_post() reads auth.uid(); ask the question AS the mentioned person.
  select exists (
    select 1 from public.social_posts p
    where p.id = v_comment.post_id
      and p.deleted_at is null
      and (
        p.user_id = new.user_id
        or p.visibility = 'public'
        or (p.visibility = 'followers'
            and (exists (select 1 from public.social_follows f
                         where f.follower_id = new.user_id and f.following_id = p.user_id)
                 or exists (select 1 from public.trainer_clients tc
                            where tc.coach_id = new.user_id and tc.client_id = p.user_id
                              and tc.status = 'active')))
      )
  ) into v_visible;
  if not v_visible then
    return new;
  end if;

  if exists (
    select 1 from public.notifications n
    where n.user_id = new.user_id
      and n.payload ->> 'comment_id' = new.comment_id::text
  ) then
    return new;
  end if;

  select coalesce(u.username, u.full_name) into v_actor from public.users u where u.id = v_comment.user_id;
  insert into public.notifications (user_id, category, title, body, payload)
  values (new.user_id, 'new_mention', v_actor, left(v_comment.body, 140),
          jsonb_build_object('post_id', v_comment.post_id, 'comment_id', v_comment.id, 'actor_id', v_comment.user_id));
  return new;
end;
$$;

drop trigger if exists social_comment_mentions_notify on public.social_comment_mentions;
create trigger social_comment_mentions_notify after insert on public.social_comment_mentions
  for each row execute function public.notify_new_mention();

-- Notification cards show who acted, so the reader sees a face rather than a
-- name. Security definer for the reason the feed is: users_select would hide
-- everyone who is not the reader's coach or client.
create or replace function public.notification_actors(p_ids uuid[])
returns table (id uuid, name text, username text, avatar_url text)
language sql stable security definer set search_path = public as $$
  select u.id, coalesce(u.username, u.full_name), u.username, u.avatar_url
  from public.users u
  where u.id = any(p_ids);
$$;
grant execute on function public.notification_actors(uuid[]) to authenticated;

-- ---------- 4. comments, with replies and mentions ----------
-- Top-level comments are paged on a cursor; each carries its replies with it.
-- A reply belongs to the comment it answers, so paging them separately would
-- mean a round trip per comment on screen.
drop function if exists public.social_post_comments(uuid);
create or replace function public.social_post_comments(
  p_post uuid,
  p_limit int default 20,
  p_before timestamptz default null
)
returns table (
  id uuid, parent_id uuid, user_id uuid, author_name text, author_username text,
  author_avatar text, body text, created_at timestamptz, mentions jsonb, reply_count int
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
    -- Replies are capped: a comment with 500 answers must not become a page of
    -- its own. The count below says how many there really are.
    select c.* from public.social_comments c
    where c.parent_id in (select id from roots)
  )
  select
    t.id, t.parent_id, t.user_id,
    coalesce(u.username, u.full_name), u.username, u.avatar_url,
    t.body, t.created_at,
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

-- Who can be mentioned: people the author can find, with the ones who can
-- already see this post first — mentioning somebody who cannot open the post
-- is allowed (it is just text) but it will never notify them, so they sort last.
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
  where u.id <> auth.uid()
    and u.username is not null
    and char_length(btrim(coalesce(p_query, ''))) >= 1
    and u.username ilike btrim(p_query) || '%'
  order by can_see desc, u.username
  limit 8;
$$;
grant execute on function public.social_mention_candidates(text, uuid) to authenticated;

-- ---------- 5. feed scopes and one post ----------
-- The select is unchanged apart from p_scope; 'following' is the default and
-- is exactly what the three-argument version did.
drop function if exists public.social_feed(int, timestamptz, uuid);
create or replace function public.social_feed(
  p_limit int default 20,
  p_before timestamptz default null,
  p_author uuid default null,
  p_scope text default 'following',
  -- One post type, for the profile's tabs. Filtering a fetched page in the app
  -- instead would make a tab look empty whenever the 20 posts it was given
  -- happened to contain none of that type.
  p_type text default null
)
returns table (
  id uuid, user_id uuid, author_name text, author_username text, author_avatar text,
  type text, text text, payload jsonb, visibility text, created_at timestamptz,
  activity_id uuid, challenge_id uuid,
  kudos_count int, comment_count int, my_kudos boolean, kudos_names text[]
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
    ) x), '{}')
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
    -- The visibility rule is applied on top of every scope, so 'all' widens
    -- who is listed and never what may be seen.
    and (
      p.user_id = auth.uid()
      or p.visibility = 'public'
      -- The coach branch comes from 20260921100000: a client's 'followers'
      -- post is also readable by their active coach. Dropping it here is how
      -- this rewrite first broke coach_sees_client_posts.test.sql.
      or (p.visibility = 'followers'
          and (public.is_following(p.user_id) or public.is_active_coach_of(p.user_id)))
    )
  order by p.created_at desc, p.id desc
  limit greatest(1, least(p_limit, 50));
$$;
grant execute on function public.social_feed(int, timestamptz, uuid, text, text) to authenticated;

/** One post, in the feed's own shape. Empty for a post the caller may not see. */
create or replace function public.social_post(p_post uuid)
returns table (
  id uuid, user_id uuid, author_name text, author_username text, author_avatar text,
  type text, text text, payload jsonb, visibility text, created_at timestamptz,
  activity_id uuid, challenge_id uuid,
  kudos_count int, comment_count int, my_kudos boolean, kudos_names text[]
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
    ) x), '{}')
  from public.social_posts p
  join public.users u on u.id = p.user_id
  where p.id = p_post and p.deleted_at is null and public.can_see_post(p.id);
$$;
grant execute on function public.social_post(uuid) to authenticated;

-- ---------- 6. the profile, mutuals and suggestions ----------
-- The profile gains the things a social header shows: city, bio, streak and a
-- post count. Still nothing about weight, food or measurements.
drop function if exists public.social_profile(uuid);
create or replace function public.social_profile(p_user uuid)
returns table (
  id uuid, name text, username text, avatar_url text, city text, bio text,
  followers int, following int, workouts int, prs int, challenges int,
  posts int, streak_days int,
  is_following boolean, follows_me boolean
) language sql stable security definer set search_path = public as $$
  select
    u.id, coalesce(u.username, u.full_name), u.username, u.avatar_url, u.city, u.bio,
    (select count(*)::int from public.social_follows f where f.following_id = u.id),
    (select count(*)::int from public.social_follows f where f.follower_id = u.id),
    (select count(*)::int from public.logged_sessions s where s.user_id = u.id and s.completed_at is not null),
    (select count(*)::int from public.logged_sets ls where ls.user_id = u.id and ls.is_pr),
    (select count(*)::int from public.challenge_participants cp where cp.user_id = u.id and cp.completed_at is not null),
    -- Only the posts this reader may actually open, so the number never
    -- promises content the tabs cannot show.
    (select count(*)::int from public.social_posts p
      where p.user_id = u.id and p.deleted_at is null and public.can_see_post(p.id)),
    coalesce((select current_days from public.social_streak(u.id)), 0),
    public.is_following(u.id),
    exists (select 1 from public.social_follows f where f.follower_id = u.id and f.following_id = auth.uid())
  from public.users u
  where u.id = p_user;
$$;
grant execute on function public.social_profile(uuid) to authenticated;

-- "Followed by Maria and 3 others": people I follow who also follow them.
-- One query over the follow edges — never a request per person.
create or replace function public.social_mutual_followers(p_user uuid, p_limit int default 3)
returns table (id uuid, name text, username text, avatar_url text, total int)
language sql stable security definer set search_path = public as $$
  with mutual as (
    select f.follower_id as id
    from public.social_follows f
    where f.following_id = p_user
      and f.follower_id <> auth.uid()
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
grant execute on function public.social_mutual_followers(uuid, int) to authenticated;

-- Suggestions, counted rather than modelled: people followed by the people I
-- follow, most shared connections first. No affinity score, no decay, nothing
-- that cannot be explained in one sentence to the person seeing it.
create or replace function public.social_suggested_people(p_limit int default 10)
returns table (id uuid, name text, username text, avatar_url text, is_following boolean, mutuals int)
language sql stable security definer set search_path = public as $$
  select u.id, coalesce(u.username, u.full_name), u.username, u.avatar_url, false, c.mutuals
  from (
    select f2.following_id as id, count(*)::int as mutuals
    from public.social_follows f1
    join public.social_follows f2 on f2.follower_id = f1.following_id
    where f1.follower_id = auth.uid()
      and f2.following_id <> auth.uid()
      and not exists (select 1 from public.social_follows mine
                      where mine.follower_id = auth.uid() and mine.following_id = f2.following_id)
    group by f2.following_id
  ) c
  join public.users u on u.id = c.id
  where u.username is not null
  order by c.mutuals desc, u.username
  limit greatest(1, least(coalesce(p_limit, 10), 20));
$$;
grant execute on function public.social_suggested_people(int) to authenticated;

-- Find people by name, username or city. City is free text on the profile and
-- already public there; gym and specialisation do not exist in this schema and
-- are deliberately not invented here (docs/GAPS.md).
drop function if exists public.social_search_users(text);
create or replace function public.social_search_users(p_query text, p_city text default null)
returns table (id uuid, name text, username text, avatar_url text, city text, is_following boolean)
language sql stable security definer set search_path = public as $$
  select u.id, coalesce(u.username, u.full_name), u.username, u.avatar_url, u.city,
         public.is_following(u.id)
  from public.users u
  where u.id <> auth.uid()
    and (
      char_length(btrim(coalesce(p_query, ''))) >= 2
      or char_length(btrim(coalesce(p_city, ''))) >= 2
    )
    and (char_length(btrim(coalesce(p_query, ''))) < 2
         or u.username ilike '%' || btrim(p_query) || '%'
         or u.full_name ilike '%' || btrim(p_query) || '%')
    and (p_city is null or u.city ilike '%' || btrim(p_city) || '%')
  order by (u.username ilike btrim(coalesce(p_query, '')) || '%') desc, u.username nulls last
  limit 20;
$$;
grant execute on function public.social_search_users(text, text) to authenticated;

-- Handles typed in a comment, resolved to ids.
--
-- Needed because users_select shows a person only themselves and their coach
-- or clients, so the server action writing a comment cannot look a username up
-- through the table. Returns nothing but id and username — the same two fields
-- the mention already shows on screen — and only for handles that were
-- actually typed.
create or replace function public.social_resolve_handles(p_handles text[])
returns table (id uuid, username text)
language sql stable security definer set search_path = public as $$
  select u.id, u.username
  from public.users u
  where u.username is not null
    and lower(u.username) = any (select lower(h) from unnest(coalesce(p_handles, '{}')) h)
  limit 10;
$$;
grant execute on function public.social_resolve_handles(text[]) to authenticated;
