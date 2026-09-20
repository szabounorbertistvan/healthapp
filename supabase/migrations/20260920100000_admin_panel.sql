-- HealthApp schema · admin panel
--
-- The admin desk grows from three translation tabs into an operations panel:
-- overview KPIs, a paginated user directory, a per-user history, an audit log,
-- auth / invitation / training / nutrition / social / challenge / push
-- analytics, system health and a global search. Everything it reads that a
-- signed-in user could not read under RLS comes through the security-definer
-- functions below, and every one of them starts with admin_assert(). The
-- route prefix is not the boundary; these functions are.
--
-- Four parts:
--
-- 1. admin_audit_events — an append-only stream. Triggers on the tables that
--    matter write it (sign-up, login, role change, invitations, workouts,
--    sets, exercises, challenges, social, push subscriptions); the admin
--    actions write it explicitly. `authenticated` may only SELECT it, and only
--    when is_admin(); UPDATE and DELETE are refused by a trigger for every
--    role that is not the table owner. Actor and target ids are plain uuids
--    with no foreign key on purpose — the log must outlive the account.
--
-- 2. users.suspended_at / suspended_reason — the one moderation state the
--    panel can set. The app layouts refuse a suspended account; the RPC that
--    sets it is the only writer and logs the change.
--
-- 3. record_login_failure() — GoTrue does not record a wrong password
--    anywhere the app can read, so the login form reports one here through a
--    server action. Metadata only: the email typed, the caller's IP and user
--    agent. Never the password. Flood-capped so a bot cannot fill the table.
--
-- 4. The admin_* read functions. Each returns jsonb or a row set already
--    aggregated — the dashboard is one round trip, the user list is one, the
--    user page is two. Email, last sign-in and provider come from auth.users
--    and auth.identities inside these functions and nowhere else.

-- ============================================================================
-- 0. admin_assert
-- ============================================================================
create or replace function public.admin_assert()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'ADMIN_ONLY' using errcode = '42501';
  end if;
end;
$$;
revoke execute on function public.admin_assert() from public, anon;
grant execute on function public.admin_assert() to authenticated;

-- ============================================================================
-- 1. audit events
-- ============================================================================
create type public.audit_action as enum (
  'USER_CREATED', 'USER_LOGIN', 'LOGIN_FAILED', 'ROLE_CHANGED',
  'USER_SUSPENDED', 'USER_REACTIVATED', 'ACCOUNT_DELETION_REQUESTED', 'TIER_CHANGED',
  'INVITATION_CREATED', 'INVITATION_ACCEPTED', 'INVITATION_REVOKED', 'RELATIONSHIP_ENDED',
  'PROGRAM_CREATED', 'PROGRAM_UPDATED', 'PROGRAM_DELETED',
  'WORKOUT_STARTED', 'WORKOUT_COMPLETED', 'WORKOUT_DELETED',
  'SET_LOGGED', 'SET_EDITED', 'SET_DELETED',
  'EXERCISE_CREATED', 'EXERCISE_UPDATED', 'EXERCISE_DELETED',
  'CHALLENGE_CREATED', 'CHALLENGE_JOINED', 'CHALLENGE_COMPLETED',
  'POST_CREATED', 'POST_DELETED', 'COMMENT_CREATED', 'COMMENT_DELETED',
  'KUDOS_ADDED', 'KUDOS_REMOVED', 'FOLLOW_CREATED', 'FOLLOW_REMOVED',
  'PUSH_SUBSCRIBED', 'PUSH_UNSUBSCRIBED',
  'ADMIN_ACTION'
);

create table public.admin_audit_events (
  id bigint generated always as identity primary key,
  -- null = the platform itself (a trigger fired by a service-role write, a
  -- cron job) or an anonymous caller (a failed login).
  actor_user_id uuid,
  actor_role text,
  action public.audit_action not null,
  entity_type text,
  entity_id text,
  target_user_id uuid,
  metadata jsonb not null default '{}' check (jsonb_typeof(metadata) = 'object'),
  ip text check (ip is null or length(ip) <= 64),
  user_agent text check (user_agent is null or length(user_agent) <= 512),
  created_at timestamptz not null default now()
);
create index admin_audit_events_created_idx on public.admin_audit_events (created_at desc);
create index admin_audit_events_actor_idx on public.admin_audit_events (actor_user_id, created_at desc);
create index admin_audit_events_target_idx on public.admin_audit_events (target_user_id, created_at desc);
create index admin_audit_events_action_idx on public.admin_audit_events (action, created_at desc);
create index admin_audit_events_entity_idx on public.admin_audit_events (entity_type, entity_id);

alter table public.admin_audit_events enable row level security;
create policy audit_admin_read on public.admin_audit_events for select to authenticated
  using (public.is_admin());
-- 20260826075027 grants insert/update/delete on every new table by default;
-- this one is read-only for the API roles. Writers are the owner-run
-- functions below.
revoke insert, update, delete on table public.admin_audit_events from authenticated, anon;
revoke all on table public.admin_audit_events from anon;

-- Append-only: rows are never edited or removed by anyone reaching the table
-- through the API. The owner (migrations, maintenance) is exempt so a
-- retention job can exist one day.
create or replace function public.admin_audit_events_immutable()
returns trigger language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon', 'service_role') then
    raise exception 'AUDIT_LOG_IS_APPEND_ONLY' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger admin_audit_events_immutable
  before update or delete on public.admin_audit_events
  for each row execute function public.admin_audit_events_immutable();

