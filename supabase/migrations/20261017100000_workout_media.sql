-- Workout posts carry pictures through the media pipeline too.
--
-- WHY. Until now a workout shared after a session took its one picture the
-- old way: a public Cloudinary upload, its URL stored in the payload
-- (20261002100000) — reachable by anyone holding the link, for ever. Text and
-- progress posts moved to private, per-reader media in 20261016100000; this
-- moves the workout post onto the same rows and rules, so there is one way a
-- picture is stored and one way it is delivered. The payload photo stays
-- readable for posts made before, and the guard still accepts it, but the app
-- no longer writes it.
--
-- WHAT CHANGES.
--   · social_post_media_guard: a workout post may carry pictures, under every
--     rule it already applied (your own fresh post, uploads issued to you and
--     unused, at most ten).
--   · social_create_post: takes p_activity_id and a 'workout' type. The
--     session is named, never trusted: social_posts_guard rebuilds the
--     workout payload from the caller's own completed session (and refuses
--     anyone else's), and the partial unique index on (user_id, activity_id)
--     keeps one workout post per session. The overlay a picture carries may
--     hold the workout's figures; that is the app's normalizer's business,
--     the column only bounds its size (2 KB).

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
  if v_post.type not in ('text', 'progress', 'workout') then
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

-- ---------- creating a post with its pictures ----------
-- The signature grows a parameter, so the old one goes first: two overloads
-- that differ only by a defaulted argument would make a PostgREST call with
-- named arguments ambiguous.
drop function if exists public.social_create_post(text, text, text, jsonb, jsonb);
create function public.social_create_post(
  p_type text,
  p_text text,
  p_visibility text,
  p_payload jsonb default null,
  p_media jsonb default '[]'::jsonb,
  p_activity_id uuid default null
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
  if p_type is null or p_type not in ('text', 'progress', 'workout') then
    raise exception 'unknown post type' using errcode = '22023';
  end if;
  if p_type = 'text' and v_n = 0 and nullif(btrim(coalesce(p_text, '')), '') is null then
    raise exception 'a post needs words or a picture' using errcode = '22023';
  end if;
  -- A workout post is about one session; nothing else names one.
  if (p_type = 'workout') <> (p_activity_id is not null) then
    raise exception 'a workout post names its session, and only a workout post does' using errcode = '22023';
  end if;

  insert into public.social_posts (user_id, type, text, payload, visibility, activity_id)
  values (auth.uid(), p_type, nullif(btrim(coalesce(p_text, '')), ''), p_payload,
          coalesce(p_visibility, 'followers'), p_activity_id)
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
revoke execute on function public.social_create_post(text, text, text, jsonb, jsonb, uuid) from public, anon;
grant execute on function public.social_create_post(text, text, text, jsonb, jsonb, uuid) to authenticated;
