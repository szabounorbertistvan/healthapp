-- Media posts: up to ten pictures on a post, private at rest.
--
-- WHAT EXISTED. A text, progress or workout post could carry ONE picture as
-- fields of its payload (photo_url, photo_w, photo_h, overlay — 20261002100000).
-- The picture was a Cloudinary `type: upload` asset: public. Anyone holding the
-- URL could fetch it for ever — after the post was deleted, across a block,
-- from a suspended account's post — because a public URL checks nothing.
--
-- WHAT THIS ADDS.
--   social_post_media     one row per picture: the post, its position (0..9),
--                         the kind, the Cloudinary public_id (an
--                         `authenticated` asset: unreachable without a
--                         signature only the server holds), its pixel size,
--                         optional alt text and the overlay the author placed.
--                         Aspect ratio and the thumbnail are derived (width /
--                         height, a Cloudinary transformation), not stored.
--   social_media_uploads  every public_id the server has handed out for an
--                         upload, until it is attached to a post or discarded
--                         — the inventory that makes abandoned uploads
--                         findable and removable.
--
-- The browser never receives a Cloudinary URL for these. The app mints a
-- short-lived, signed /api/media/<token> link for each row the feed-shaped
-- RPCs return — and those return rows only for posts the reader may see
-- (can_see_post: visibility, blocks, suspension, deletion). So media is never
-- a way around the post's own rules: no row, no link; a link copied out of a
-- page dies within minutes.
--
-- The rules, all in the database (a direct PostgREST call gets the same):
--   · a picture belongs to a post of your own, created in the last ten
--     minutes, not deleted, of a type that carries pictures (text, progress);
--   · it must be an upload the server issued to YOU, not yet used or
--     discarded — so nobody can attach someone else's asset, reuse one, or
--     name a public_id out of thin air;
--   · at most ten per post, positions 0..9, one per position;
--   · images only for now: the kind column allows 'video' so the schema is
--     ready, but no pipeline exists and the guard refuses it;
--   · only an active account (20261015100000) writes; nobody updates a row;
--     rows leave with their post (cascade) — a soft-deleted post keeps its
--     rows for moderation, and the reads stop returning them.
--   · social_create_post() creates the post and its pictures in one
--     transaction (security invoker: every policy above still applies).

-- ---------- tables ----------
create table if not exists public.social_media_uploads (
  public_id text primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  kind text not null default 'image' check (kind in ('image', 'video')),
  created_at timestamptz not null default now(),
  attached_at timestamptz,
  discarded_at timestamptz,
  check (public_id ~ '^voinic/posts/[0-9a-f-]{36}/m-[0-9a-f-]{36}$')
);
create index if not exists social_media_uploads_user_idx on public.social_media_uploads (user_id, created_at);
create index if not exists social_media_uploads_pending_idx on public.social_media_uploads (user_id, created_at)
  where attached_at is null and discarded_at is null;
alter table public.social_media_uploads enable row level security;
revoke all on table public.social_media_uploads from public, anon, authenticated;
grant select on table public.social_media_uploads to authenticated;
drop policy if exists media_uploads_select on public.social_media_uploads;
create policy media_uploads_select on public.social_media_uploads for select to authenticated
  using (user_id = auth.uid());

create table if not exists public.social_post_media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.social_posts(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  position smallint not null check (position between 0 and 9),
  kind text not null default 'image' check (kind in ('image', 'video')),
  public_id text not null unique references public.social_media_uploads(public_id),
  width int not null check (width between 1 and 20000),
  height int not null check (height between 1 and 20000),
  alt text check (alt is null or (char_length(alt) between 1 and 300 and alt = btrim(alt))),
  overlay jsonb check (overlay is null or (jsonb_typeof(overlay) = 'object' and pg_column_size(overlay) <= 2048)),
  created_at timestamptz not null default now(),
  unique (post_id, position)
);
create index if not exists social_post_media_user_idx on public.social_post_media (user_id);
alter table public.social_post_media enable row level security;
revoke all on table public.social_post_media from public, anon, authenticated;
grant select on table public.social_post_media to authenticated;
grant insert (post_id, user_id, position, kind, public_id, width, height, alt, overlay)
  on table public.social_post_media to authenticated;

-- Readable exactly when the post is: visibility, blocks, suspension, deletion.
drop policy if exists post_media_select on public.social_post_media;
create policy post_media_select on public.social_post_media for select to authenticated
  using (public.can_see_post(post_id));