-- The one writer. Not granted to any API role: triggers and the admin RPCs
-- call it as the owner.
create or replace function public.audit_log(
  p_action public.audit_action,
  p_entity_type text default null,
  p_entity_id text default null,
  p_target_user uuid default null,
  p_metadata jsonb default '{}',
  p_actor uuid default null,
  p_ip text default null,
  p_user_agent text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := coalesce(p_actor, auth.uid());
begin
  insert into public.admin_audit_events
    (actor_user_id, actor_role, action, entity_type, entity_id, target_user_id, metadata, ip, user_agent)
  values (
    v_actor,
    (select role::text from public.users where id = v_actor),
    p_action, p_entity_type, p_entity_id, p_target_user,
    coalesce(p_metadata, '{}'::jsonb),
    left(p_ip, 64), left(p_user_agent, 512)
  );
end;
$$;
revoke execute on function public.audit_log(public.audit_action, text, text, uuid, jsonb, uuid, text, text)
  from public, anon, authenticated;

-- ---------- triggers ----------
-- Every trigger function is security definer so the insert succeeds whoever
-- fired the statement; each one only reads the row it was handed.

create or replace function public.audit_users()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.audit_log('USER_CREATED', 'user', new.id::text, new.id,
      jsonb_build_object('role', new.role::text), new.id);
  elsif tg_op = 'UPDATE' and old.role is distinct from new.role then
    perform public.audit_log('ROLE_CHANGED', 'user', new.id::text, new.id,
      jsonb_build_object('from', old.role::text, 'to', new.role::text));
  end if;
  return new;
end;
$$;
create trigger audit_users after insert or update of role on public.users
  for each row execute function public.audit_users();

-- A login is GoTrue stamping last_sign_in_at. The provider it records is the
-- primary one on the account (raw_app_meta_data.provider).
create or replace function public.audit_auth_login()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.last_sign_in_at is not null and old.last_sign_in_at is distinct from new.last_sign_in_at then
    perform public.audit_log('USER_LOGIN', 'user', new.id::text, new.id,
      jsonb_build_object('provider', coalesce(new.raw_app_meta_data ->> 'provider', 'email')), new.id);
  end if;
  return new;
end;
$$;
create trigger audit_auth_login after update of last_sign_in_at on auth.users
  for each row execute function public.audit_auth_login();

create or replace function public.audit_trainer_clients()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.audit_log('INVITATION_CREATED', 'invitation', new.id::text, new.client_id,
      jsonb_build_object('expires_at', new.invite_expires_at), new.coach_id);
  elsif tg_op = 'UPDATE' and old.status is distinct from new.status then
    if new.status = 'active' then
      perform public.audit_log('INVITATION_ACCEPTED', 'invitation', new.id::text, new.coach_id,
        '{}'::jsonb, new.client_id);
    elsif new.status = 'ended' and old.status = 'invited' then
      perform public.audit_log('INVITATION_REVOKED', 'invitation', new.id::text, new.client_id, '{}'::jsonb);
    elsif new.status = 'ended' then
      perform public.audit_log('RELATIONSHIP_ENDED', 'invitation', new.id::text,
        case when auth.uid() = new.coach_id then new.client_id else new.coach_id end, '{}'::jsonb);
    end if;
  end if;
  return new;
end;
$$;
create trigger audit_trainer_clients after insert or update of status on public.trainer_clients
  for each row execute function public.audit_trainer_clients();

create or replace function public.audit_programs()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.audit_log('PROGRAM_CREATED', 'program', new.id::text, new.client_id,
      jsonb_build_object('name', new.name, 'status', new.status::text));
  elsif tg_op = 'UPDATE' then
    if old.status is distinct from new.status or old.name is distinct from new.name then
      perform public.audit_log('PROGRAM_UPDATED', 'program', new.id::text, new.client_id,
        jsonb_build_object('name', new.name, 'status', new.status::text));
    end if;
  elsif tg_op = 'DELETE' then
    perform public.audit_log('PROGRAM_DELETED', 'program', old.id::text, old.client_id,
      jsonb_build_object('name', old.name));
    return old;
  end if;
  return new;
end;
$$;
create trigger audit_programs after insert or update or delete on public.programs
  for each row execute function public.audit_programs();

create or replace function public.audit_logged_sessions()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.audit_log(
      case when new.completed_at is null then 'WORKOUT_STARTED' else 'WORKOUT_COMPLETED' end::public.audit_action,
      'session', new.id::text, new.user_id, '{}'::jsonb, new.user_id);
  elsif tg_op = 'UPDATE' and old.completed_at is null and new.completed_at is not null then
    perform public.audit_log('WORKOUT_COMPLETED', 'session', new.id::text, new.user_id,
      jsonb_build_object('duration_min',
        greatest(0, round(extract(epoch from (new.completed_at - new.started_at)) / 60))::int),
      new.user_id);
  elsif tg_op = 'DELETE' then
    perform public.audit_log('WORKOUT_DELETED', 'session', old.id::text, old.user_id, '{}'::jsonb);
    return old;
  end if;
  return new;
end;
$$;
create trigger audit_logged_sessions after insert or update of completed_at or delete on public.logged_sessions
  for each row execute function public.audit_logged_sessions();

create or replace function public.audit_logged_sets()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r public.logged_sets;
  v_meta jsonb;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  v_meta := jsonb_build_object(
    'exercise_id', r.exercise_id,
    'exercise', (select e.name_en from public.exercises e where e.id = r.exercise_id),
    'reps', r.reps, 'weight_kg', r.weight_kg, 'set_index', r.set_index);
  if tg_op = 'INSERT' then
    perform public.audit_log('SET_LOGGED', 'set', new.id::text, new.user_id, v_meta, new.user_id);
  elsif tg_op = 'UPDATE' then
    if old.reps is distinct from new.reps or old.weight_kg is distinct from new.weight_kg
       or old.rpe is distinct from new.rpe or old.rir is distinct from new.rir then
      perform public.audit_log('SET_EDITED', 'set', new.id::text, new.user_id,
        v_meta || jsonb_build_object('from', jsonb_build_object('reps', old.reps, 'weight_kg', old.weight_kg)));
    end if;
  elsif tg_op = 'DELETE' then
    perform public.audit_log('SET_DELETED', 'set', old.id::text, old.user_id, v_meta);
    return old;
  end if;
  return new;
end;
$$;
create trigger audit_logged_sets after insert or update or delete on public.logged_sets
  for each row execute function public.audit_logged_sets();

create or replace function public.audit_exercises()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.audit_log('EXERCISE_CREATED', 'exercise', new.id::text, new.owner_id,
      jsonb_build_object('name', new.name_en, 'source', new.source));
  elsif tg_op = 'UPDATE' then
    perform public.audit_log('EXERCISE_UPDATED', 'exercise', new.id::text, new.owner_id,
      jsonb_build_object('name', new.name_en,
        'changed', (select coalesce(jsonb_agg(k), '[]'::jsonb) from (
          select key as k from jsonb_each(to_jsonb(new)) n
          where n.value is distinct from (to_jsonb(old) -> n.key) and n.key <> 'updated_at') c)));
  elsif tg_op = 'DELETE' then
    perform public.audit_log('EXERCISE_DELETED', 'exercise', old.id::text, old.owner_id,
      jsonb_build_object('name', old.name_en));
    return old;
  end if;
  return new;
end;
$$;
create trigger audit_exercises after insert or update or delete on public.exercises
  for each row execute function public.audit_exercises();

create or replace function public.audit_challenges()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.audit_log('CHALLENGE_CREATED', 'challenge', new.id::text, new.creator_id,
    jsonb_build_object('title', new.title_en, 'type', new.type, 'visibility', new.visibility));
  return new;
end;
$$;
create trigger audit_challenges after insert on public.challenges
  for each row execute function public.audit_challenges();

create or replace function public.audit_challenge_participants()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.audit_log('CHALLENGE_JOINED', 'challenge', new.challenge_id::text, new.user_id,
      '{}'::jsonb, new.user_id);
  elsif tg_op = 'UPDATE' and old.completed_at is null and new.completed_at is not null then
    perform public.audit_log('CHALLENGE_COMPLETED', 'challenge', new.challenge_id::text, new.user_id,
      '{}'::jsonb, new.user_id);
  end if;
  return new;
end;
$$;
create trigger audit_challenge_participants after insert or update of completed_at on public.challenge_participants
  for each row execute function public.audit_challenge_participants();

create or replace function public.audit_social_posts()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.audit_log('POST_CREATED', 'post', new.id::text, new.user_id,
      jsonb_build_object('type', new.type, 'visibility', new.visibility), new.user_id);
  elsif tg_op = 'UPDATE' and old.deleted_at is null and new.deleted_at is not null then
    perform public.audit_log('POST_DELETED', 'post', new.id::text, new.user_id,
      jsonb_build_object('type', new.type, 'by_admin', auth.uid() is distinct from new.user_id));
  end if;
  return new;
end;
$$;
create trigger audit_social_posts after insert or update of deleted_at on public.social_posts
  for each row execute function public.audit_social_posts();

create or replace function public.audit_social_comments()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.audit_log('COMMENT_CREATED', 'comment', new.id::text,
      (select p.user_id from public.social_posts p where p.id = new.post_id),
      jsonb_build_object('post_id', new.post_id), new.user_id);
  elsif tg_op = 'DELETE' then
    perform public.audit_log('COMMENT_DELETED', 'comment', old.id::text,
      (select p.user_id from public.social_posts p where p.id = old.post_id),
      jsonb_build_object('post_id', old.post_id));
    return old;
  end if;
  return new;
end;
$$;
create trigger audit_social_comments after insert or delete on public.social_comments
  for each row execute function public.audit_social_comments();

create or replace function public.audit_social_reactions()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r public.social_reactions;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  perform public.audit_log(
    case when tg_op = 'INSERT' then 'KUDOS_ADDED' else 'KUDOS_REMOVED' end::public.audit_action,
    'post', r.post_id::text,
    (select p.user_id from public.social_posts p where p.id = r.post_id),
    '{}'::jsonb, r.user_id);
  return r;
end;
$$;
create trigger audit_social_reactions after insert or delete on public.social_reactions
  for each row execute function public.audit_social_reactions();

create or replace function public.audit_social_follows()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r public.social_follows;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  perform public.audit_log(
    case when tg_op = 'INSERT' then 'FOLLOW_CREATED' else 'FOLLOW_REMOVED' end::public.audit_action,
    'user', r.following_id::text, r.following_id, '{}'::jsonb, r.follower_id);
  return r;
end;
$$;
create trigger audit_social_follows after insert or delete on public.social_follows
  for each row execute function public.audit_social_follows();

-- Never the endpoint or the keys: the browser family is all the log keeps.
create or replace function public.audit_push_subscriptions()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r public.push_subscriptions;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  perform public.audit_log(
    case when tg_op = 'INSERT' then 'PUSH_SUBSCRIBED' else 'PUSH_UNSUBSCRIBED' end::public.audit_action,
    'push_subscription', r.id::text, r.user_id,
    jsonb_build_object('user_agent', left(r.user_agent, 160)), r.user_id);
  return r;
end;
$$;
create trigger audit_push_subscriptions after insert or delete on public.push_subscriptions
  for each row execute function public.audit_push_subscriptions();

create or replace function public.audit_deletion_requests()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.audit_log('ACCOUNT_DELETION_REQUESTED', 'user', new.user_id::text, new.user_id,
    jsonb_build_object('purge_after', new.purge_after), new.user_id);
  return new;
end;
$$;
create trigger audit_deletion_requests after insert on public.account_deletion_requests
  for each row execute function public.audit_deletion_requests();

-- ---------- failed logins ----------
-- Callable anonymously (the caller has, by definition, no session). Capped at
-- 120 rows a minute platform-wide so it cannot be used to fill the disk.
create or replace function public.record_login_failure(p_email text, p_ip text default null, p_user_agent text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(left(trim(coalesce(p_email, '')), 254));
begin
  if v_email = '' then
    return;
  end if;
  if (select count(*) from public.admin_audit_events
      where action = 'LOGIN_FAILED' and created_at > now() - interval '1 minute') >= 120 then
    return;
  end if;
  perform public.audit_log('LOGIN_FAILED', 'email', v_email,
    (select u.id from auth.users u where lower(u.email) = v_email),
    jsonb_build_object('email', v_email), null, p_ip, p_user_agent);
end;
$$;
grant execute on function public.record_login_failure(text, text, text) to anon, authenticated;

-- ============================================================================
-- 2. suspension
-- ============================================================================
alter table public.users
  add column if not exists suspended_at timestamptz,
  add column if not exists suspended_reason text check (suspended_reason is null or length(suspended_reason) <= 500);
-- The column grant is column-level since 20260907110000 and these are not on
-- it: only the RPCs below write them.

create or replace function public.admin_set_suspended(p_user uuid, p_suspended boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_role text;
begin
  perform public.admin_assert();
  if p_user = auth.uid() then
    raise exception 'CANNOT_SUSPEND_SELF' using errcode = '22023';
  end if;
  select role::text into v_role from public.users where id = p_user;
  if v_role is null then
    raise exception 'USER_NOT_FOUND' using errcode = '22023';
  end if;
  if v_role = 'admin' and p_suspended then
    raise exception 'CANNOT_SUSPEND_ADMIN' using errcode = '22023';
  end if;
  update public.users
     set suspended_at = case when p_suspended then now() else null end,
         suspended_reason = case when p_suspended then left(p_reason, 500) else null end
   where id = p_user;
  perform public.audit_log(
    case when p_suspended then 'USER_SUSPENDED' else 'USER_REACTIVATED' end::public.audit_action,
    'user', p_user::text, p_user, jsonb_build_object('reason', left(p_reason, 500)));
end;
$$;
revoke execute on function public.admin_set_suspended(uuid, boolean, text) from public, anon;
grant execute on function public.admin_set_suspended(uuid, boolean, text) to authenticated;

-- ============================================================================
-- 3. other admin actions
-- ============================================================================
create or replace function public.admin_revoke_invitation(p_invitation uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_row public.trainer_clients;
begin
  perform public.admin_assert();
  select * into v_row from public.trainer_clients where id = p_invitation for update;
  if not found then
    raise exception 'INVITATION_NOT_FOUND' using errcode = '22023';
  end if;
  if v_row.status <> 'invited' then
    raise exception 'INVITATION_NOT_PENDING' using errcode = '22023';
  end if;
  update public.trainer_clients
     set status = 'ended', ended_at = now(), invite_code = null, invite_expires_at = null
   where id = p_invitation;
  perform public.audit_log('ADMIN_ACTION', 'invitation', p_invitation::text, v_row.coach_id,
    jsonb_build_object('kind', 'revoke_invitation'));
end;
$$;
revoke execute on function public.admin_revoke_invitation(uuid) from public, anon;
grant execute on function public.admin_revoke_invitation(uuid) to authenticated;

-- Soft delete, the same mark the author's own delete leaves.
create or replace function public.admin_delete_post(p_post uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_author uuid;
begin
  perform public.admin_assert();
  update public.social_posts set deleted_at = now()
   where id = p_post and deleted_at is null
   returning user_id into v_author;
  if v_author is null then
    raise exception 'POST_NOT_FOUND' using errcode = '22023';
  end if;
  perform public.audit_log('ADMIN_ACTION', 'post', p_post::text, v_author,
    jsonb_build_object('kind', 'delete_post', 'reason', left(p_reason, 500)));
end;
$$;
revoke execute on function public.admin_delete_post(uuid, text) from public, anon;
grant execute on function public.admin_delete_post(uuid, text) to authenticated;

create or replace function public.admin_remove_push_subscription(p_subscription uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_user uuid;
begin
  perform public.admin_assert();
  delete from public.push_subscriptions where id = p_subscription returning user_id into v_user;
  if v_user is null then
    raise exception 'SUBSCRIPTION_NOT_FOUND' using errcode = '22023';
  end if;
  perform public.audit_log('ADMIN_ACTION', 'push_subscription', p_subscription::text, v_user,
    jsonb_build_object('kind', 'remove_push_subscription'));
end;
$$;
revoke execute on function public.admin_remove_push_subscription(uuid) from public, anon;
grant execute on function public.admin_remove_push_subscription(uuid) to authenticated;

-- admin_set_tier (20260826090000) predates the log; same body, now audited.
create or replace function public.admin_set_tier(target_user uuid, new_tier text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_old text;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;
  if new_tier not in ('free', 'premium', 'coach_free', 'coach_pro') then
    raise exception 'BAD_TIER';
  end if;
  select tier into v_old from public.subscriptions where user_id = target_user;
  insert into public.subscriptions (user_id, tier, status, provider)
  values (target_user, new_tier, 'active',
          case when new_tier = 'free' then 'manual' else 'admin' end)
  on conflict (user_id) do update set
    tier = excluded.tier,
    status = 'active',
    provider = excluded.provider,
    current_period_end = null;
  perform public.audit_log('TIER_CHANGED', 'user', target_user::text, target_user,
    jsonb_build_object('from', v_old, 'to', new_tier));
end;
$$;

-- ============================================================================
-- 4. reads
-- ============================================================================

-- ---------- 4a. what "active" means ----------
-- One row per user with their last touch of each engine. Used only inside the
-- admin functions; not granted to anyone.
create or replace function public.admin_user_activity()
returns table (
  user_id uuid,
  workouts bigint, workouts_7d bigint, workouts_30d bigint,
  sets bigint, sets_7d bigint,
  last_workout_at timestamptz, last_food_log_at timestamptz, last_habit_at timestamptz,
  last_check_in_at timestamptz, last_post_at timestamptz, last_measurement_at timestamptz,
  last_activity_at timestamptz
) language sql stable security definer set search_path = public as $$
  with ls as (
    select s.user_id,
           count(*) filter (where s.completed_at is not null) as workouts,
           count(*) filter (where s.completed_at is not null and s.started_at > now() - interval '7 days') as workouts_7d,
           count(*) filter (where s.completed_at is not null and s.started_at > now() - interval '30 days') as workouts_30d,
           max(s.started_at) as last_workout_at
    from public.logged_sessions s group by s.user_id
  ),
  st as (
    select user_id, count(*) as sets,
           count(*) filter (where received_at > now() - interval '7 days') as sets_7d
    from public.logged_sets group by user_id
  ),
  fl as (select user_id, max(received_at) as at from public.food_logs group by user_id),
  hl as (select user_id, max(received_at) as at from public.habit_logs group by user_id),
  ci as (select user_id, max(submitted_at) as at from public.check_ins group by user_id),
  sp as (select user_id, max(created_at) as at from public.social_posts group by user_id),
  ms as (select user_id, max(created_at) as at from public.measurements group by user_id)
  select u.id,
         coalesce(ls.workouts, 0), coalesce(ls.workouts_7d, 0), coalesce(ls.workouts_30d, 0),
         coalesce(st.sets, 0), coalesce(st.sets_7d, 0),
         ls.last_workout_at, fl.at, hl.at, ci.at, sp.at, ms.at,
         greatest(ls.last_workout_at, fl.at, hl.at, ci.at, sp.at, ms.at)
  from public.users u
  left join ls on ls.user_id = u.id
  left join st on st.user_id = u.id
  left join fl on fl.user_id = u.id
  left join hl on hl.user_id = u.id
  left join ci on ci.user_id = u.id
  left join sp on sp.user_id = u.id
  left join ms on ms.user_id = u.id;
$$;
revoke execute on function public.admin_user_activity() from public, anon, authenticated;

-- Users who touched anything on a given UTC day. Shared by the series and the
-- overview so "active today" means one thing.
create or replace function public.admin_active_user_ids(p_from timestamptz, p_to timestamptz)
returns table (user_id uuid) language sql stable security definer set search_path = public as $$
  select user_id from public.logged_sessions where started_at >= p_from and started_at < p_to
  union select user_id from public.food_logs where received_at >= p_from and received_at < p_to
  union select user_id from public.habit_logs where received_at >= p_from and received_at < p_to
  union select user_id from public.check_ins where submitted_at >= p_from and submitted_at < p_to
  union select user_id from public.social_posts where created_at >= p_from and created_at < p_to
  union select user_id from public.social_comments where created_at >= p_from and created_at < p_to
  union select user_id from public.measurements where created_at >= p_from and created_at < p_to;
$$;
revoke execute on function public.admin_active_user_ids(timestamptz, timestamptz) from public, anon, authenticated;

-- auth.audit_log_entries carries actor_id as text; never trust it to cast.
create or replace function public.admin_uuid_or_null(p text)
returns uuid language sql immutable strict as $$
  select case when p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p::uuid end;
$$;
revoke execute on function public.admin_uuid_or_null(text) from public, anon, authenticated;

-- ---------- 4b. overview ----------
create or replace function public.admin_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_today timestamptz := date_trunc('day', now());
  v_7d timestamptz := now() - interval '7 days';
  v_30d timestamptz := now() - interval '30 days';
  v_users jsonb; v_activity jsonb; v_auth jsonb; v_inv jsonb; v_social jsonb; v_system jsonb;
begin
  perform public.admin_assert();

  select jsonb_build_object(
    'total', count(*),
    'clients', count(*) filter (where role in ('client', 'both')),
    'coaches', count(*) filter (where role in ('coach', 'both')),
    'admins', count(*) filter (where role = 'admin'),
    'suspended', count(*) filter (where suspended_at is not null),
    'created_today', count(*) filter (where created_at >= v_today),
    'created_7d', count(*) filter (where created_at >= v_7d),
    'created_30d', count(*) filter (where created_at >= v_30d),
    'active_30d', (select count(*) from public.admin_user_activity() a where a.last_activity_at >= v_30d),
    'inactive_30d', count(*) - (select count(*) from public.admin_user_activity() a where a.last_activity_at >= v_30d),
    'with_coach', (select count(distinct client_id) from public.trainer_clients where status = 'active'),
    'deletion_pending', (select count(*) from public.account_deletion_requests where status = 'pending')
  ) into v_users from public.users;

  select jsonb_build_object(
    'workouts_today', (select count(*) from public.logged_sessions where completed_at >= v_today),
    'workouts_7d', (select count(*) from public.logged_sessions where completed_at >= v_7d),
    'workouts_30d', (select count(*) from public.logged_sessions where completed_at >= v_30d),
    'sets_today', (select count(*) from public.logged_sets where received_at >= v_today),
    'sets_7d', (select count(*) from public.logged_sets where received_at >= v_7d),
    'active_today', (select count(*) from public.admin_active_user_ids(v_today, now() + interval '1 day')),
    'active_7d', (select count(*) from public.admin_active_user_ids(v_7d, now() + interval '1 day')),
    'active_30d', (select count(*) from public.admin_active_user_ids(v_30d, now() + interval '1 day')),
    'streak_users', (
      -- someone with a completed workout yesterday or today, in UTC: a
      -- current streak by the same rule social_streak() uses, without the
      -- per-user timezone fold
      select count(distinct user_id) from public.logged_sessions
      where completed_at is not null and started_at >= v_today - interval '1 day'),
    'food_logs_today', (select count(*) from public.food_logs where received_at >= v_today),
    'food_logs_7d', (select count(*) from public.food_logs where received_at >= v_7d),
    'challenges_active', (select count(*) from public.challenges where start_date <= current_date and end_date >= current_date),
    'challenge_participants_active', (
      select count(*) from public.challenge_participants cp
      join public.challenges c on c.id = cp.challenge_id
      where c.start_date <= current_date and c.end_date >= current_date),
    'programs_published', (select count(*) from public.programs where status = 'published'),
    'habits_active', (select count(*) from public.habits where active)
  ) into v_activity;

  select jsonb_build_object(
    'logins_total', (select count(*) from auth.audit_log_entries where payload ->> 'action' = 'login'),
    'logins_today', (select count(*) from auth.audit_log_entries where payload ->> 'action' = 'login' and created_at >= v_today),
    'logins_7d', (select count(*) from auth.audit_log_entries where payload ->> 'action' = 'login' and created_at >= v_7d),
    'logins_30d', (select count(*) from auth.audit_log_entries where payload ->> 'action' = 'login' and created_at >= v_30d),
    'failed_total', (select count(*) from public.admin_audit_events where action = 'LOGIN_FAILED'),
    'failed_24h', (select count(*) from public.admin_audit_events where action = 'LOGIN_FAILED' and created_at >= now() - interval '1 day'),
    'google_accounts', (select count(*) from auth.identities where provider = 'google'),
    'email_accounts', (select count(*) from auth.identities where provider = 'email'),
    'never_logged_in', (select count(*) from auth.users where last_sign_in_at is null),
    'signed_in_7d', (select count(*) from auth.users where last_sign_in_at >= v_7d),
    'last_login_at', (select max(last_sign_in_at) from auth.users)
  ) into v_auth;

  select jsonb_build_object(
    'total', count(*),
    'pending', count(*) filter (where status = 'invited' and (invite_expires_at is null or invite_expires_at >= now())),
    'expired', count(*) filter (where status = 'invited' and invite_expires_at < now()),
    'accepted', count(*) filter (where started_at is not null),
    'active', count(*) filter (where status = 'active'),
    'ended', count(*) filter (where status = 'ended'),
    'created_7d', count(*) filter (where created_at >= v_7d),
    'created_30d', count(*) filter (where created_at >= v_30d),
    'acceptance_rate', case when count(*) = 0 then null
      else round(100.0 * count(*) filter (where started_at is not null) / count(*), 1) end
  ) into v_inv from public.trainer_clients;

  select jsonb_build_object(
    'posts', (select count(*) from public.social_posts where deleted_at is null),
    'posts_7d', (select count(*) from public.social_posts where deleted_at is null and created_at >= v_7d),
    'posts_deleted', (select count(*) from public.social_posts where deleted_at is not null),
    'comments', (select count(*) from public.social_comments),
    'comments_7d', (select count(*) from public.social_comments where created_at >= v_7d),
    'kudos', (select count(*) from public.social_reactions),
    'kudos_7d', (select count(*) from public.social_reactions where created_at >= v_7d),
    'follows', (select count(*) from public.social_follows),
    'follows_7d', (select count(*) from public.social_follows where created_at >= v_7d)
  ) into v_social;

  select jsonb_build_object(
    'push_subscriptions', (select count(*) from public.push_subscriptions),
    'users_with_push', (select count(distinct user_id) from public.push_subscriptions),
    'users_without_push', (select count(*) from public.users u where not exists
      (select 1 from public.push_subscriptions p where p.user_id = u.id)),
    'rest_pushes_sent_7d', (select count(*) from public.rest_pushes where sent_at >= v_7d),
    'notifications_unsent', (select count(*) from public.notifications where sent_at is null),
    'audit_events_24h', (select count(*) from public.admin_audit_events where created_at >= now() - interval '1 day'),
    'admin_actions_30d', (select count(*) from public.admin_audit_events
      where created_at >= v_30d and action in ('ADMIN_ACTION', 'USER_SUSPENDED', 'USER_REACTIVATED', 'TIER_CHANGED'))
  ) into v_system;

  return jsonb_build_object(
    'generated_at', now(),
    'users', v_users, 'activity', v_activity, 'auth', v_auth,
    'invitations', v_inv, 'social', v_social, 'system', v_system);
end;
$$;
revoke execute on function public.admin_overview() from public, anon;
grant execute on function public.admin_overview() to authenticated;

-- ---------- 4c. daily series ----------
create or replace function public.admin_daily_series(p_days int default 30)
returns table (
  day date, new_users int, active_users int, workouts int, sets int,
  posts int, logins int, invitations int, food_logs int
) language plpgsql stable security definer set search_path = public as $$
begin
  perform public.admin_assert();
  p_days := least(greatest(coalesce(p_days, 30), 1), 365);
  return query
  with days as (
    select d::date as day from generate_series(current_date - (p_days - 1), current_date, interval '1 day') d
  )
  select
    days.day,
    (select count(*) from public.users u where u.created_at::date = days.day)::int,
    (select count(*) from public.admin_active_user_ids(days.day::timestamptz, (days.day + 1)::timestamptz))::int,
    (select count(*) from public.logged_sessions s where s.completed_at::date = days.day)::int,
    (select count(*) from public.logged_sets s where s.received_at::date = days.day)::int,
    (select count(*) from public.social_posts p where p.created_at::date = days.day)::int,
    (select count(*) from auth.audit_log_entries e where e.payload ->> 'action' = 'login' and e.created_at::date = days.day)::int,
    (select count(*) from public.trainer_clients t where t.created_at::date = days.day)::int,
    (select count(*) from public.food_logs f where f.received_at::date = days.day)::int
  from days
  order by days.day;
end;
$$;
revoke execute on function public.admin_daily_series(int) from public, anon;
grant execute on function public.admin_daily_series(int) to authenticated;

-- ---------- 4d. users ----------
-- One page of the directory plus the total, with the joins the list shows.
-- Filters are enumerated values, never SQL; anything unknown is ignored.
create or replace function public.admin_users(
  p_search text default null,
  p_role text default null,           -- client | coach | admin
  p_status text default null,         -- active | inactive | suspended | deletion
  p_coach text default null,          -- with | without
  p_created_days int default null,    -- created within N days
  p_active_days int default null,     -- active within N days
  p_sort text default 'newest',       -- newest | oldest | last_active | most_workouts | most_sets | name
  p_limit int default 25,
  p_offset int default 0
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_needle text := nullif(trim(coalesce(p_search, '')), '');
  v_total bigint;
  v_rows jsonb;
begin
  perform public.admin_assert();
  p_limit := least(greatest(coalesce(p_limit, 25), 1), 100);
  p_offset := greatest(coalesce(p_offset, 0), 0);

  with base as (
    select u.id, u.full_name, u.username, u.avatar_url, u.role::text as role, u.timezone,
           u.created_at, u.suspended_at,
           au.email, au.last_sign_in_at,
           coalesce(au.raw_app_meta_data ->> 'provider', 'email') as provider,
           a.workouts, a.sets, a.last_activity_at,
           tc.coach_id, cu.username as coach_username, cu.full_name as coach_name,
           (select count(*) from public.trainer_clients t where t.coach_id = u.id and t.status = 'active') as clients,
           coalesce(s.tier, 'free') as tier,
           dr.requested_at as deletion_requested_at,
           (select count(*) from public.push_subscriptions p where p.user_id = u.id) as push_subscriptions
    from public.users u
    left join auth.users au on au.id = u.id
    left join public.admin_user_activity() a on a.user_id = u.id
    left join public.trainer_clients tc on tc.client_id = u.id and tc.status = 'active'
    left join public.users cu on cu.id = tc.coach_id
    left join public.subscriptions s on s.user_id = u.id
    left join public.account_deletion_requests dr on dr.user_id = u.id and dr.status = 'pending'
  ),
  filtered as (
    select * from base b
    where (v_needle is null
           or b.full_name ilike '%' || v_needle || '%'
           or b.username ilike '%' || v_needle || '%'
           or b.email ilike '%' || v_needle || '%'
           or b.id::text = lower(v_needle))
      and (p_role is null or p_role = '' or b.role = p_role or (p_role in ('client', 'coach') and b.role = 'both'))
      and (p_status is null or p_status = ''
           or (p_status = 'active' and b.last_activity_at >= now() - interval '30 days')
           or (p_status = 'inactive' and (b.last_activity_at is null or b.last_activity_at < now() - interval '30 days'))
           or (p_status = 'suspended' and b.suspended_at is not null)
           or (p_status = 'deletion' and b.deletion_requested_at is not null))
      and (p_coach is null or p_coach = ''
           or (p_coach = 'with' and b.coach_id is not null)
           or (p_coach = 'without' and b.coach_id is null))
      and (p_created_days is null or b.created_at >= now() - make_interval(days => p_created_days))
      and (p_active_days is null or b.last_activity_at >= now() - make_interval(days => p_active_days))
  ),
  page as (
    select f.*, count(*) over () as total,
           row_number() over (order by
             case when p_sort = 'oldest' then f.created_at end asc,
             case when p_sort = 'last_active' then f.last_activity_at end desc nulls last,
             case when p_sort = 'most_workouts' then f.workouts end desc,
             case when p_sort = 'most_sets' then f.sets end desc,
             case when p_sort = 'name' then lower(coalesce(f.username, f.full_name)) end asc,
             f.created_at desc) as rn
    from filtered f
    order by rn
    limit p_limit offset p_offset
  )
  select coalesce(max(p.total), 0),
         coalesce(jsonb_agg(
           (to_jsonb(p) - 'total' - 'rn') || jsonb_build_object(
             'streak', coalesce((select ss.current_days from public.social_streak(p.id) ss), 0),
             'load_7d', (
               select coalesce(sum(public.training_load_score(
                 r.volume, r.sets::int, r.duration_min::int, r.intensity, r.exercises::int)), 0)
               from (
                 select sum(coalesce(ls.weight_kg, 0) * ls.reps)::double precision as volume,
                        count(ls.id) as sets,
                        greatest(0, round(extract(epoch from (s.completed_at - s.started_at)) / 60)) as duration_min,
                        avg(ls.rpe)::double precision as intensity,
                        count(distinct ls.exercise_id) as exercises
                 from public.logged_sessions s
                 left join public.logged_sets ls on ls.session_id = s.id
                 where s.user_id = p.id and s.completed_at >= now() - interval '7 days'
                 group by s.id, s.started_at, s.completed_at
               ) r)
           ) order by p.rn), '[]'::jsonb)
    into v_total, v_rows
  from page p;

  return jsonb_build_object('total', v_total, 'rows', v_rows);
end;
$$;
revoke execute on function public.admin_users(text, text, text, text, int, int, text, int, int) from public, anon;
grant execute on function public.admin_users(text, text, text, text, int, int, text, int, int) to authenticated;

-- ---------- 4e. one user ----------
create or replace function public.admin_user_detail(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_profile jsonb; v_account jsonb; v_coaching jsonb; v_activity jsonb; v_nutrition jsonb;
  v_progress jsonb; v_social jsonb; v_auth jsonb; v_devices jsonb;
  v_7d timestamptz := now() - interval '7 days';
  v_30d timestamptz := now() - interval '30 days';
begin
  perform public.admin_assert();

  select jsonb_build_object(
    'id', u.id, 'full_name', u.full_name, 'username', u.username, 'avatar_url', u.avatar_url,
    'city', u.city, 'bio', u.bio, 'sex', u.sex, 'birth_year', u.birth_year,
    'role', u.role::text, 'locale', u.locale, 'timezone', u.timezone,
    'weight_unit', u.weight_unit, 'length_unit', u.length_unit,
    'check_in_weekday', u.check_in_weekday, 'leaderboard_visibility', u.leaderboard_visibility,
    'notification_prefs', u.notification_prefs, 'rest_prefs', u.rest_prefs,
    'created_at', u.created_at, 'updated_at', u.updated_at,
    'suspended_at', u.suspended_at, 'suspended_reason', u.suspended_reason
  ) into v_profile from public.users u where u.id = p_user;
  if v_profile is null then
    return null;
  end if;

  select jsonb_build_object(
    'email', au.email,
    'email_confirmed_at', au.email_confirmed_at,
    'auth_created_at', au.created_at,
    'last_sign_in_at', au.last_sign_in_at,
    'primary_provider', coalesce(au.raw_app_meta_data ->> 'provider', 'email'),
    'providers', (select coalesce(jsonb_agg(i.provider order by i.created_at), '[]'::jsonb)
                  from auth.identities i where i.user_id = p_user),
    'tier', coalesce((select s.tier from public.subscriptions s where s.user_id = p_user), 'free'),
    'tier_status', (select s.status from public.subscriptions s where s.user_id = p_user),
    'tier_provider', (select s.provider from public.subscriptions s where s.user_id = p_user),
    'deletion', (select jsonb_build_object('requested_at', d.requested_at, 'purge_after', d.purge_after, 'status', d.status)
                 from public.account_deletion_requests d where d.user_id = p_user),
    'invited_by', (select jsonb_build_object('id', c.id, 'username', c.username, 'full_name', c.full_name, 'at', t.started_at)
                   from public.trainer_clients t join public.users c on c.id = t.coach_id
                   where t.client_id = p_user and t.started_at is not null
                   order by t.started_at asc limit 1)
  ) into v_account from auth.users au where au.id = p_user;

  select jsonb_build_object(
    'current_coach', (select jsonb_build_object('id', c.id, 'username', c.username, 'full_name', c.full_name,
                        'avatar_url', c.avatar_url, 'since', t.started_at)
                      from public.trainer_clients t join public.users c on c.id = t.coach_id
                      where t.client_id = p_user and t.status = 'active' limit 1),
    'past_coaches', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'username', c.username, 'full_name', c.full_name,
                        'from', t.started_at, 'to', t.ended_at) order by t.ended_at desc), '[]'::jsonb)
                     from public.trainer_clients t join public.users c on c.id = t.coach_id
                     where t.client_id = p_user and t.status = 'ended' and t.started_at is not null),
    'clients', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'username', c.username, 'full_name', c.full_name,
                        'avatar_url', c.avatar_url, 'status', t.status::text, 'since', t.started_at) order by t.started_at desc nulls last), '[]'::jsonb)
                from public.trainer_clients t join public.users c on c.id = t.client_id
                where t.coach_id = p_user and t.client_id is not null),
    'invitations_sent', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'status',
                           case when t.status = 'invited' and t.invite_expires_at < now() then 'expired' else t.status::text end,
                           'created_at', t.created_at, 'expires_at', t.invite_expires_at, 'started_at', t.started_at,
                           'ended_at', t.ended_at, 'client_username', c.username) order by t.created_at desc), '[]'::jsonb)
                         from public.trainer_clients t left join public.users c on c.id = t.client_id
                         where t.coach_id = p_user),
    'invitations_received', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'status', t.status::text,
                               'started_at', t.started_at, 'ended_at', t.ended_at, 'coach_username', c.username) order by t.started_at desc), '[]'::jsonb)
                             from public.trainer_clients t join public.users c on c.id = t.coach_id
                             where t.client_id = p_user)
  ) into v_coaching;

  select jsonb_build_object(
    'workouts', count(*) filter (where s.completed_at is not null),
    'workouts_7d', count(*) filter (where s.completed_at >= v_7d),
    'workouts_30d', count(*) filter (where s.completed_at >= v_30d),
    'abandoned', count(*) filter (where s.completed_at is null and s.started_at < now() - interval '1 day'),
    'first_workout_at', min(s.started_at),
    'last_workout_at', max(s.started_at),
    'avg_duration_min', round(avg(extract(epoch from (s.completed_at - s.started_at)) / 60) filter (where s.completed_at is not null)),
    'sets', (select count(*) from public.logged_sets where user_id = p_user),
    'sets_7d', (select count(*) from public.logged_sets where user_id = p_user and received_at >= v_7d),
    'prs', (select count(*) from public.logged_sets where user_id = p_user and is_pr),
    'exercises_used', (select count(distinct exercise_id) from public.logged_sets where user_id = p_user),
    'top_exercises', (select coalesce(jsonb_agg(jsonb_build_object('name', x.name, 'sets', x.n) order by x.n desc), '[]'::jsonb)
                      from (select coalesce(e.name_en, '?') as name, count(*) as n
                            from public.logged_sets ls join public.exercises e on e.id = ls.exercise_id
                            where ls.user_id = p_user group by e.name_en order by n desc limit 5) x),
    'programs', (select count(*) from public.programs where client_id = p_user),
    'programs_published', (select count(*) from public.programs where client_id = p_user and status = 'published'),
    'programs_built', (select count(*) from public.programs where coach_id = p_user),
    'challenges', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title_en, 'type', c.type,
                     'start_date', c.start_date, 'end_date', c.end_date, 'joined_at', cp.joined_at,
                     'completed_at', cp.completed_at) order by cp.joined_at desc), '[]'::jsonb)
                   from public.challenge_participants cp join public.challenges c on c.id = cp.challenge_id
                   where cp.user_id = p_user),
    'habits_active', (select count(*) from public.habits where user_id = p_user and active),
    'habit_logs_30d', (select count(*) from public.habit_logs where user_id = p_user and received_at >= v_30d),
    'badges', (select coalesce(jsonb_agg(jsonb_build_object('slug', b.slug, 'name', b.name_en, 'awarded_at', ub.awarded_at)), '[]'::jsonb)
               from public.user_badges ub join public.badges b on b.id = ub.badge_id where ub.user_id = p_user)
  ) into v_activity from public.logged_sessions s where s.user_id = p_user;

  select jsonb_build_object(
    'food_logs', count(*),
    'food_logs_7d', count(*) filter (where f.received_at >= v_7d),
    'food_logs_30d', count(*) filter (where f.received_at >= v_30d),
    'last_food_log_at', max(f.received_at),
    'days_logged_30d', count(distinct f.date) filter (where f.received_at >= v_30d),
    'avg_kcal_7d', (select round(avg(d.kcal)) from (
                      select sum(kcal) as kcal from public.food_logs
                      where user_id = p_user and date >= current_date - 6 group by date) d),
    'methods', (select coalesce(jsonb_object_agg(m.method, m.n), '{}'::jsonb) from (
                  select method::text, count(*) as n from public.food_logs where user_id = p_user group by method) m),
    'plans', (select count(*) from public.nutrition_plans where client_id = p_user),
    'active_plan', (select jsonb_build_object('id', np.id, 'name', np.name, 'kcal', np.kcal_target,
                      'protein_g', np.protein_target_g, 'carbs_g', np.carbs_target_g, 'fat_g', np.fat_target_g,
                      'meals', (select count(*) from public.planned_meals pm where pm.plan_id = np.id),
                      'coach_id', np.coach_id)
                    from public.nutrition_plans np where np.client_id = p_user and np.status = 'published'
                    order by np.updated_at desc limit 1),
    'plans_built', (select count(*) from public.nutrition_plans where coach_id = p_user),
    'custom_foods', (select count(*) from public.foods where owner_id = p_user),
    'favorites', (select count(*) from public.food_favorites where user_id = p_user)
  ) into v_nutrition from public.food_logs f where f.user_id = p_user;

  select jsonb_build_object(
    'measurements', (select count(*) from public.measurements where user_id = p_user),
    'latest_weight', (select jsonb_build_object('kg', m.weight_kg, 'date', m.date) from public.measurements m
                      where m.user_id = p_user and m.weight_kg is not null order by m.date desc limit 1),
    'first_weight', (select jsonb_build_object('kg', m.weight_kg, 'date', m.date) from public.measurements m
                     where m.user_id = p_user and m.weight_kg is not null order by m.date asc limit 1),
    'weight_history', (select coalesce(jsonb_agg(jsonb_build_object('date', w.date, 'kg', w.weight_kg) order by w.date), '[]'::jsonb)
                       from (select date, weight_kg from public.measurements
                             where user_id = p_user and weight_kg is not null order by date desc limit 60) w),
    'check_ins', (select count(*) from public.check_ins where user_id = p_user),
    'last_check_in', (select jsonb_build_object('week_start', c.week_start, 'submitted_at', c.submitted_at,
                        'reviewed', c.coach_reviewed_at is not null, 'sleep', c.sleep, 'energy', c.energy,
                        'stress', c.stress, 'hunger', c.hunger, 'recovery', c.recovery)
                      from public.check_ins c where c.user_id = p_user order by c.week_start desc limit 1),
    'photos', (select count(*) from public.progress_photos where user_id = p_user),
    'last_photo_at', (select max(created_at) from public.progress_photos where user_id = p_user),
    'latest_adherence', (select jsonb_build_object('week_start', a.week_start, 'overall_pct', a.overall_pct,
                           'signal', a.signal::text, 'reason', a.reason)
                         from public.adherence_snapshots a where a.user_id = p_user order by a.week_start desc limit 1),
    'goals', (select count(*) from public.goals where user_id = p_user and status = 'active')
  ) into v_progress;

  select jsonb_build_object(
    'posts', (select count(*) from public.social_posts where user_id = p_user and deleted_at is null),
    'posts_deleted', (select count(*) from public.social_posts where user_id = p_user and deleted_at is not null),
    'comments', (select count(*) from public.social_comments where user_id = p_user),
    'kudos_given', (select count(*) from public.social_reactions where user_id = p_user),
    'kudos_received', (select count(*) from public.social_reactions r join public.social_posts p on p.id = r.post_id where p.user_id = p_user),
    'followers', (select count(*) from public.social_follows where following_id = p_user),
    'following', (select count(*) from public.social_follows where follower_id = p_user),
    'recent_posts', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'type', p.type, 'text', left(p.text, 140),
                       'visibility', p.visibility, 'created_at', p.created_at, 'deleted_at', p.deleted_at,
                       'kudos', (select count(*) from public.social_reactions r where r.post_id = p.id),
                       'comments', (select count(*) from public.social_comments c where c.post_id = p.id)) order by p.created_at desc), '[]'::jsonb)
                     from (select * from public.social_posts where user_id = p_user order by created_at desc limit 10) p)
  ) into v_social;

  select jsonb_build_object(
    'logins_total', (select count(*) from auth.audit_log_entries e
                     where e.payload ->> 'action' = 'login' and public.admin_uuid_or_null(e.payload ->> 'actor_id') = p_user),
    'logins_30d', (select count(*) from auth.audit_log_entries e
                   where e.payload ->> 'action' = 'login' and public.admin_uuid_or_null(e.payload ->> 'actor_id') = p_user and e.created_at >= v_30d),
    'failed_30d', (select count(*) from public.admin_audit_events a
                   where a.action = 'LOGIN_FAILED' and a.target_user_id = p_user and a.created_at >= v_30d),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('at', h.created_at, 'action', h.payload ->> 'action',
                  'provider', coalesce(h.payload -> 'traits' ->> 'provider', h.payload ->> 'provider'),
                  'ip', h.ip_address) order by h.created_at desc), '[]'::jsonb)
                from (select * from auth.audit_log_entries e
                      where public.admin_uuid_or_null(e.payload ->> 'actor_id') = p_user
                        and e.payload ->> 'action' in ('login', 'logout', 'user_signedup', 'user_recovery_requested',
                                                       'user_updated_password', 'user_modified', 'token_revoked')
                      order by e.created_at desc limit 25) h)
  ) into v_auth;

  select jsonb_build_object(
    'push_subscriptions', (select coalesce(jsonb_agg(jsonb_build_object('id', ps.id, 'user_agent', ps.user_agent,
                             'created_at', ps.created_at, 'updated_at', ps.updated_at) order by ps.updated_at desc), '[]'::jsonb)
                           from public.push_subscriptions ps where ps.user_id = p_user),
    'rest_pushes_sent', (select count(*) from public.rest_pushes where user_id = p_user and sent_at is not null),
    'rest_pushes_cancelled', (select count(*) from public.rest_pushes where user_id = p_user and cancelled_at is not null),
    'last_rest_push_at', (select max(sent_at) from public.rest_pushes where user_id = p_user),
    'notifications', (select count(*) from public.notifications where user_id = p_user),
    'notifications_unread', (select count(*) from public.notifications where user_id = p_user and read_at is null),
    'last_notification_at', (select max(created_at) from public.notifications where user_id = p_user)
  ) into v_devices;

  return jsonb_build_object(
    'profile', v_profile, 'account', v_account, 'coaching', v_coaching, 'activity', v_activity,
    'nutrition', v_nutrition, 'progress', v_progress, 'social', v_social, 'auth', v_auth, 'devices', v_devices);
