-- HealthApp schema · kudos
--
-- Kudos is the one reaction on a post (social_reactions, type 'kudos'). The
-- table, its (post_id, user_id, type) uniqueness and the read policy come
-- from the social migration; this one adds what the feature needs on top:
--
-- 1. Nobody gives kudos to their own post. can_kudos_post() is can_see_post()
--    minus the author, and reactions_insert now goes through it — the server
--    action applies the same rule, but the policy is what makes it true.
-- 2. social_feed() carries the first TWO names, so the card can say
--    "Norbert, Maria and 3 others" without a second query.
-- 3. social_post_kudos() lists who gave kudos, one page at a time, guarded by
--    the post's visibility. Security definer for the same reason as the feed:
--    users_select would hide the names.
-- 4. A kudos writes a 'new_kudos' notification for the author. The trigger
--    runs as the owner because notifications is engine-written only (no
--    insert policy for authenticated) — the same path §8 push-dispatch reads.

-- ---------- 1. who may give kudos ----------
create or replace function public.can_kudos_post(p_post uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_see_post(p_post)
     and not exists (select 1 from public.social_posts p where p.id = p_post and p.user_id = auth.uid());
$$;
grant execute on function public.can_kudos_post(uuid) to authenticated;

drop policy if exists reactions_insert on public.social_reactions;
create policy reactions_insert on public.social_reactions for insert to authenticated
  with check (user_id = auth.uid() and public.can_kudos_post(post_id));

-- ---------- 2. the feed carries two names ----------
-- The return shape changes (kudos_first → kudos_names), so replace outright.
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
      or (p.visibility = 'followers' and public.is_following(p.user_id))
    )
  order by p.created_at desc, p.id desc
  limit greatest(1, least(p_limit, 50));
$$;
grant execute on function public.social_feed(int, timestamptz, uuid) to authenticated;

-- ---------- 3. who gave kudos ----------
-- Newest first, cursor on created_at like the feed. Returns nothing at all
-- for a post the caller may not see — the list never leaks a private post.
create or replace function public.social_post_kudos(p_post uuid, p_limit int default 20, p_before timestamptz default null)
returns table (user_id uuid, name text, username text, avatar_url text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.user_id, coalesce(u.username, u.full_name), u.username, u.avatar_url, r.created_at
  from public.social_reactions r
  join public.users u on u.id = r.user_id
  where r.post_id = p_post
    and r.type = 'kudos'
    and public.can_see_post(p_post)
    and (p_before is null or r.created_at < p_before)
  order by r.created_at desc, r.id desc
  limit greatest(1, least(p_limit, 50));
$$;
grant execute on function public.social_post_kudos(uuid, int, timestamptz) to authenticated;

-- ---------- 4. notify the author ----------
-- One notification per (post, giver): taking kudos back and giving it again
-- does not ping the author twice. Self-kudos cannot happen (policy above),
-- but the trigger checks anyway so the rule does not depend on it.
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
  values (v_author, 'new_kudos', 'New kudos', v_giver || ' gave you kudos',
          jsonb_build_object('post_id', new.post_id, 'actor_id', new.user_id));
  return new;
end;
$$;

drop trigger if exists social_reactions_notify on public.social_reactions;
create trigger social_reactions_notify after insert on public.social_reactions
  for each row execute function public.notify_new_kudos();
