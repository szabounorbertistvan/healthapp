-- Sharing to the feed failed for everyone: "new row violates row-level
-- security policy for table social_posts".
--
-- The app inserts a post and asks for its id back. RETURNING runs the SELECT
-- policy on the new row, and posts_select was can_see_post(id) alone — a
-- STABLE security-definer function, so it reads social_posts under the
-- snapshot the statement started with, where the row being inserted does not
-- exist yet. It answered false, and Postgres refused the whole insert. The
-- bare insert (no RETURNING) always worked, which is why RLS tests that
-- never asked for the row back stayed green.
--
-- Own rows now pass the policy directly — no function, no snapshot — and
-- everyone else's still go through can_see_post(). Nothing becomes visible
-- that was not: a user could already read their own posts through the
-- function's first branch.
drop policy if exists posts_select on public.social_posts;
create policy posts_select on public.social_posts for select to authenticated
  using (user_id = auth.uid() or public.can_see_post(id));

-- ---------- ordering guard ----------
-- Production had 20260917100000 applied before 20260916110000 (which was
-- missing). Pushing the missing one after the fact re-creates
-- request_account_deletion() with the older body, dropping the city/bio
-- wipe from 20260917100000. Re-declaring the current body here, dated after
-- both, makes the end state right whichever order they land in.
create or replace function public.request_account_deletion()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_purge timestamptz;
begin
  if v_user is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  insert into public.account_deletion_requests (user_id)
  values (v_user)
  on conflict (user_id) do update set requested_at = now()
  returning purge_after into v_purge;

  update public.users
  set full_name = 'Deleted user',
      -- users_username_format caps the handle at 24 characters, so this is
      -- 'deleted_' plus 16 hex of the uuid — exactly 24, and unique in practice.
      username = 'deleted_' || substr(replace(v_user::text, '-', ''), 1, 16),
      avatar_url = null,
      city = null,
      bio = null,
      push_token = null
  where id = v_user;

  update public.trainer_clients
  set status = 'ended', ended_at = coalesce(ended_at, now())
  where status in ('invited', 'active')
    and (client_id = v_user or coach_id = v_user);

  return jsonb_build_object('status', 'pending', 'purge_after', v_purge);
end;
$$;