end;
$$;
revoke execute on function public.admin_user_detail(uuid) from public, anon;
grant execute on function public.admin_user_detail(uuid) to authenticated;

-- The person's completed sessions with set rollups, so the fitness score and
-- training load the app computes in TypeScript can be computed for them too.
create or replace function public.admin_user_load_sessions(p_user uuid, p_days int default 57)
returns table (started_at timestamptz, completed_at timestamptz, sets jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.admin_assert();
  return query
  select s.started_at, s.completed_at,
         coalesce((select jsonb_agg(jsonb_build_object('weight_kg', ls.weight_kg, 'reps', ls.reps, 'rpe', ls.rpe,
                    'rir', ls.rir, 'exercise_id', ls.exercise_id))
                   from public.logged_sets ls where ls.session_id = s.id), '[]'::jsonb)
  from public.logged_sessions s
  where s.user_id = p_user and s.completed_at is not null
    and s.started_at >= now() - make_interval(days => least(greatest(coalesce(p_days, 57), 1), 400))
  order by s.started_at;
end;
$$;
revoke execute on function public.admin_user_load_sessions(uuid, int) from public, anon;
grant execute on function public.admin_user_load_sessions(uuid, int) to authenticated;

-- ---------- 4f. one user's timeline ----------
-- Built from the source tables, so history from before the audit log exists
-- shows too; the audit log contributes only what no table still holds (a
-- login, an edit, a deletion, a suspension).
create or replace function public.admin_user_timeline(p_user uuid, p_before timestamptz default null, p_limit int default 50)
returns table (occurred_at timestamptz, kind text, title text, detail text, entity_type text, entity_id text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.admin_assert();
  p_limit := least(greatest(coalesce(p_limit, 50), 1), 200);
  p_before := coalesce(p_before, now() + interval '1 day');
  return query
  select * from (
    select s.started_at, 'workout_started'::text, coalesce(pd.name, '')::text, null::text, 'session'::text, s.id::text
    from public.logged_sessions s left join public.program_days pd on pd.id = s.program_day_id
    where s.user_id = p_user
    union all
    select s.completed_at, 'workout_completed', coalesce(pd.name, ''),
           (greatest(0, round(extract(epoch from (s.completed_at - s.started_at)) / 60))::int)::text, 'session', s.id::text
    from public.logged_sessions s left join public.program_days pd on pd.id = s.program_day_id
    where s.user_id = p_user and s.completed_at is not null
    union all
    select ls.received_at, 'set_logged', coalesce(e.name_en, ''),
           coalesce(ls.weight_kg::text, '0') || '|' || ls.reps::text || '|' || coalesce(ls.rpe::text, ''), 'set', ls.id::text
    from public.logged_sets ls left join public.exercises e on e.id = ls.exercise_id
    where ls.user_id = p_user
    union all
    select f.received_at, 'food_logged', f.food_name, f.grams::text || '|' || round(f.kcal)::text || '|' || f.slot::text, 'food_log', f.id::text
    from public.food_logs f where f.user_id = p_user
    union all
    select m.created_at, 'measurement', coalesce(m.weight_kg::text, ''), m.date::text, 'measurement', m.id::text
    from public.measurements m where m.user_id = p_user
    union all
    select c.submitted_at, 'check_in', c.week_start::text, null, 'check_in', c.id::text
    from public.check_ins c where c.user_id = p_user
    union all
    select h.received_at, 'habit_done', coalesce(hb.name, ''), h.date::text, 'habit', h.habit_id::text
    from public.habit_logs h left join public.habits hb on hb.id = h.habit_id where h.user_id = p_user
    union all
    select p.created_at, 'post_created', p.type, left(p.text, 80), 'post', p.id::text
    from public.social_posts p where p.user_id = p_user
    union all
    select c.created_at, 'comment_created', left(c.body, 80), null, 'post', c.post_id::text
    from public.social_comments c where c.user_id = p_user
    union all
    select r.created_at, 'kudos_given', coalesce(au.username, au.full_name, ''), null, 'post', r.post_id::text
    from public.social_reactions r join public.social_posts p on p.id = r.post_id
    left join public.users au on au.id = p.user_id where r.user_id = p_user
    union all
    select r.created_at, 'kudos_received', coalesce(ru.username, ru.full_name, ''), null, 'post', r.post_id::text
    from public.social_reactions r join public.social_posts p on p.id = r.post_id
    left join public.users ru on ru.id = r.user_id where p.user_id = p_user and r.user_id <> p_user
    union all
    select f.created_at, 'followed', coalesce(fu.username, fu.full_name, ''), null, 'user', f.following_id::text
    from public.social_follows f left join public.users fu on fu.id = f.following_id where f.follower_id = p_user
    union all
    select f.created_at, 'followed_by', coalesce(fu.username, fu.full_name, ''), null, 'user', f.follower_id::text
    from public.social_follows f left join public.users fu on fu.id = f.follower_id where f.following_id = p_user
    union all
    select cp.joined_at, 'challenge_joined', c.title_en, null, 'challenge', c.id::text
    from public.challenge_participants cp join public.challenges c on c.id = cp.challenge_id where cp.user_id = p_user
    union all
    select cp.completed_at, 'challenge_completed', c.title_en, null, 'challenge', c.id::text
    from public.challenge_participants cp join public.challenges c on c.id = cp.challenge_id
    where cp.user_id = p_user and cp.completed_at is not null
    union all
    select t.started_at, 'coach_joined', coalesce(cu.username, cu.full_name, ''), null, 'invitation', t.id::text
    from public.trainer_clients t left join public.users cu on cu.id = t.coach_id
    where t.client_id = p_user and t.started_at is not null
    union all
    select t.created_at, 'invitation_sent', '', t.status::text, 'invitation', t.id::text
    from public.trainer_clients t where t.coach_id = p_user
    union all
    select rp.created_at, 'rest_timer', greatest(0, round(extract(epoch from (rp.notify_at - rp.created_at))))::int::text,
           case when rp.sent_at is not null then 'sent' when rp.cancelled_at is not null then 'cancelled' else 'pending' end,
           'rest_push', rp.id::text
    from public.rest_pushes rp where rp.user_id = p_user
    union all
    select a.created_at, lower(a.action::text), coalesce(a.metadata ->> 'exercise', a.metadata ->> 'provider', a.metadata ->> 'kind', ''),
           coalesce(a.metadata ->> 'reason', a.metadata ->> 'to', ''), a.entity_type, a.entity_id
    from public.admin_audit_events a
    where (a.target_user_id = p_user or a.actor_user_id = p_user)
      and a.action in ('USER_CREATED', 'USER_LOGIN', 'LOGIN_FAILED', 'ROLE_CHANGED', 'USER_SUSPENDED', 'USER_REACTIVATED',
                       'ACCOUNT_DELETION_REQUESTED', 'TIER_CHANGED', 'SET_EDITED', 'SET_DELETED', 'WORKOUT_DELETED',
                       'POST_DELETED', 'PUSH_SUBSCRIBED', 'PUSH_UNSUBSCRIBED', 'ADMIN_ACTION', 'PROGRAM_CREATED',
                       'PROGRAM_UPDATED', 'PROGRAM_DELETED', 'EXERCISE_CREATED')
  ) ev(occurred_at, kind, title, detail, entity_type, entity_id)
  where ev.occurred_at is not null and ev.occurred_at < p_before
  order by ev.occurred_at desc
  limit p_limit;
end;
$$;
revoke execute on function public.admin_user_timeline(uuid, timestamptz, int) from public, anon;
grant execute on function public.admin_user_timeline(uuid, timestamptz, int) to authenticated;

-- ---------- 4g. audit log ----------
create or replace function public.admin_audit_log(
  p_action text default null, p_actor uuid default null, p_target uuid default null,
  p_entity_type text default null, p_search text default null,
  p_from timestamptz default null, p_to timestamptz default null,
  p_limit int default 50, p_offset int default 0
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_rows jsonb;
  v_needle text := nullif(trim(coalesce(p_search, '')), '');
  v_action public.audit_action := null;
begin
  perform public.admin_assert();
  p_limit := least(greatest(coalesce(p_limit, 50), 1), 200);
  p_offset := greatest(coalesce(p_offset, 0), 0);
  if p_action is not null and p_action <> '' then
    begin
      v_action := p_action::public.audit_action;
    exception when invalid_text_representation then
      v_action := null;
    end;
  end if;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.created_at desc, x.id desc), '[]'::jsonb)
    into v_rows
  from (
    select a.id, a.created_at, a.action::text, a.entity_type, a.entity_id, a.metadata, a.ip, a.user_agent,
           a.actor_user_id, a.actor_role, au.username as actor_username, au.full_name as actor_name,
           a.target_user_id, tu.username as target_username, tu.full_name as target_name,
           count(*) over () as total
    from public.admin_audit_events a
    left join public.users au on au.id = a.actor_user_id
    left join public.users tu on tu.id = a.target_user_id
    where (v_action is null or a.action = v_action)
      and (p_actor is null or a.actor_user_id = p_actor)
      and (p_target is null or a.target_user_id = p_target)
      and (p_entity_type is null or p_entity_type = '' or a.entity_type = p_entity_type)
      and (p_from is null or a.created_at >= p_from)
      and (p_to is null or a.created_at < p_to)
      and (v_needle is null or a.entity_id = v_needle or a.metadata::text ilike '%' || v_needle || '%'
           or au.username ilike '%' || v_needle || '%' or tu.username ilike '%' || v_needle || '%')
    order by a.created_at desc, a.id desc
    limit p_limit offset p_offset
  ) x;
  return jsonb_build_object('total', coalesce((v_rows -> 0 ->> 'total')::bigint, 0),
                            'rows', (select coalesce(jsonb_agg(r - 'total'), '[]'::jsonb) from jsonb_array_elements(v_rows) r));
end;
$$;
revoke execute on function public.admin_audit_log(text, uuid, uuid, text, text, timestamptz, timestamptz, int, int) from public, anon;
grant execute on function public.admin_audit_log(text, uuid, uuid, text, text, timestamptz, timestamptz, int, int) to authenticated;

-- ---------- 4h. auth ----------
create or replace function public.admin_auth_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_today timestamptz := date_trunc('day', now());
begin
  perform public.admin_assert();
  return jsonb_build_object(
    'logins_total', (select count(*) from auth.audit_log_entries where payload ->> 'action' = 'login'),
    'logins_today', (select count(*) from auth.audit_log_entries where payload ->> 'action' = 'login' and created_at >= v_today),
    'logins_7d', (select count(*) from auth.audit_log_entries where payload ->> 'action' = 'login' and created_at >= now() - interval '7 days'),
    'logins_30d', (select count(*) from auth.audit_log_entries where payload ->> 'action' = 'login' and created_at >= now() - interval '30 days'),
    'unique_7d', (select count(distinct payload ->> 'actor_id') from auth.audit_log_entries
                  where payload ->> 'action' = 'login' and created_at >= now() - interval '7 days'),
    'unique_30d', (select count(distinct payload ->> 'actor_id') from auth.audit_log_entries
                   where payload ->> 'action' = 'login' and created_at >= now() - interval '30 days'),
    'never_logged_in', (select count(*) from auth.users where last_sign_in_at is null),
    'signups_total', (select count(*) from auth.audit_log_entries where payload ->> 'action' = 'user_signedup'),
    'recoveries_30d', (select count(*) from auth.audit_log_entries
                       where payload ->> 'action' = 'user_recovery_requested' and created_at >= now() - interval '30 days'),
    'by_provider', (select coalesce(jsonb_object_agg(p.provider, p.n), '{}'::jsonb)
                    from (select provider, count(*) as n from auth.identities group by provider) p),
    'logins_by_provider_30d', (select coalesce(jsonb_object_agg(p.provider, p.n), '{}'::jsonb)
                    from (select coalesce(payload -> 'traits' ->> 'provider', payload ->> 'provider', 'unknown') as provider, count(*) as n
                          from auth.audit_log_entries
                          where payload ->> 'action' = 'login' and created_at >= now() - interval '30 days'
                          group by 1) p),
    'failed_24h', (select count(*) from public.admin_audit_events where action = 'LOGIN_FAILED' and created_at >= now() - interval '1 day'),
    'failed_7d', (select count(*) from public.admin_audit_events where action = 'LOGIN_FAILED' and created_at >= now() - interval '7 days'),
    'failed_total', (select count(*) from public.admin_audit_events where action = 'LOGIN_FAILED'),
    'repeated_failures_24h', (select coalesce(jsonb_agg(jsonb_build_object('email', f.email, 'attempts', f.n, 'last_at', f.last_at,
                                'known_user', f.target is not null) order by f.n desc), '[]'::jsonb)
                              from (select metadata ->> 'email' as email, count(*) as n, max(created_at) as last_at,
                                           max(target_user_id::text) as target
                                    from public.admin_audit_events
                                    where action = 'LOGIN_FAILED' and created_at >= now() - interval '1 day'
                                    group by 1 having count(*) >= 3 order by n desc limit 20) f),
    'recent_logins', (select coalesce(jsonb_agg(jsonb_build_object('at', l.created_at, 'user_id', l.uid,
                        'username', u.username, 'full_name', u.full_name, 'email', au.email,
                        'provider', l.provider, 'ip', l.ip) order by l.created_at desc), '[]'::jsonb)
                      from (select e.created_at, public.admin_uuid_or_null(e.payload ->> 'actor_id') as uid,
                                   coalesce(e.payload -> 'traits' ->> 'provider', e.payload ->> 'provider') as provider,
                                   e.ip_address as ip
                            from auth.audit_log_entries e where e.payload ->> 'action' = 'login'
                            order by e.created_at desc limit 30) l
                      left join public.users u on u.id = l.uid
                      left join auth.users au on au.id = l.uid),
    'last_login_per_user', (select coalesce(jsonb_agg(jsonb_build_object('user_id', au.id, 'username', u.username,
                              'full_name', u.full_name, 'email', au.email, 'last_sign_in_at', au.last_sign_in_at,
                              'provider', coalesce(au.raw_app_meta_data ->> 'provider', 'email')) order by au.last_sign_in_at desc nulls last), '[]'::jsonb)
                            from (select * from auth.users order by last_sign_in_at desc nulls last limit 50) au
                            left join public.users u on u.id = au.id)
  );
end;
$$;
revoke execute on function public.admin_auth_stats() from public, anon;
grant execute on function public.admin_auth_stats() to authenticated;

-- ---------- 4i. invitations ----------
create or replace function public.admin_invitations(
  p_status text default null,        -- pending | accepted | expired | ended
  p_search text default null,        -- inviter/recipient username, email, invitation id
  p_days int default null,
  p_limit int default 25, p_offset int default 0
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_needle text := nullif(trim(coalesce(p_search, '')), '');
  v_rows jsonb; v_stats jsonb;
begin
  perform public.admin_assert();
  p_limit := least(greatest(coalesce(p_limit, 25), 1), 100);
  p_offset := greatest(coalesce(p_offset, 0), 0);

  select jsonb_build_object(
    'total', count(*),
    'pending', count(*) filter (where status = 'invited' and (invite_expires_at is null or invite_expires_at >= now())),
    'expired', count(*) filter (where status = 'invited' and invite_expires_at < now()),
    'accepted', count(*) filter (where started_at is not null),
    'active', count(*) filter (where status = 'active'),
    'ended', count(*) filter (where status = 'ended'),
    'revoked', count(*) filter (where status = 'ended' and started_at is null),
    'created_7d', count(*) filter (where created_at >= now() - interval '7 days'),
    'created_30d', count(*) filter (where created_at >= now() - interval '30 days'),
    'acceptance_rate', case when count(*) = 0 then null
      else round(100.0 * count(*) filter (where started_at is not null) / count(*), 1) end
  ) into v_stats from public.trainer_clients;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.created_at desc), '[]'::jsonb) into v_rows
  from (
    select t.id, t.created_at, t.invite_expires_at as expires_at, t.started_at, t.ended_at,
           case when t.status = 'invited' and t.invite_expires_at < now() then 'expired'
                when t.status = 'invited' then 'pending'
                when t.status = 'active' then 'accepted'
                when t.started_at is null then 'revoked'
                else 'ended' end as status,
           t.coach_id, cu.username as coach_username, cu.full_name as coach_name,
           t.client_id, cl.username as client_username, cl.full_name as client_name,
           -- the code is a one-time secret while pending; only whether one exists
           t.invite_code is not null as has_code,
           count(*) over () as total
    from public.trainer_clients t
    left join public.users cu on cu.id = t.coach_id
    left join public.users cl on cl.id = t.client_id
    left join auth.users cau on cau.id = t.coach_id
    left join auth.users clau on clau.id = t.client_id
    where (p_status is null or p_status = ''
           or (p_status = 'pending' and t.status = 'invited' and (t.invite_expires_at is null or t.invite_expires_at >= now()))
           or (p_status = 'expired' and t.status = 'invited' and t.invite_expires_at < now())
           or (p_status = 'accepted' and t.started_at is not null)
           or (p_status = 'ended' and t.status = 'ended'))
      and (p_days is null or t.created_at >= now() - make_interval(days => p_days))
      and (v_needle is null or t.id::text = lower(v_needle)
           or cu.username ilike '%' || v_needle || '%' or cl.username ilike '%' || v_needle || '%'
           or cu.full_name ilike '%' || v_needle || '%' or cl.full_name ilike '%' || v_needle || '%'
           or cau.email ilike '%' || v_needle || '%' or clau.email ilike '%' || v_needle || '%')
    order by t.created_at desc
    limit p_limit offset p_offset
  ) x;
  return jsonb_build_object('stats', v_stats,
    'total', coalesce((v_rows -> 0 ->> 'total')::bigint, 0),
    'rows', (select coalesce(jsonb_agg(r - 'total'), '[]'::jsonb) from jsonb_array_elements(v_rows) r));
