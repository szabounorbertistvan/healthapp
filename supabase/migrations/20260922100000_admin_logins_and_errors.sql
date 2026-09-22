-- HealthApp schema · admin panel, part two: real login numbers and an error store
--
-- Two things the panel promised and could not deliver.
--
-- 1. **Every login figure was zero.** 20260920100000 read successful sign-ins
--    from `auth.audit_log_entries` — GoTrue's own log. On a hosted Supabase
--    project that table is empty (verified on the live project 2026-09-22:
--    0 rows, while `admin_audit_events` held 32 USER_LOGIN events over the
--    same days), so Overview, Authentication and the per-user page all showed
--    0 logins, 0 signups, an empty "logins" chart and an empty recent-logins
--    list. Nothing was broken in the panel; it was reading a table nobody
--    writes.
--
--    The source that does work is our own: `audit_auth_login`, the trigger on
--    `auth.users.last_sign_in_at` that writes a USER_LOGIN audit event with
--    the provider. `admin_login_events` below is the one place that decides
--    where a "login" comes from, and the four read functions go through it.
--
--    The trigger fires on an UPDATE of last_sign_in_at, so an account's very
--    first sign-in (stamped at INSERT) is not one of its rows — that moment is
--    USER_CREATED instead. And GoTrue's log is still unioned in, but only
--    while our own stream is empty: on the local stack, where GoTrue does
--    write it, that keeps history from before this migration visible without
--    counting the same sign-in twice afterwards.
--
-- 2. **"Application errors" was a dash.** Overview and System both carried an
--    honest "no error telemetry exists yet" tile. Now there is a store:
--    `app_errors`, written only through `record_app_error()` (a security
--    definer function, rate-capped per user and per address so a loop in a
--    browser cannot fill the table), read only by an admin through
--    `admin_app_errors()`. The app reports from its error boundaries; nothing
--    here ever holds a request body, a token or a form value — a message, a
--    Next.js digest, the route, and a trimmed stack.

-- ============================================================================
-- 1. where a "login" comes from
-- ============================================================================

-- Not exposed to the API: PostgREST would otherwise serve this view to every
-- signed-in user. Only the security-definer functions below read it.
create or replace view public.admin_login_events as
  select a.created_at,
         a.target_user_id as user_id,
         coalesce(a.metadata ->> 'provider', 'email') as provider,
         a.ip
    from public.admin_audit_events a
   where a.action = 'USER_LOGIN'
  union all
  select e.created_at,
         public.admin_uuid_or_null(e.payload ->> 'actor_id'),
         coalesce(e.payload -> 'traits' ->> 'provider', e.payload ->> 'provider'),
         e.ip_address::text
    from auth.audit_log_entries e
   where e.payload ->> 'action' = 'login'
     and not exists (select 1 from public.admin_audit_events where action = 'USER_LOGIN');

comment on view public.admin_login_events is
  'Successful sign-ins for the admin panel: the USER_LOGIN audit events, falling back to GoTrue''s own audit log while ours is empty.';

revoke all on public.admin_login_events from public, anon, authenticated;

-- ============================================================================
-- 2. application errors
-- ============================================================================

create table public.app_errors (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  -- No foreign key: an error outlives the account that hit it, like the audit log.
  user_id uuid,
  -- Where it was caught: a React error boundary, a server component / action,
  -- or an edge function reporting for itself.
  source text not null check (source in ('client', 'server', 'edge')),
  level text not null default 'error' check (level in ('error', 'warn')),
  message text not null check (length(message) between 1 and 500),
  -- Next.js replaces a server error's message with a digest in production;
  -- this is the handle that ties the row to the server log line.
  digest text check (digest is null or length(digest) <= 64),
  route text check (route is null or length(route) <= 300),
  stack text check (stack is null or length(stack) <= 4000),
  user_agent text check (user_agent is null or length(user_agent) <= 512),
  ip text check (ip is null or length(ip) <= 64),
  -- Cleared by an admin once it is understood; the row stays.
  resolved_at timestamptz,
  resolved_by uuid
);
create index app_errors_created_idx on public.app_errors (created_at desc);
create index app_errors_open_idx on public.app_errors (created_at desc) where resolved_at is null;
create index app_errors_message_idx on public.app_errors (message);

alter table public.app_errors enable row level security;
create policy app_errors_admin_read on public.app_errors for select to authenticated
  using (public.is_admin());
revoke insert, update, delete on table public.app_errors from authenticated, anon;
revoke all on table public.app_errors from anon;
grant select on table public.app_errors to authenticated;

/**
 * The only writer. Anyone may report — an error boundary fires for a signed-out
 * visitor too — but each caller is capped: 20 rows an hour per user, and 40 an
 * hour per address for the signed-out ones. Over the cap the call succeeds and
 * writes nothing, so a render loop costs one cheap count, not a full table.
 */
