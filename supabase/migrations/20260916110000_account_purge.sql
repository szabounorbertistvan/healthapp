-- Account deletion, second half (spec G2).
--
-- 20260823001200 shipped request_account_deletion(): it stamps the request,
-- anonymises the profile and ends every coaching relationship immediately, and
-- the table carries a purge_after 30 days out. Nothing ever acted on that
-- column, so until now a "deleted" account was only hidden — the rows, and the
-- email in auth.users, lived for ever. Pseudonymising is not erasing, so this
-- adds the job that finishes the promise.
--
-- Two things make a naive `delete from auth.users` fail or destroy other
-- people's data, and both are handled below.
--
-- 1. `exercises.owner_id` cascades, but `program_exercises.exercise_id` and
--    `logged_sets.exercise_id` reference exercises with no cascade at all. A
--    coach who built a custom exercise that any client still has in a program
--    could therefore never be deleted — the delete would abort on a foreign
--    key. Their exercises are handed to the system library instead (owner_id
--    null). An exercise name is not personal data, and the client's program
--    must not lose its rows because their old coach left.
-- 2. `programs.coach_id` and `nutrition_plans.coach_id` are already
--    `on delete set null`, so a departing coach leaves the client's plans
--    standing. That is deliberate and this job relies on it.
--
-- Everything else reaches users by `on delete cascade`, so removing the
-- auth.users row removes the account's own rows in one statement.

create or replace function public.purge_deleted_accounts()
returns int language plpgsql security definer set search_path = public as $$
declare
  v_users uuid[];
  v_user uuid;
  v_count int := 0;
begin
  -- Collect first. Deleting an account cascades into
  -- account_deletion_requests, so iterating a live cursor over the same table
  -- would be reading rows out from under the delete.
  select coalesce(array_agg(user_id), '{}'::uuid[])
  into v_users
  from public.account_deletion_requests
  where status = 'pending' and purge_after <= now();

  foreach v_user in array v_users loop
    -- Hand the account's exercises to the system library rather than letting
    -- them cascade away (see note 1): a client's program still points at them,
    -- and program_exercises.exercise_id would refuse the delete.
    update public.exercises set owner_id = null where owner_id = v_user;

    -- One delete. public.users hangs off auth.users, and everything personal
    -- hangs off public.users, so the cascade does the rest — including this
    -- account's own row in account_deletion_requests, which is why nothing
    -- here marks it 'completed': there is no row left to mark.
    delete from auth.users where id = v_user;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

comment on function public.purge_deleted_accounts() is
  'Erases accounts whose 30-day deletion window has passed. Cron only.';

-- Service role / cron only: this is the one function in the schema that can
-- destroy an account, and no session token should be able to reach it.
revoke execute on function public.purge_deleted_accounts() from public, anon, authenticated;

-- Storage objects (progress photos, set videos) are not reachable from SQL
-- here; they are removed by the same service-role task that owns the bucket.
-- Nothing writes to those buckets yet, so there is nothing orphaned today —
-- this note is the reminder for when upload ships.

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    -- Daily at 03:30 UTC. The window is 30 days; the hour does not matter, and
    -- staying off the top of the hour keeps it clear of the two hourly jobs.
    perform cron.schedule('purge-deleted-accounts', '30 3 * * *',
      $cron$ select public.purge_deleted_accounts(); $cron$);
  end if;
end;
$$;

-- ---------- the hiding half, tightened ----------
-- The original request_account_deletion() blanked full_name, avatar and push
-- token but left `username` — the handle other people actually search on and
-- see on a post, so the account stayed findable for the whole 30 days. It is
-- now replaced with an opaque, still-unique value rather than set to null:
-- null means "profile incomplete", which both layouts answer by redirecting to
-- /complete-profile, where the person could simply pick a new handle and undo
-- the hiding.
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
      push_token = null
  where id = v_user;

  update public.trainer_clients
  set status = 'ended', ended_at = coalesce(ended_at, now())
  where status in ('invited', 'active')
    and (client_id = v_user or coach_id = v_user);

  return jsonb_build_object('status', 'pending', 'purge_after', v_purge);
end;
$$;