end;
$$;
revoke execute on function public.admin_invitations(text, text, int, int, int) from public, anon;
grant execute on function public.admin_invitations(text, text, int, int, int) to authenticated;

-- ---------- 4j. workouts ----------
create or replace function public.admin_workout_stats(p_days int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_from timestamptz;
begin
  perform public.admin_assert();
  p_days := least(greatest(coalesce(p_days, 30), 1), 365);
  v_from := now() - make_interval(days => p_days);
  return jsonb_build_object(
    'days', p_days,
    'sessions', (select count(*) from public.logged_sessions where started_at >= v_from),
    'completed', (select count(*) from public.logged_sessions where started_at >= v_from and completed_at is not null),
    'abandoned', (select count(*) from public.logged_sessions
                  where started_at >= v_from and completed_at is null and started_at < now() - interval '1 day'),
    'in_progress', (select count(*) from public.logged_sessions
                    where completed_at is null and started_at >= now() - interval '1 day'),
    'sets', (select count(*) from public.logged_sets where received_at >= v_from),
    'prs', (select count(*) from public.logged_sets where received_at >= v_from and is_pr),
    'exercises_logged', (select count(distinct exercise_id) from public.logged_sets where received_at >= v_from),
    'active_users', (select count(distinct user_id) from public.logged_sessions where started_at >= v_from),
    'avg_duration_min', (select round(avg(extract(epoch from (completed_at - started_at)) / 60))
                         from public.logged_sessions
                         where started_at >= v_from and completed_at is not null
                           and completed_at - started_at between interval '1 minute' and interval '6 hours'),
    'avg_sets_per_session', (select round(avg(n), 1) from (
                               select count(*) as n from public.logged_sets ls
                               join public.logged_sessions s on s.id = ls.session_id
                               where s.started_at >= v_from group by s.id) x),
    'programs_total', (select count(*) from public.programs),
    'programs_published', (select count(*) from public.programs where status = 'published'),
    'programs_created', (select count(*) from public.programs where created_at >= v_from),
    'programs_solo', (select count(*) from public.programs where coach_id is null),
    'top_exercises', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'sets', x.sets, 'users', x.users) order by x.sets desc), '[]'::jsonb)
                      from (select e.id, e.name_en as name, count(*) as sets, count(distinct ls.user_id) as users
                            from public.logged_sets ls join public.exercises e on e.id = ls.exercise_id
                            where ls.received_at >= v_from group by e.id, e.name_en order by sets desc limit 15) x),
    'top_users', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'username', x.username, 'full_name', x.full_name,
                    'workouts', x.workouts, 'sets', x.sets) order by x.workouts desc, x.sets desc), '[]'::jsonb)
                  from (select u.id, u.username, u.full_name,
                               count(distinct s.id) filter (where s.completed_at is not null) as workouts,
                               count(ls.id) as sets
                        from public.users u
                        join public.logged_sessions s on s.user_id = u.id and s.started_at >= v_from
                        left join public.logged_sets ls on ls.session_id = s.id
                        group by u.id, u.username, u.full_name order by workouts desc, sets desc limit 15) x),
    'load_distribution', (select coalesce(jsonb_object_agg(x.band, x.n), '{}'::jsonb) from (
                            select case when l.score < 25 then 'light' when l.score < 50 then 'moderate'
                                        when l.score < 75 then 'hard' else 'very_hard' end as band, count(*) as n
                            from (
                              select public.training_load_score(
                                sum(coalesce(ls.weight_kg, 0) * ls.reps)::double precision, count(ls.id)::int,
                                greatest(0, round(extract(epoch from (s.completed_at - s.started_at)) / 60))::int,
                                avg(ls.rpe)::double precision, count(distinct ls.exercise_id)::int) as score
                              from public.logged_sessions s left join public.logged_sets ls on ls.session_id = s.id
                              where s.started_at >= v_from and s.completed_at is not null
                              group by s.id, s.started_at, s.completed_at) l
                            group by 1) x),
    'streak_users_today', (select count(distinct user_id) from public.logged_sessions
                           where completed_at is not null and started_at >= date_trunc('day', now()) - interval '1 day'),
    'by_hour', (select coalesce(jsonb_agg(jsonb_build_object('hour', h.hour, 'sessions', h.n) order by h.hour), '[]'::jsonb)
                from (select extract(hour from started_at)::int as hour, count(*) as n
                      from public.logged_sessions where started_at >= v_from group by 1) h)
  );