-- Written by an active account on its own behalf; the guard checks the rest.
drop policy if exists post_media_insert on public.social_post_media;
create policy post_media_insert on public.social_post_media for insert to authenticated
  with check (user_id = auth.uid() and public.social_actor_active());

-- ---------- the guard ----------
create or replace function public.social_post_media_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_post public.social_posts;
  v_count int;
begin
  -- The service role and the owner's own tools (a restore, a fixture) are
  -- not checked; everything signed in is.
  if auth.uid() is null then
    return new;
  end if;
  -- Locked, so two concurrent inserts cannot both be the tenth.
  select * into v_post from public.social_posts where id = new.post_id for update;
  if v_post.id is null or v_post.user_id <> auth.uid() or v_post.deleted_at is not null then
    raise exception 'post not found' using errcode = 'P0002';
  end if;
  if v_post.type not in ('text', 'progress') then
    raise exception 'this post type carries no pictures' using errcode = '22023';
  end if;
  if v_post.created_at < now() - interval '10 minutes' then
    raise exception 'pictures are added when the post is created' using errcode = '22023';
  end if;
  if new.kind <> 'image' then
    raise exception 'only pictures for now' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.social_media_uploads u
    where u.public_id = new.public_id and u.user_id = auth.uid()
      and u.attached_at is null and u.discarded_at is null
  ) then
    raise exception 'media not found' using errcode = 'P0002';
  end if;
  select count(*) into v_count from public.social_post_media where post_id = new.post_id;
  if v_count >= 10 then
    raise exception 'at most ten pictures on a post' using errcode = '22023';
  end if;
  new.user_id := auth.uid();
  new.created_at := now();
  return new;
end;
$$;
revoke execute on function public.social_post_media_guard() from public, anon, authenticated;
drop trigger if exists social_post_media_guard on public.social_post_media;
create trigger social_post_media_guard before insert on public.social_post_media
  for each row execute function public.social_post_media_guard();

create or replace function public.social_post_media_attached()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.social_media_uploads set attached_at = now()
  where public_id = new.public_id and attached_at is null;
  return null;
end;
$$;
revoke execute on function public.social_post_media_attached() from public, anon, authenticated;
drop trigger if exists social_post_media_attached on public.social_post_media;
create trigger social_post_media_attached after insert on public.social_post_media
  for each row execute function public.social_post_media_attached();

-- ---------- uploads: issue, find abandoned, discard ----------

-- The public_ids the caller may upload to, minted here. The app signs a
-- Cloudinary upload for exactly these. At most 60 in any hour per account.
create or replace function public.social_media_upload_register(p_count int default 1)
returns setof text language plpgsql security definer set search_path = public as $$
declare
  v_recent int;
begin
  if not public.social_actor_active() then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_count is null or p_count < 1 or p_count > 10 then
    raise exception 'one to ten uploads at a time' using errcode = '22023';
  end if;
  select count(*) into v_recent from public.social_media_uploads
  where user_id = auth.uid() and created_at > now() - interval '1 hour';
  if v_recent + p_count > 60 then
    raise exception 'too many uploads, try again later' using errcode = '54000';
  end if;
  return query
    with issued as (
      insert into public.social_media_uploads (public_id, user_id)
      select 'voinic/posts/' || auth.uid()::text || '/m-' || gen_random_uuid()::text, auth.uid()
      from generate_series(1, p_count)
      returning social_media_uploads.public_id
    )
    select issued.public_id from issued;
end;
$$;

-- The caller's own uploads that were never used: the ones named, or — with no
-- names — every one older than a day (abandoned). The app deletes the assets,
-- then marks them with social_media_mark_discarded.
create or replace function public.social_media_discardable(p_ids text[] default null)
returns setof text language sql stable security definer set search_path = public as $$
  select u.public_id from public.social_media_uploads u
  where u.user_id = auth.uid()
    and u.attached_at is null and u.discarded_at is null
    and (case when p_ids is null then u.created_at < now() - interval '24 hours'
              else u.public_id = any (p_ids) end)
  order by u.created_at
  limit 100;
$$;

create or replace function public.social_media_mark_discarded(p_ids text[])
returns int language plpgsql security definer set search_path = public as $$
declare
  v_n int;
begin
  update public.social_media_uploads set discarded_at = now()
  where user_id = auth.uid() and attached_at is null and discarded_at is null
    and public_id = any (coalesce(p_ids, '{}'));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ---------- creating a post with its pictures ----------
