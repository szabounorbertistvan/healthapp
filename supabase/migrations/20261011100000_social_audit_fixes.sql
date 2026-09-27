-- Social 2.0 · Security & consistency audit fixes (20261003 → 20261010)
--
-- A catalog audit of every SECURITY DEFINER function, table grant, policy and
-- notification writer found five confirmed problems. This fixes them and
-- nothing else — no product rule changes. Every function body below is its
-- latest definition with the one change named; each was found by searching
-- all earlier migrations for its last definition, not by guessing a file.
--
-- 1. Stats, badges, streak and Fitness Score went around a block.
--    can_see_stats() / can_see_fitness_score() — the privacy rules behind
--    social_badges, social_streak and social_profile's stats — did not ask
--    about blocks, so someone blocked could still read the other's badges and
--    streak by calling the RPCs directly. They now ask (never for yourself),
--    and both answer false without a session: can_see_stats said "yes" to an
--    anonymous caller for anyone with public stats, which is how
--    social_streak was readable without signing in.
--
-- 2. Social reads callable without signing in. Supabase's default privileges
--    give anon EXECUTE on new functions; the RPCs from 20261003 on revoke it,
--    the older social ones did not — social_post_comments,
--    social_comment_replies and social_post_kudos returned a public post's
--    comments and Kudos givers to anyone; social_resolve_handles mapped
--    usernames to ids; notification_actors returned any id's name and face.
--    Anon now loses EXECUTE on every public.social_* function and on
--    notification_actors, can_see_stats, can_see_fitness_score.
--    notification_actors, for signed-in callers, now only names people who
--    appear in the caller's own notifications and are still visible to them
--    (it had answered for any id at all).
--
-- 3. Server-managed columns were insertable. The table-level INSERT grants
--    let a client choose created_at (a post dated in the future sits at the
--    top of every feed that shows it; comments, Kudos and follows could be
--    re-ordered the same way), edited_at and deleted_at. INSERT is now
--    granted on the columns the app sends (and a row's own id, which is
--    harmless: a client-chosen uuid cannot collide into anything) and
--    nothing else. The stray UPDATE grants on follows, reactions and
--    mentions (no update policy, so already refused by RLS) are revoked
--    too, so the grants say what the policies mean.
--
-- 4. People search matched full_name, which falls back to the e-mail address
--    at sign-up: typing part of an address tested whether it belonged to
--    someone. It now skips a full_name that is an address, as the follow-list
--    search has since 20261003100000.
--
-- 5. social_profile_programs listed the programs of someone behind a block
--    (or suspended, or being deleted) — the profile page hid them, a direct
--    call did not. It now follows the profile's own rule.
--
-- Depends on 20261003100000 … 20261010100000.

-- ---------- 2. anon loses every social RPC ----------
-- Revoking from PUBLIC could also take a function away from signed-in users
-- who only had it through PUBLIC, so whoever could call it before keeps it —
-- and the internal helpers that were already closed to them stay closed.
do $$
declare
  f regprocedure;
  v_authed boolean;
begin
  for f, v_authed in
    select p.oid::regprocedure, has_function_privilege('authenticated', p.oid, 'EXECUTE')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.proname like 'social\_%' or p.proname in ('notification_actors', 'can_see_stats', 'can_see_fitness_score'))
      and p.prokind = 'f'
  loop
    execute format('revoke execute on function %s from public, anon', f);
    if v_authed then
      execute format('grant execute on function %s to authenticated', f);
    end if;
  end loop;
end;
$$;