end;
$$;
revoke execute on function public.admin_workout_stats(int) from public, anon;
grant execute on function public.admin_workout_stats(int) to authenticated;

-- ---------- 4k. exercises ----------
create or replace function public.admin_exercises(
  p_search text default null, p_category text default null, p_equipment text default null,
  p_muscle text default null, p_source text default null, p_owner text default null, -- system | custom
  p_limit int default 25, p_offset int default 0
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_needle text := nullif(trim(coalesce(p_search, '')), '');
  v_rows jsonb; v_stats jsonb;
begin
  perform public.admin_assert();
  p_limit := least(greatest(coalesce(p_limit, 25), 1), 100);
  p_offset := greatest(coalesce(p_offset, 0), 0);

  select jsonb_build_object(
    'total', count(*),
    'system', count(*) filter (where owner_id is null),
    'custom', count(*) filter (where owner_id is not null),
    'missing_ro', count(*) filter (where owner_id is null and (name_ro is null or name_ro = '')),
    'with_images', count(*) filter (where cardinality(images) > 0),
    'in_use', (select count(distinct exercise_id) from public.logged_sets),
    'categories', (select coalesce(jsonb_object_agg(c.category, c.n), '{}'::jsonb)
                   from (select coalesce(category, 'none') as category, count(*) as n from public.exercises group by 1) c),
    'equipment', (select coalesce(jsonb_object_agg(c.equipment, c.n), '{}'::jsonb)
                  from (select coalesce(equipment, 'none') as equipment, count(*) as n from public.exercises group by 1) c)
  ) into v_stats from public.exercises;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.name_en), '[]'::jsonb) into v_rows
  from (
    select e.id, e.name_en, e.name_ro, e.category, e.level, e.equipment, e.primary_muscles, e.secondary_muscles,
           e.source, e.external_id, e.owner_id, ou.username as owner_username, e.created_at, e.updated_at,
           cardinality(e.images) as image_count,
           (select count(*) from public.logged_sets ls where ls.exercise_id = e.id) as logged_sets,
           (select count(*) from public.program_exercises pe where pe.exercise_id = e.id) as in_programs,
           count(*) over () as total
    from public.exercises e
    left join public.users ou on ou.id = e.owner_id
    where (v_needle is null or e.name_en ilike '%' || v_needle || '%' or e.name_ro ilike '%' || v_needle || '%'
           or e.id::text = lower(v_needle))
      and (p_category is null or p_category = '' or e.category = p_category)
      and (p_equipment is null or p_equipment = '' or e.equipment = p_equipment)
      and (p_muscle is null or p_muscle = '' or p_muscle = any (e.primary_muscles))
      and (p_source is null or p_source = '' or e.source = p_source)
      and (p_owner is null or p_owner = '' or (p_owner = 'system' and e.owner_id is null) or (p_owner = 'custom' and e.owner_id is not null))
    order by e.name_en
    limit p_limit offset p_offset
  ) x;
  return jsonb_build_object('stats', v_stats,
    'total', coalesce((v_rows -> 0 ->> 'total')::bigint, 0),
    'rows', (select coalesce(jsonb_agg(r - 'total'), '[]'::jsonb) from jsonb_array_elements(v_rows) r));