create or replace function public.social_create_post(
  p_type text,
  p_text text,
  p_visibility text,
  p_payload jsonb default null,
  p_media jsonb default '[]'::jsonb
)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_id uuid;
  v_n int;
  v_item jsonb;
  v_pos int := 0;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  p_media := coalesce(p_media, '[]'::jsonb);
  if jsonb_typeof(p_media) <> 'array' then
    raise exception 'media must be a list' using errcode = '22023';
  end if;
  v_n := jsonb_array_length(p_media);
  if v_n > 10 then
    raise exception 'at most ten pictures on a post' using errcode = '22023';
  end if;
  if p_type is null or p_type not in ('text', 'progress') then
    raise exception 'unknown post type' using errcode = '22023';
  end if;
  if p_type = 'text' and v_n = 0 and nullif(btrim(coalesce(p_text, '')), '') is null then
    raise exception 'a post needs words or a picture' using errcode = '22023';
  end if;

  insert into public.social_posts (user_id, type, text, payload, visibility)
  values (auth.uid(), p_type, nullif(btrim(coalesce(p_text, '')), ''), p_payload, coalesce(p_visibility, 'followers'))
  returning id into v_id;

  for v_item in select value from jsonb_array_elements(p_media) loop
    if jsonb_typeof(v_item) is distinct from 'object'
       or jsonb_typeof(v_item -> 'width') is distinct from 'number'
       or jsonb_typeof(v_item -> 'height') is distinct from 'number' then
      raise exception 'invalid media item' using errcode = '22023';
    end if;
    insert into public.social_post_media (post_id, user_id, position, kind, public_id, width, height, alt, overlay)
    values (
      v_id, auth.uid(), v_pos,
      coalesce(v_item ->> 'kind', 'image'),
      v_item ->> 'public_id',
      (v_item ->> 'width')::numeric::int,
      (v_item ->> 'height')::numeric::int,
      nullif(btrim(coalesce(v_item ->> 'alt', '')), ''),
      case when jsonb_typeof(v_item -> 'overlay') = 'object' then v_item -> 'overlay' end);
    v_pos := v_pos + 1;
  end loop;
  return v_id;
end;
$$;

-- ---------- the reads carry the pictures ----------

-- Internal: the pictures of a post, in order. Only ever called for a post the
-- caller's own read has already decided they may see.
create or replace function public.social_post_media_json(p_post uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'kind', m.kind, 'public_id', m.public_id,
           'width', m.width, 'height', m.height, 'alt', m.alt, 'overlay', m.overlay)
         order by m.position), '[]'::jsonb)
  from public.social_post_media m
  where m.post_id = p_post;
$$;
revoke execute on function public.social_post_media_json(uuid) from public, anon, authenticated;

-- social_feed / social_post / social_saved_posts from 20261014100000, plus `media`.
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
  edited_at timestamptz, saved boolean, shared jsonb, comment_preview jsonb, author_muted boolean, media jsonb
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
    public.social_is_muted(p.user_id),
    public.social_post_media_json(p.id)
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
  edited_at timestamptz, saved boolean, shared jsonb, author_muted boolean, media jsonb
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
    public.social_is_muted(p.user_id),
    public.social_post_media_json(p.id)
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
  edited_at timestamptz, saved boolean, shared jsonb, saved_at timestamptz, comment_preview jsonb, author_muted boolean,
  media jsonb
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
    public.social_is_muted(p.user_id),
    public.social_post_media_json(p.id)
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

-- social_shared_original from 20261013100000, plus the original's pictures.
create or replace function public.social_shared_original(p_payload jsonb)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', o.id, 'user_id', o.user_id,
    'author_name', coalesce(ou.username, ou.full_name), 'author_avatar', ou.avatar_url,
    'type', o.type, 'text', o.text, 'payload', o.payload, 'visibility', o.visibility,
    'created_at', o.created_at,
    'mentions', public.social_visible_post_mentions(o.id),
    'media', public.social_post_media_json(o.id))
  from public.social_posts o
  join public.users ou on ou.id = o.user_id
  where p_payload ->> 'kind' = 'shared_post'
    and o.id = (p_payload ->> 'original_post_id')::uuid
    and auth.uid() is not null
    and public.can_see_post(o.id)
    and public.is_listed_user(o.user_id);
$$;

-- ---------- grants ----------
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and p.proname in ('social_feed', 'social_post', 'social_saved_posts', 'social_shared_original',
                               'social_media_upload_register', 'social_media_discardable',
                               'social_media_mark_discarded', 'social_create_post') loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
