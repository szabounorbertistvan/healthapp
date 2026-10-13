-- HealthApp schema · gym photos kept in Cloudinary
--
-- /api/gyms/[id]/photo asked Google for every viewer, every gym, every day —
-- a paid Place Photo call each time. Now each gym's Google photo is copied
-- ONCE to Cloudinary (owner's decision, 2026-10-13) and served from there:
--
--   gyms.photo_url         the Cloudinary delivery URL (res.cloudinary.com only)
--   gyms.photo_url_source  the Google photo name it was copied from
--
-- A gym whose photo_name (refreshed monthly) no longer matches
-- photo_url_source is in the copy queue again; until it is re-copied the old
-- picture of the same gym keeps showing. The copying itself is the admin's
-- server action (it needs the Google key and the Cloudinary secret);
-- admin_gym_photo_queue() hands it the next gyms, admin_set_gym_photo()
-- records the result.

alter table public.gyms
  add column photo_url text check (photo_url is null or (photo_url like 'https://res.cloudinary.com/%' and length(photo_url) <= 500)),
  add column photo_url_source text check (photo_url_source is null or length(photo_url_source) <= 500);

/** The next gyms whose Google photo is not (or no longer) in Cloudinary, and how many wait. */
create or replace function public.admin_gym_photo_queue(p_limit int default 10)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.admin_assert();
  return jsonb_build_object(
    'remaining', (select count(*) from public.gyms g
                  where g.status = 'active' and g.photo_name is not null
                    and g.photo_url_source is distinct from g.photo_name),
    'gyms', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'photo_name', x.photo_name))
      from (select g.id, g.photo_name from public.gyms g
            where g.status = 'active' and g.photo_name is not null
              and g.photo_url_source is distinct from g.photo_name
            order by g.created_at, g.id
            limit least(greatest(coalesce(p_limit, 10), 1), 50)) x), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.admin_gym_photo_queue(int) from public, anon;
grant execute on function public.admin_gym_photo_queue(int) to authenticated;

/**
 * Record a copied photo. p_source must still be the gym's current Google
 * photo, so a copy that raced a refresh is not recorded against the new one.
 * A null p_url marks the photo as uncopyable (Google refused it) so the queue
 * moves on; the page then shows no photo rather than a paid Google call.
 */
create or replace function public.admin_set_gym_photo(p_id uuid, p_url text, p_source text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_assert();
  if p_url is not null and (p_url not like 'https://res.cloudinary.com/%' or length(p_url) > 500) then
    raise exception 'GYM_PHOTO' using errcode = '22023';
  end if;
  update public.gyms
     set photo_url = p_url, photo_url_source = p_source
   where id = p_id and photo_name is not distinct from p_source;
end;
$$;
revoke execute on function public.admin_set_gym_photo(uuid, text, text) from public, anon;
grant execute on function public.admin_set_gym_photo(uuid, text, text) to authenticated;