end;
$$;
revoke execute on function public.admin_exercises(text, text, text, text, text, text, int, int) from public, anon;
grant execute on function public.admin_exercises(text, text, text, text, text, text, int, int) to authenticated;

-- ---------- 4l. nutrition ----------
create or replace function public.admin_nutrition_stats(p_days int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_from timestamptz;
begin
  perform public.admin_assert();
  p_days := least(greatest(coalesce(p_days, 30), 1), 365);
  v_from := now() - make_interval(days => p_days);
  return jsonb_build_object(
    'days', p_days,
    'foods_total', (select count(*) from public.foods),
    'foods_by_source', (select coalesce(jsonb_object_agg(s.source, s.n), '{}'::jsonb)
                        from (select source::text, count(*) as n from public.foods group by source) s),
    'foods_custom', (select count(*) from public.foods where owner_id is not null),
    'foods_verified', (select count(*) from public.foods where verified),
    'foods_with_barcode', (select count(*) from public.foods where barcode is not null),
    'foods_missing_ro', (select count(*) from public.foods where owner_id is null and (name_ro is null or name_ro = '')),
    'foods_no_kcal', (select count(*) from public.foods where kcal_100g = 0),
    'foods_no_macros', (select count(*) from public.foods where protein_100g = 0 and carbs_100g = 0 and fat_100g = 0),
    'foods_no_portions', (select count(*) from public.foods where portions = '[]'::jsonb),
    'foods_duplicate_names', (select count(*) from (
                                select lower(coalesce(name_en, name_ro)), coalesce(brand, '') from public.foods
                                group by 1, 2 having count(*) > 1) d),
    'duplicate_samples', (select coalesce(jsonb_agg(jsonb_build_object('name', d.name, 'brand', d.brand, 'count', d.n) order by d.n desc), '[]'::jsonb)
                          from (select lower(coalesce(name_en, name_ro)) as name, coalesce(brand, '') as brand, count(*) as n
                                from public.foods group by 1, 2 having count(*) > 1 order by n desc limit 15) d),
    'incomplete_samples', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', coalesce(f.name_en, f.name_ro),
                             'source', f.source::text, 'kcal', f.kcal_100g, 'protein', f.protein_100g, 'carbs', f.carbs_100g, 'fat', f.fat_100g)), '[]'::jsonb)
                           from (select * from public.foods
                                 where kcal_100g = 0 or (protein_100g = 0 and carbs_100g = 0 and fat_100g = 0)
                                 order by created_at desc limit 15) f),
    'food_logs', (select count(*) from public.food_logs where received_at >= v_from),
    'food_logs_total', (select count(*) from public.food_logs),
    'active_users', (select count(distinct user_id) from public.food_logs where received_at >= v_from),
    'logs_by_method', (select coalesce(jsonb_object_agg(m.method, m.n), '{}'::jsonb)
                       from (select method::text, count(*) as n from public.food_logs where received_at >= v_from group by method) m),
    'logs_by_slot', (select coalesce(jsonb_object_agg(m.slot, m.n), '{}'::jsonb)
                     from (select slot::text, count(*) as n from public.food_logs where received_at >= v_from group by slot) m),
    'top_foods', (select coalesce(jsonb_agg(jsonb_build_object('name', t.name, 'logs', t.n, 'users', t.users) order by t.n desc), '[]'::jsonb)
                  from (select food_name as name, count(*) as n, count(distinct user_id) as users
                        from public.food_logs where received_at >= v_from group by food_name order by n desc limit 15) t),
    'plans_total', (select count(*) from public.nutrition_plans),
    'plans_published', (select count(*) from public.nutrition_plans where status = 'published'),
    'plans_solo', (select count(*) from public.nutrition_plans where coach_id is null),
    'meals_total', (select count(*) from public.planned_meals),
    'favorites_total', (select count(*) from public.food_favorites),
    'avg_kcal_per_day', (select round(avg(d.kcal)) from (
                           select sum(kcal) as kcal from public.food_logs
                           where received_at >= v_from group by user_id, date) d)
  );
