-- Social 2.0 · Stories (v1: text on a background, 24 hours)
--
-- Two tables and one audience rule.
--
--   social_stories       one short text on one of three backgrounds. Lives
--                        24 hours: expires_at is set by a trigger, never by
--                        the client, and every read — policy or RPC — asks
--                        `expires_at > now()`, so an expired story is gone
--                        for everyone the instant it expires, rows or not.
--                        No update: a story cannot be edited once posted.
--   social_story_views   who opened which story, once: the primary key is
--                        the pair. Written only by social_mark_story_seen(),
--                        which writes auth.uid() and nothing else, so nobody
--                        can record a view for someone else.
--
-- Who may see a story is not a new rule. It is the audience of a
-- followers-only post (social_feed / can_see_post): the author themselves,
-- their followers, and their active coach — and, like every social surface
-- since 20261003100000, never an author who is suspended or being deleted
-- (is_listed_user). can_see_story_author() is that sentence in SQL.
--
-- No notifications: neither publishing a story nor viewing one writes any.
--
-- Depends on 20261003100000_social_follow_lists.sql (is_listed_user).

-- ---------- the audience ----------
create or replace function public.can_see_story_author(p_author uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
     and (
       p_author = auth.uid()
       or (public.is_listed_user(p_author)
           and (public.is_following(p_author) or public.is_active_coach_of(p_author)))
     );
$$;
revoke execute on function public.can_see_story_author(uuid) from public, anon;
grant execute on function public.can_see_story_author(uuid) to authenticated;

-- ---------- stories ----------
create table public.social_stories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  body text not null
    check (char_length(body) between 1 and 200 and body = btrim(body)),
  background text not null default 'gold'
    check (background in ('gold', 'night', 'paper')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  check (expires_at = created_at + interval '24 hours')
);
comment on table public.social_stories is
  'Short-lived text stories. Live while expires_at > now(); every read checks it. Written by the author only; never updated.';
create index social_stories_user_live_idx on public.social_stories (user_id, expires_at desc);

-- The clock is the server's. Whatever a client sends for created_at or
-- expires_at is overwritten, and one person holds at most 30 live stories.
create or replace function public.social_stories_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.created_at := now();
  new.expires_at := now() + interval '24 hours';
  if (select count(*) from public.social_stories s
      where s.user_id = new.user_id and s.expires_at > now()) >= 30 then
    raise exception 'too many live stories' using errcode = '54000';
  end if;
  return new;
end;
$$;
create trigger social_stories_before_insert before insert on public.social_stories
  for each row execute function public.social_stories_before_insert();

alter table public.social_stories enable row level security;
create policy stories_select on public.social_stories for select to authenticated
  using (expires_at > now() and public.can_see_story_author(user_id));
create policy stories_insert on public.social_stories for insert to authenticated
  with check (user_id = auth.uid());
create policy stories_delete on public.social_stories for delete to authenticated
  using (user_id = auth.uid());
-- Exactly these three: the schema's default privileges would also hand out
-- UPDATE, which RLS would quietly turn into zero rows. Refused outright instead.
revoke all on table public.social_stories from anon, authenticated;
grant select, insert, delete on table public.social_stories to authenticated;

-- ---------- views ----------
create table public.social_story_views (
  story_id uuid not null references public.social_stories (id) on delete cascade,
  viewer_id uuid not null references public.users (id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (story_id, viewer_id)
);
create index social_story_views_viewer_idx on public.social_story_views (viewer_id);

alter table public.social_story_views enable row level security;
-- You see your own views (to know what you have seen), and the views of your
-- own live stories. No insert, update or delete grant: the RPC below is the
-- only writer, and cascades clean up behind a deleted story.
create policy story_views_select on public.social_story_views for select to authenticated
  using (
    viewer_id = auth.uid()
    or exists (select 1 from public.social_stories s where s.id = story_id and s.user_id = auth.uid())
  );
revoke all on table public.social_story_views from anon, authenticated;
grant select on table public.social_story_views to authenticated;

-- ---------- RPCs ----------

-- "I opened this story." Idempotent (the primary key), silent for your own
-- story, and a not-found for anything expired or outside your audience —
-- the same answer either way, so it cannot be used to probe.
create or replace function public.social_mark_story_seen(p_story uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_author uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  select s.user_id into v_author from public.social_stories s
  where s.id = p_story and s.expires_at > now();
  if v_author is null or not public.can_see_story_author(v_author) then
    raise exception 'story not found' using errcode = 'P0002';
  end if;
  if v_author = auth.uid() then
    return false;
  end if;
  insert into public.social_story_views (story_id, viewer_id)
  values (p_story, auth.uid())
  on conflict (story_id, viewer_id) do nothing;
  return found;
end;
$$;

-- The row across the top of the feed: one entry per author with a live story
-- the caller may see. You first; then authors with something unseen; then the
-- rest; newest first within each. Names need security definer (users_select
-- hides them); the audience rule is applied here, not left to the page.
create or replace function public.social_story_tray()
returns table (
  user_id uuid, name text, avatar_url text, is_me boolean,
  stories int, unseen int, latest_at timestamptz
)
language sql stable security definer set search_path = public as $$
  with live as (
    select s.id, s.user_id, s.created_at,
           (s.user_id <> auth.uid()
            and not exists (select 1 from public.social_story_views v
                            where v.story_id = s.id and v.viewer_id = auth.uid())) as unseen
    from public.social_stories s
    where auth.uid() is not null
      and s.expires_at > now()
      and public.can_see_story_author(s.user_id)
  )
  select u.id, coalesce(u.username, u.full_name), u.avatar_url, u.id = auth.uid(),
         count(*)::int, count(*) filter (where l.unseen)::int, max(l.created_at)
  from live l
  join public.users u on u.id = l.user_id
  group by u.id
  order by (u.id = auth.uid()) desc, (count(*) filter (where l.unseen) > 0) desc, max(l.created_at) desc, u.id
  limit 100;
$$;

-- One author's live stories, oldest first (the order they are played in),
-- each with whether the caller has seen it; the view count only for the
-- author, counted over listed viewers like everything else social.
create or replace function public.social_user_stories(p_user uuid)
returns table (
  id uuid, body text, background text, created_at timestamptz, expires_at timestamptz,
  seen boolean, view_count int
)
language sql stable security definer set search_path = public as $$
  select s.id, s.body, s.background, s.created_at, s.expires_at,
         s.user_id = auth.uid()
           or exists (select 1 from public.social_story_views v
                      where v.story_id = s.id and v.viewer_id = auth.uid()),
         case when s.user_id = auth.uid() then
           (select count(*)::int from public.social_story_views v
            where v.story_id = s.id and public.is_listed_user(v.viewer_id))
         end
  from public.social_stories s
  where s.user_id = p_user
    and s.expires_at > now()
    and public.can_see_story_author(p_user)
  order by s.created_at, s.id;
$$;

-- Who has seen one of your live stories, newest first, paged. Anyone else —
-- or an expired story — gets no rows.
create or replace function public.social_story_viewers(
  p_story uuid, p_limit int default 50, p_before timestamptz default null
)
returns table (user_id uuid, name text, avatar_url text, viewed_at timestamptz)
language sql stable security definer set search_path = public as $$
  select u.id, coalesce(u.username, u.full_name), u.avatar_url, v.viewed_at
  from public.social_story_views v
  join public.social_stories s on s.id = v.story_id
  join public.users u on u.id = v.viewer_id
  where v.story_id = p_story
    and auth.uid() is not null
    and s.user_id = auth.uid()
    and s.expires_at > now()
    and public.is_listed_user(v.viewer_id)
    and (p_before is null or v.viewed_at < p_before)
  order by v.viewed_at desc, v.viewer_id
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$$;

revoke execute on function
  public.social_mark_story_seen(uuid),
  public.social_story_tray(),
  public.social_user_stories(uuid),
  public.social_story_viewers(uuid, int, timestamptz)
from public, anon;
grant execute on function
  public.social_mark_story_seen(uuid),
  public.social_story_tray(),
  public.social_user_stories(uuid),
  public.social_story_viewers(uuid, int, timestamptz)
to authenticated;
-- The trigger function is not an API.
revoke execute on function public.social_stories_before_insert() from public, anon, authenticated;