create or replace function public.record_app_error(
  p_source text,
  p_message text,
  p_digest text default null,
  p_route text default null,
  p_stack text default null,
  p_user_agent text default null,
  p_ip text default null,
  p_level text default 'error'
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_message text := nullif(btrim(coalesce(p_message, '')), '');
  v_recent int;
begin
  if v_message is null then return; end if;
  if p_source not in ('client', 'server', 'edge') then return; end if;

  if v_user is not null then
    select count(*) into v_recent from public.app_errors
     where user_id = v_user and created_at >= now() - interval '1 hour';
    if v_recent >= 20 then return; end if;
  else
    select count(*) into v_recent from public.app_errors
     where user_id is null and ip is not distinct from left(p_ip, 64)
       and created_at >= now() - interval '1 hour';
    if v_recent >= 40 then return; end if;
  end if;

  insert into public.app_errors (user_id, source, level, message, digest, route, stack, user_agent, ip)
  values (
    v_user, p_source,
    case when p_level = 'warn' then 'warn' else 'error' end,
    left(v_message, 500), left(nullif(p_digest, ''), 64), left(nullif(p_route, ''), 300),
    left(nullif(p_stack, ''), 4000), left(nullif(p_user_agent, ''), 512), left(nullif(p_ip, ''), 64)
  );
end;
$$;
revoke execute on function public.record_app_error(text, text, text, text, text, text, text, text) from public;
grant execute on function public.record_app_error(text, text, text, text, text, text, text, text) to anon, authenticated;

/** Mark one error, or every error sharing its message, as understood. */
create or replace function public.admin_resolve_app_error(p_id bigint, p_all_alike boolean default false)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_message text;
  v_count int;
begin
  perform public.admin_assert();
  select message into v_message from public.app_errors where id = p_id;
  if v_message is null then return 0; end if;
  if p_all_alike then
    update public.app_errors set resolved_at = now(), resolved_by = auth.uid()
     where message = v_message and resolved_at is null;
  else
    update public.app_errors set resolved_at = now(), resolved_by = auth.uid()
     where id = p_id and resolved_at is null;
  end if;
  get diagnostics v_count = row_count;
  perform public.audit_log('ADMIN_ACTION', 'app_error', p_id::text, null,
    jsonb_build_object('kind', 'resolve_error', 'changed', v_count, 'name', left(v_message, 120)));
  return v_count;
end;
$$;
revoke execute on function public.admin_resolve_app_error(bigint, boolean) from public, anon;
grant execute on function public.admin_resolve_app_error(bigint, boolean) to authenticated;

/**
 * The errors page: the counters, the distinct messages ranked by how often they
 * happen and how recently, and one page of raw rows under the same filters.
 */
create or replace function public.admin_app_errors(
  p_days int default 7,
  p_source text default null,
  p_status text default null,        -- open | resolved
  p_search text default null,
  p_limit int default 50, p_offset int default 0
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_from timestamptz;
  v_needle text := nullif(btrim(coalesce(p_search, '')), '');
  v_rows jsonb; v_groups jsonb; v_stats jsonb;
begin
  perform public.admin_assert();
  p_days := least(greatest(coalesce(p_days, 7), 1), 365);
  p_limit := least(greatest(coalesce(p_limit, 50), 1), 200);
  p_offset := greatest(coalesce(p_offset, 0), 0);
  v_from := now() - make_interval(days => p_days);

  select jsonb_build_object(
    'days', p_days,
    'total', count(*),
    'window', count(*) filter (where created_at >= v_from),
    'last_24h', count(*) filter (where created_at >= now() - interval '1 day'),
    'last_1h', count(*) filter (where created_at >= now() - interval '1 hour'),
    'open', count(*) filter (where resolved_at is null),
    'client', count(*) filter (where created_at >= v_from and source = 'client'),
    'server', count(*) filter (where created_at >= v_from and source = 'server'),
    'edge', count(*) filter (where created_at >= v_from and source = 'edge'),
    'users', count(distinct user_id) filter (where created_at >= v_from),
    'last_at', max(created_at)
  ) into v_stats from public.app_errors;

  select coalesce(jsonb_agg(g), '[]'::jsonb) into v_groups from (
    select jsonb_build_object('message', message, 'count', count(*), 'last_at', max(created_at),
             'first_at', min(created_at), 'sources', array_agg(distinct source),
             'open', count(*) filter (where resolved_at is null),
             'users', count(distinct user_id), 'sample_id', max(id)) as g
      from public.app_errors
     where created_at >= v_from
       and (p_source is null or p_source = '' or source = p_source)
       and (p_status is null or p_status = ''
            or (p_status = 'open' and resolved_at is null)
            or (p_status = 'resolved' and resolved_at is not null))
       and (v_needle is null or message ilike '%' || v_needle || '%' or route ilike '%' || v_needle || '%')
     group by message
     order by count(*) desc, max(created_at) desc
     limit 25
  ) x;

  select coalesce(jsonb_agg(row_to_json(r)::jsonb order by r.created_at desc), '[]'::jsonb) into v_rows from (
    select e.id, e.created_at, e.source, e.level, e.message, e.digest, e.route,
           left(e.stack, 1200) as stack, e.user_agent, e.ip, e.resolved_at,
           e.user_id, u.username, u.full_name,
           count(*) over () as total
      from public.app_errors e
      left join public.users u on u.id = e.user_id
     where e.created_at >= v_from
       and (p_source is null or p_source = '' or e.source = p_source)
       and (p_status is null or p_status = ''
            or (p_status = 'open' and e.resolved_at is null)
            or (p_status = 'resolved' and e.resolved_at is not null))
       and (v_needle is null or e.message ilike '%' || v_needle || '%' or e.route ilike '%' || v_needle || '%')
     order by e.created_at desc
     limit p_limit offset p_offset
  ) r;

  return jsonb_build_object('stats', v_stats, 'groups', v_groups,
    'total', coalesce((v_rows -> 0 ->> 'total')::bigint, 0),
    'rows', (select coalesce(jsonb_agg(r - 'total'), '[]'::jsonb) from jsonb_array_elements(v_rows) r));
end;
$$;
revoke execute on function public.admin_app_errors(int, text, text, text, int, int) from public, anon;
grant execute on function public.admin_app_errors(int, text, text, text, int, int) to authenticated;

-- ============================================================================
-- 3. the read functions, now sourcing logins from admin_login_events
--    (bodies unchanged from 20260920100000 apart from those sub-selects)
-- ============================================================================

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
    'logins_total', (select count(*) from public.admin_login_events),
    'logins_today', (select count(*) from public.admin_login_events where created_at >= v_today),
    'logins_7d', (select count(*) from public.admin_login_events where created_at >= v_7d),
    'logins_30d', (select count(*) from public.admin_login_events where created_at >= v_30d),
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
    (select count(*) from public.admin_login_events e where e.created_at::date = days.day)::int,
    (select count(*) from public.trainer_clients t where t.created_at::date = days.day)::int,
    (select count(*) from public.food_logs f where f.received_at::date = days.day)::int
  from days
  order by days.day;
end;
$$;
revoke execute on function public.admin_daily_series(int) from public, anon;
grant execute on function public.admin_daily_series(int) to authenticated;

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
    'logins_total', (select count(*) from public.admin_login_events e where e.user_id = p_user),
    'logins_30d', (select count(*) from public.admin_login_events e
                   where e.user_id = p_user and e.created_at >= v_30d),
    'failed_30d', (select count(*) from public.admin_audit_events a
                   where a.action = 'LOGIN_FAILED' and a.target_user_id = p_user and a.created_at >= v_30d),
    -- Account events this panel can actually see: the sign-ins above plus the
    -- account-level actions the audit triggers write. GoTrue's own log is not
    -- readable on a hosted project (see the header), so 'logout' and
    -- 'token_revoked' cannot appear here.
    'history', (select coalesce(jsonb_agg(jsonb_build_object('at', h.at, 'action', h.action,
                  'provider', h.provider, 'ip', h.ip) order by h.at desc), '[]'::jsonb)
                from (select e.created_at as at, 'login' as action, e.provider, e.ip
                        from public.admin_login_events e where e.user_id = p_user
                      union all
                      select a.created_at, lower(a.action::text), a.metadata ->> 'provider', a.ip
                        from public.admin_audit_events a
                       where a.target_user_id = p_user
                         and a.action in ('USER_CREATED', 'LOGIN_FAILED', 'ROLE_CHANGED', 'TIER_CHANGED',
                                          'USER_SUSPENDED', 'USER_REACTIVATED', 'ACCOUNT_DELETION_REQUESTED')
                      order by at desc limit 25) h)
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

create or replace function public.admin_auth_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_today timestamptz := date_trunc('day', now());
begin
  perform public.admin_assert();
  return jsonb_build_object(
    'logins_total', (select count(*) from public.admin_login_events),
    'logins_today', (select count(*) from public.admin_login_events where created_at >= v_today),
    'logins_7d', (select count(*) from public.admin_login_events where created_at >= now() - interval '7 days'),
    'logins_30d', (select count(*) from public.admin_login_events where created_at >= now() - interval '30 days'),
    'unique_7d', (select count(distinct user_id) from public.admin_login_events
                  where created_at >= now() - interval '7 days'),
    'unique_30d', (select count(distinct user_id) from public.admin_login_events
                   where created_at >= now() - interval '30 days'),
    'never_logged_in', (select count(*) from auth.users where last_sign_in_at is null),
    'signups_total', (select count(*) from auth.users),
    'recoveries_30d', (select count(*) from auth.users
                       where recovery_sent_at >= now() - interval '30 days'),
    'by_provider', (select coalesce(jsonb_object_agg(p.provider, p.n), '{}'::jsonb)
                    from (select provider, count(*) as n from auth.identities group by provider) p),
    'logins_by_provider_30d', (select coalesce(jsonb_object_agg(p.provider, p.n), '{}'::jsonb)
                    from (select coalesce(e.provider, 'unknown') as provider, count(*) as n
                          from public.admin_login_events e
                          where e.created_at >= now() - interval '30 days'
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
                      from (select e.created_at, e.user_id as uid, e.provider, e.ip
                            from public.admin_login_events e
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