end;
$$;
revoke execute on function public.admin_nutrition_stats(int) from public, anon;
grant execute on function public.admin_nutrition_stats(int) to authenticated;

-- ---------- 4m. social ----------
create or replace function public.admin_social_posts(
  p_type text default null, p_visibility text default null, p_status text default null, -- live | deleted
  p_search text default null, p_author uuid default null,
  p_limit int default 25, p_offset int default 0
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_needle text := nullif(trim(coalesce(p_search, '')), '');
  v_rows jsonb; v_stats jsonb;
  v_7d timestamptz := now() - interval '7 days';
begin
  perform public.admin_assert();
  p_limit := least(greatest(coalesce(p_limit, 25), 1), 100);
  p_offset := greatest(coalesce(p_offset, 0), 0);

  select jsonb_build_object(
    'posts', (select count(*) from public.social_posts where deleted_at is null),
    'posts_7d', (select count(*) from public.social_posts where deleted_at is null and created_at >= v_7d),
    'posts_deleted', (select count(*) from public.social_posts where deleted_at is not null),
    'comments', (select count(*) from public.social_comments),
    'comments_7d', (select count(*) from public.social_comments where created_at >= v_7d),
    'kudos', (select count(*) from public.social_reactions),
    'kudos_7d', (select count(*) from public.social_reactions where created_at >= v_7d),
    'follows', (select count(*) from public.social_follows),
    'follows_7d', (select count(*) from public.social_follows where created_at >= v_7d),
    'active_users_7d', (select count(distinct user_id) from (
                          select user_id from public.social_posts where created_at >= v_7d
                          union select user_id from public.social_comments where created_at >= v_7d
                          union select user_id from public.social_reactions where created_at >= v_7d) a),
    'by_type', (select coalesce(jsonb_object_agg(t.type, t.n), '{}'::jsonb)
                from (select type, count(*) as n from public.social_posts where deleted_at is null group by type) t),
    'by_visibility', (select coalesce(jsonb_object_agg(t.visibility, t.n), '{}'::jsonb)
                      from (select visibility, count(*) as n from public.social_posts where deleted_at is null group by visibility) t),
    'top_authors', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'username', a.username, 'full_name', a.full_name, 'posts', a.n) order by a.n desc), '[]'::jsonb)
                    from (select u.id, u.username, u.full_name, count(*) as n
                          from public.social_posts p join public.users u on u.id = p.user_id
                          where p.deleted_at is null group by u.id, u.username, u.full_name order by n desc limit 10) a)
  ) into v_stats;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.created_at desc), '[]'::jsonb) into v_rows
  from (
    select p.id, p.type, p.text, p.visibility, p.created_at, p.deleted_at, p.payload,
           p.user_id, u.username, u.full_name, u.avatar_url,
           (select count(*) from public.social_comments c where c.post_id = p.id) as comments,
           (select count(*) from public.social_reactions r where r.post_id = p.id) as kudos,
           count(*) over () as total
    from public.social_posts p
    left join public.users u on u.id = p.user_id
    where (p_type is null or p_type = '' or p.type = p_type)
      and (p_visibility is null or p_visibility = '' or p.visibility = p_visibility)
      and (p_status is null or p_status = '' or (p_status = 'live' and p.deleted_at is null) or (p_status = 'deleted' and p.deleted_at is not null))
      and (p_author is null or p.user_id = p_author)
      and (v_needle is null or p.id::text = lower(v_needle) or p.text ilike '%' || v_needle || '%'
           or u.username ilike '%' || v_needle || '%')
    order by p.created_at desc
    limit p_limit offset p_offset
  ) x;
  return jsonb_build_object('stats', v_stats,
    'total', coalesce((v_rows -> 0 ->> 'total')::bigint, 0),
    'rows', (select coalesce(jsonb_agg(r - 'total'), '[]'::jsonb) from jsonb_array_elements(v_rows) r));
end;
$$;
revoke execute on function public.admin_social_posts(text, text, text, text, uuid, int, int) from public, anon;
grant execute on function public.admin_social_posts(text, text, text, text, uuid, int, int) to authenticated;

create or replace function public.admin_social_post(p_post uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.admin_assert();
  return (
    select jsonb_build_object(
      'id', p.id, 'type', p.type, 'text', p.text, 'visibility', p.visibility, 'payload', p.payload,
      'created_at', p.created_at, 'deleted_at', p.deleted_at, 'activity_id', p.activity_id, 'challenge_id', p.challenge_id,
      'author', jsonb_build_object('id', u.id, 'username', u.username, 'full_name', u.full_name, 'avatar_url', u.avatar_url),
      'comments', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'body', c.body, 'created_at', c.created_at,
                     'user_id', c.user_id, 'username', cu.username) order by c.created_at), '[]'::jsonb)
                   from public.social_comments c left join public.users cu on cu.id = c.user_id where c.post_id = p.id),
      'kudos', (select coalesce(jsonb_agg(jsonb_build_object('user_id', r.user_id, 'username', ru.username, 'created_at', r.created_at) order by r.created_at desc), '[]'::jsonb)
                from public.social_reactions r left join public.users ru on ru.id = r.user_id where r.post_id = p.id)
    )
    from public.social_posts p left join public.users u on u.id = p.user_id where p.id = p_post);
end;
$$;
revoke execute on function public.admin_social_post(uuid) from public, anon;
grant execute on function public.admin_social_post(uuid) to authenticated;

-- ---------- 4n. challenges ----------
create or replace function public.admin_challenges()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.admin_assert();
  return jsonb_build_object(
    'stats', (select jsonb_build_object(
      'total', count(*),
      'active', count(*) filter (where start_date <= current_date and end_date >= current_date),
      'upcoming', count(*) filter (where start_date > current_date),
      'finished', count(*) filter (where end_date < current_date),
      'platform', count(*) filter (where creator_id is null),
      'user_created', count(*) filter (where creator_id is not null),
      'participants', (select count(*) from public.challenge_participants),
      'completions', (select count(*) from public.challenge_participants where completed_at is not null),
      'completion_rate', (select case when count(*) = 0 then null
                            else round(100.0 * count(*) filter (where completed_at is not null) / count(*), 1) end
                          from public.challenge_participants)
    ) from public.challenges),
    'rows', (select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.status_rank, x.start_date desc), '[]'::jsonb) from (
      select c.id, c.title_en, c.title_ro, c.type, c.target_value, c.start_date, c.end_date, c.visibility, c.created_at,
             c.creator_id, cu.username as creator_username,
             case when c.start_date <= current_date and c.end_date >= current_date then 'active'
                  when c.start_date > current_date then 'upcoming' else 'finished' end as status,
             case when c.start_date <= current_date and c.end_date >= current_date then 0
                  when c.start_date > current_date then 1 else 2 end as status_rank,
             (select count(*) from public.challenge_participants cp where cp.challenge_id = c.id) as participants,
             (select count(*) from public.challenge_participants cp where cp.challenge_id = c.id and cp.completed_at is not null) as completions
      from public.challenges c left join public.users cu on cu.id = c.creator_id
      order by status_rank, c.start_date desc limit 200) x)
  );
end;
$$;
revoke execute on function public.admin_challenges() from public, anon;
grant execute on function public.admin_challenges() to authenticated;

