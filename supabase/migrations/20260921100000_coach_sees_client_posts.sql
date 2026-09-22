-- A coach sees their active clients' posts.
--
-- Until now the feed knew exactly one relationship: social_follows. A post
-- left at the default visibility ('followers') was readable only by people who
-- follow the author, and coaching grants nothing there — so a client who
-- shared today's workout was invisible to the very person paying attention.
-- On the live project the coach followed nobody at all, so *every* client post
-- was hidden from them.
--
-- The rule added here is is_active_coach_of(author), and only on the
-- 'followers' branch:
--   * 'public'    — already visible to everyone, nothing changes.
--   * 'followers' — now also the author's active coach.
--   * 'private'   — still the author alone. "Only me" keeps meaning only me.
--
-- It follows the relationship, so ending it takes the access away with it,
-- exactly like every other coach read in this schema. One direction only: a
-- client does not gain sight of their coach's posts from this.

-- ---------- can_see_post: reads, comments and kudos all hang off this ----------
create or replace function public.can_see_post(p_post uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.social_posts p
    where p.id = p_post
      and p.deleted_at is null
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

-- ---------- social_feed: the same rule, inlined for the set-returning query ----------
-- The "whose posts" clause is deliberately left alone: the home feed stays
-- "mine + people I follow", so a coach's own feed does not silently fill with
-- client activity. The coach reads a client through the p_author branch, which
-- is what the client's page on the coach side asks for.
drop function if exists public.social_feed(int, timestamptz, uuid);
create function public.social_feed(p_limit int default 20, p_before timestamptz default null, p_author uuid default null)
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
    (select count(*)::int from public.social_reactions r where r.post_id = p.id) as kudos_count,
    (select count(*)::int from public.social_comments c where c.post_id = p.id) as comment_count,
    exists (select 1 from public.social_reactions r where r.post_id = p.id and r.user_id = auth.uid()) as my_kudos,
    -- the two earliest givers, in order: "Norbert, Maria and N others"
    coalesce((select array_agg(x.name order by x.created_at, x.id) from (
        select coalesce(ru.username, ru.full_name) as name, r.created_at, r.id
        from public.social_reactions r
        join public.users ru on ru.id = r.user_id
        where r.post_id = p.id
        order by r.created_at, r.id
        limit 2) x), '{}'::text[]) as kudos_names
  from public.social_posts p
  join public.users u on u.id = p.user_id
  where p.deleted_at is null
    and (p_before is null or p.created_at < p_before)
    and (
      -- home feed: mine + people I follow; profile feed: one author
      case when p_author is null
           then (p.user_id = auth.uid() or public.is_following(p.user_id))
           else p.user_id = p_author end
    )
    and (
      p.user_id = auth.uid()
      or p.visibility = 'public'
      or (
        p.visibility = 'followers'
        and (public.is_following(p.user_id) or public.is_active_coach_of(p.user_id))
      )
    )
  order by p.created_at desc, p.id desc
  limit greatest(1, least(p_limit, 50));
$$;
grant execute on function public.social_feed(int, timestamptz, uuid) to authenticated;