-- ---------- 1. stats and Fitness Score: block-aware, session required ----------
create or replace function public.can_see_stats(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (
    select 1 from public.users u
    where u.id = p_user
      and (
        u.id = auth.uid()
        or ((u.stats_visibility = 'public'
             or (u.stats_visibility = 'followers' and public.is_following(u.id))
             or public.is_active_coach_of(u.id)
             or public.is_admin())
            and not public.social_blocked_between(auth.uid(), u.id))
      )
  );
$$;

create or replace function public.can_see_fitness_score(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (
    select 1 from public.users u
    where u.id = p_user
      and (
        u.id = auth.uid()
        or ((u.fitness_score_visibility = 'public'
             or (u.fitness_score_visibility = 'followers' and public.is_following(u.id)))
            and not public.social_blocked_between(auth.uid(), u.id))
      )
  );
$$;
revoke execute on function public.can_see_stats(uuid), public.can_see_fitness_score(uuid) from public, anon;
grant execute on function public.can_see_stats(uuid), public.can_see_fitness_score(uuid) to authenticated;

-- ---------- 2b. notification actors ----------
create or replace function public.notification_actors(p_ids uuid[])
returns table (id uuid, name text, username text, avatar_url text)
language sql stable security definer set search_path = public as $$
  select u.id, coalesce(u.username, u.full_name), u.username, u.avatar_url
  from public.users u
  where u.id = any(p_ids)
    and auth.uid() is not null
    and public.is_listed_user(u.id)
    and exists (
      select 1 from public.notifications n
      where n.user_id = auth.uid()
        and u.id::text in (n.payload ->> 'actor_id', n.payload ->> 'follower_id')
    );
$$;

-- ---------- 4. people search ----------
create or replace function public.social_search_users(
  p_query text,
  p_city text default null,
  p_limit int default 20,
  p_offset int default 0
)
returns table (id uuid, name text, username text, avatar_url text, city text, is_following boolean)
language sql stable security definer set search_path = public as $$
  select u.id, coalesce(u.username, u.full_name), u.username, u.avatar_url, u.city,
         public.is_following(u.id)
  from public.users u
  where auth.uid() is not null
    and u.id <> auth.uid()
    -- someone who asked to be deleted is already anonymised; they are not findable
    and not exists (select 1 from public.account_deletion_requests d where d.user_id = u.id)
    and u.suspended_at is null
    and public.is_listed_user(u.id)
    and (
      char_length(btrim(coalesce(p_query, ''))) >= 2
      or char_length(btrim(coalesce(p_city, ''))) >= 2
    )
    and (char_length(btrim(coalesce(p_query, ''))) < 2
         or u.username ilike '%' || btrim(p_query) || '%'
         or (u.full_name not like '%@%' and u.full_name ilike '%' || btrim(p_query) || '%'))
    and (p_city is null or u.city ilike '%' || btrim(p_city) || '%')
  order by (u.username ilike btrim(coalesce(p_query, '')) || '%') desc, u.username nulls last, u.id
  limit greatest(1, least(coalesce(p_limit, 20), 50))
  offset greatest(0, least(coalesce(p_offset, 0), 1000));
$$;

-- ---------- 5. a profile's programs ----------
create or replace function public.social_profile_programs(p_user uuid, p_limit int default 6)
returns table (id uuid) language sql stable security definer set search_path = public as $$
  select p.id from public.programs p
  where coalesce(p.coach_id, p.client_id) = p_user
    and auth.uid() is not null
    and (p_user = auth.uid() or public.is_listed_user(p_user))
    and p.coach_id is null
    and p.visibility <> 'private'
    and public.can_see_program(p.id)
    and exists (select 1 from public.program_days d where d.program_id = p.id)
  order by p.updated_at desc
  limit greatest(1, least(coalesce(p_limit, 6), 20));
$$;

-- ---------- 3. inserts name only the columns the app sends ----------
revoke insert on table public.social_posts from authenticated;
grant insert (id, user_id, type, text, payload, visibility, activity_id, challenge_id) on table public.social_posts to authenticated;

revoke insert on table public.social_comments from authenticated;
grant insert (id, post_id, user_id, body, parent_id) on table public.social_comments to authenticated;

revoke insert, update on table public.social_reactions from authenticated;
grant insert (post_id, user_id, type) on table public.social_reactions to authenticated;

revoke insert, update on table public.social_follows from authenticated;
grant insert (follower_id, following_id) on table public.social_follows to authenticated;

revoke update on table public.social_post_mentions from authenticated;
revoke update on table public.social_comment_mentions from authenticated;