-- Participants with the same per-session rollups the leaderboard uses, so
-- progress is computed in TypeScript by the shared challengeProgress().
create or replace function public.admin_challenge_detail(p_challenge uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.admin_assert();
  return (
    select jsonb_build_object(
      'id', c.id, 'title_en', c.title_en, 'title_ro', c.title_ro, 'description_en', c.description_en,
      'description_ro', c.description_ro, 'type', c.type, 'target_value', c.target_value,
      'start_date', c.start_date, 'end_date', c.end_date, 'visibility', c.visibility, 'created_at', c.created_at,
      'creator', (select jsonb_build_object('id', u.id, 'username', u.username, 'full_name', u.full_name)
                  from public.users u where u.id = c.creator_id),
      'status', case when c.start_date <= current_date and c.end_date >= current_date then 'active'
                     when c.start_date > current_date then 'upcoming' else 'finished' end,
      'participants', (select coalesce(jsonb_agg(jsonb_build_object(
                         'user_id', cp.user_id, 'username', u.username, 'full_name', u.full_name, 'avatar_url', u.avatar_url,
                         'joined_at', cp.joined_at, 'completed_at', cp.completed_at,
                         'workouts', (select count(*) from public.logged_sessions s where s.user_id = cp.user_id
                                      and s.completed_at is not null and s.started_at::date between c.start_date and c.end_date),
                         'active_days', (select count(distinct s.started_at::date) from public.logged_sessions s where s.user_id = cp.user_id
                                         and s.completed_at is not null and s.started_at::date between c.start_date and c.end_date),
                         'volume_kg', (select coalesce(sum(coalesce(ls.weight_kg, 0) * ls.reps), 0) from public.logged_sets ls
                                       join public.logged_sessions s on s.id = ls.session_id
                                       where s.user_id = cp.user_id and s.completed_at is not null
                                         and s.started_at::date between c.start_date and c.end_date),
                         'load', (select coalesce(sum(public.training_load_score(r.volume, r.sets::int, r.duration_min::int, r.intensity, r.exercises::int)), 0)
                                  from (select sum(coalesce(ls.weight_kg, 0) * ls.reps)::double precision as volume, count(ls.id) as sets,
                                               greatest(0, round(extract(epoch from (s.completed_at - s.started_at)) / 60)) as duration_min,
                                               avg(ls.rpe)::double precision as intensity, count(distinct ls.exercise_id) as exercises
                                        from public.logged_sessions s left join public.logged_sets ls on ls.session_id = s.id
                                        where s.user_id = cp.user_id and s.completed_at is not null
                                          and s.started_at::date between c.start_date and c.end_date
                                        group by s.id, s.started_at, s.completed_at) r)
                       ) order by cp.completed_at desc nulls last, cp.joined_at), '[]'::jsonb)
                       from public.challenge_participants cp join public.users u on u.id = cp.user_id
                       where cp.challenge_id = c.id)
    )
    from public.challenges c where c.id = p_challenge);
end;
$$;
revoke execute on function public.admin_challenge_detail(uuid) from public, anon;
grant execute on function public.admin_challenge_detail(uuid) to authenticated;

-- ---------- 4o. notifications ----------
create or replace function public.admin_notification_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.admin_assert();
  return jsonb_build_object(
    'users_total', (select count(*) from public.users),
    'users_with_push', (select count(distinct user_id) from public.push_subscriptions),
    'users_without_push', (select count(*) from public.users u where not exists (select 1 from public.push_subscriptions p where p.user_id = u.id)),
    'subscriptions', (select count(*) from public.push_subscriptions),
    'subscriptions_7d', (select count(*) from public.push_subscriptions where created_at >= now() - interval '7 days'),
    'users_rest_notify_on', (select count(*) from public.users where rest_prefs ->> 'notify' = 'true'),
    'by_browser', (select coalesce(jsonb_object_agg(b.family, b.n), '{}'::jsonb) from (
                     select case when user_agent ilike '%edg/%' then 'Edge'
                                 when user_agent ilike '%chrome/%' and user_agent not ilike '%edg/%' then 'Chrome'
                                 when user_agent ilike '%firefox/%' then 'Firefox'
                                 when user_agent ilike '%safari/%' and user_agent not ilike '%chrome/%' then 'Safari'
                                 when user_agent is null then 'unknown' else 'other' end as family, count(*) as n
                     from public.push_subscriptions group by 1) b),
    'rest_pushes', (select jsonb_build_object(
      'total', count(*),
      'sent', count(*) filter (where sent_at is not null),
      'cancelled', count(*) filter (where cancelled_at is not null),
      'pending', count(*) filter (where sent_at is null and cancelled_at is null),
      'sent_24h', count(*) filter (where sent_at >= now() - interval '1 day'),
      'sent_7d', count(*) filter (where sent_at >= now() - interval '7 days'),
      'last_sent_at', max(sent_at)
    ) from public.rest_pushes),
    'notifications', (select jsonb_build_object(
      'total', count(*),
      'unsent', count(*) filter (where sent_at is null),
      'unread', count(*) filter (where read_at is null),
      'created_7d', count(*) filter (where created_at >= now() - interval '7 days'),
      'by_category', (select coalesce(jsonb_object_agg(c.category, c.n), '{}'::jsonb)
                      from (select category::text, count(*) as n from public.notifications group by category) c)
    ) from public.notifications),
    'recent_subscriptions', (select coalesce(jsonb_agg(jsonb_build_object('id', ps.id, 'user_id', ps.user_id, 'username', u.username,
                               'full_name', u.full_name, 'user_agent', ps.user_agent, 'created_at', ps.created_at, 'updated_at', ps.updated_at) order by ps.updated_at desc), '[]'::jsonb)
                             from (select * from public.push_subscriptions order by updated_at desc limit 50) ps
                             left join public.users u on u.id = ps.user_id)
  );
end;
$$;
revoke execute on function public.admin_notification_stats() from public, anon;
grant execute on function public.admin_notification_stats() to authenticated;

-- ---------- 4p. system ----------
create or replace function public.admin_system_health()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_cron jsonb := null;
  v_migration text := null;
  v_migrations int := null;
  v_cron_runs jsonb := null;
  v_rest_push boolean := false;
begin
  perform public.admin_assert();
  if exists (select 1 from pg_namespace where nspname = 'vault') then
    execute $q$ select count(*) = 2 from vault.decrypted_secrets where name in ('rest_push_url', 'rest_push_key') $q$
      into v_rest_push;
  end if;
  if exists (select 1 from pg_namespace where nspname = 'supabase_migrations') then
    execute 'select max(version), count(*) from supabase_migrations.schema_migrations' into v_migration, v_migrations;
  end if;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $q$
      select coalesce(jsonb_agg(jsonb_build_object('name', j.jobname, 'schedule', j.schedule, 'active', j.active,
        'last_status', r.status, 'last_start', r.start_time, 'last_end', r.end_time, 'last_message', left(r.return_message, 200)) order by j.jobname), '[]'::jsonb)
      from cron.job j
      left join lateral (select status, start_time, end_time, return_message from cron.job_run_details d
                         where d.jobid = j.jobid order by start_time desc limit 1) r on true
    $q$ into v_cron;
    execute $q$
      select jsonb_build_object(
        'failed_24h', count(*) filter (where status = 'failed' and start_time >= now() - interval '1 day'),
        'runs_24h', count(*) filter (where start_time >= now() - interval '1 day'))
      from cron.job_run_details
    $q$ into v_cron_runs;
  end if;
  return jsonb_build_object(
    'db_now', now(),
    'db_version', version(),
    'db_size', pg_size_pretty(pg_database_size(current_database())),
    'latest_migration', v_migration,
    'migrations_applied', v_migrations,
    'pg_cron', v_cron,
    'cron_runs', v_cron_runs,
    'extensions', (select coalesce(jsonb_agg(extname order by extname), '[]'::jsonb) from pg_extension
                   where extname in ('pg_cron', 'pg_net', 'pgcrypto', 'pg_trgm', 'unaccent', 'supabase_vault', 'pgtap')),
    'rest_push_configured', v_rest_push,
    'rest_pushes_stuck', (select count(*) from public.rest_pushes
                          where sent_at is null and cancelled_at is null and notify_at < now() - interval '5 minutes'),
    'notifications_unsent', (select count(*) from public.notifications where sent_at is null),
    'deletion_requests_overdue', (select count(*) from public.account_deletion_requests
                                  where status = 'pending' and purge_after < now()),
    'adherence_last_computed', (select max(computed_at) from public.adherence_snapshots),
    'failed_logins_1h', (select count(*) from public.admin_audit_events
                         where action = 'LOGIN_FAILED' and created_at >= now() - interval '1 hour'),
    'audit_events_total', (select count(*) from public.admin_audit_events),
    'table_counts', jsonb_build_object(
      'users', (select count(*) from public.users),
      'logged_sessions', (select count(*) from public.logged_sessions),
      'logged_sets', (select count(*) from public.logged_sets),
      'food_logs', (select count(*) from public.food_logs),
      'foods', (select count(*) from public.foods),
      'exercises', (select count(*) from public.exercises),
      'social_posts', (select count(*) from public.social_posts),
      'push_subscriptions', (select count(*) from public.push_subscriptions),
      'notifications', (select count(*) from public.notifications))
  );
end;
$$;
revoke execute on function public.admin_system_health() from public, anon;
grant execute on function public.admin_system_health() to authenticated;

-- ---------- 4q. global search ----------
-- One statement, seven arms, each capped: never a query per hit.
create or replace function public.admin_search(p_query text, p_limit int default 8)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_needle text := nullif(trim(coalesce(p_query, '')), '');
  v_uuid uuid := null;
begin
  perform public.admin_assert();
  if v_needle is null or length(v_needle) < 2 then
    return jsonb_build_object('users', '[]'::jsonb, 'invitations', '[]'::jsonb, 'exercises', '[]'::jsonb,
      'challenges', '[]'::jsonb, 'posts', '[]'::jsonb, 'audit', '[]'::jsonb, 'foods', '[]'::jsonb);
  end if;
  p_limit := least(greatest(coalesce(p_limit, 8), 1), 25);
  begin
    v_uuid := v_needle::uuid;
  exception when invalid_text_representation then
    v_uuid := null;
  end;
  return jsonb_build_object(
    'users', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'username', x.username, 'full_name', x.full_name,
                'email', x.email, 'role', x.role, 'avatar_url', x.avatar_url)), '[]'::jsonb)
              from (select u.id, u.username, u.full_name, au.email, u.role::text as role, u.avatar_url
                    from public.users u left join auth.users au on au.id = u.id
                    where u.id = v_uuid or u.username ilike '%' || v_needle || '%'
                       or u.full_name ilike '%' || v_needle || '%' or au.email ilike '%' || v_needle || '%'
                    order by (u.id = v_uuid) desc, u.created_at desc limit p_limit) x),
    'invitations', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'status', t.status::text, 'coach_username', cu.username,
                      'client_username', cl.username, 'created_at', t.created_at)), '[]'::jsonb)
                    from public.trainer_clients t left join public.users cu on cu.id = t.coach_id
                    left join public.users cl on cl.id = t.client_id
                    where t.id = v_uuid or cu.username ilike '%' || v_needle || '%' or cl.username ilike '%' || v_needle || '%'
                    limit p_limit),
    'exercises', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'name_en', e.name_en, 'name_ro', e.name_ro,
                    'category', e.category, 'source', e.source)), '[]'::jsonb)
                  from (select * from public.exercises e
                        where e.id = v_uuid or e.name_en ilike '%' || v_needle || '%' or e.name_ro ilike '%' || v_needle || '%'
                        order by e.name_en limit p_limit) e),
    'foods', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', coalesce(f.name_en, f.name_ro), 'brand', f.brand,
                'source', f.source::text, 'barcode', f.barcode)), '[]'::jsonb)
              from (select * from public.foods f
                    where f.id = v_uuid or f.barcode = v_needle or f.name_en ilike '%' || v_needle || '%' or f.name_ro ilike '%' || v_needle || '%'
                    order by f.verified desc, f.name_en limit p_limit) f),
    'challenges', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'title_en', c.title_en, 'title_ro', c.title_ro,
                     'start_date', c.start_date, 'end_date', c.end_date)), '[]'::jsonb)
                   from (select * from public.challenges c
                         where c.id = v_uuid or c.title_en ilike '%' || v_needle || '%' or c.title_ro ilike '%' || v_needle || '%'
                         order by c.start_date desc limit p_limit) c),
    'posts', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'type', p.type, 'text', left(p.text, 100),
                'username', p.username, 'created_at', p.created_at, 'deleted', p.deleted_at is not null)), '[]'::jsonb)
              from (select p.*, u.username from public.social_posts p left join public.users u on u.id = p.user_id
                    where p.id = v_uuid or p.text ilike '%' || v_needle || '%' or u.username ilike '%' || v_needle || '%'
                    order by p.created_at desc limit p_limit) p),
    'audit', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'action', a.action::text, 'entity_type', a.entity_type,
                'entity_id', a.entity_id, 'created_at', a.created_at, 'actor_username', au.username)), '[]'::jsonb)
              from (select * from public.admin_audit_events a
                    where a.entity_id = v_needle or (v_needle ~ '^[0-9]+$' and a.id = v_needle::bigint)
                       or a.metadata::text ilike '%' || v_needle || '%'
                    order by a.created_at desc limit p_limit) a left join public.users au on au.id = a.actor_user_id)
  );
end;
$$;
revoke execute on function public.admin_search(text, int) from public, anon;
grant execute on function public.admin_search(text, int) to authenticated;
