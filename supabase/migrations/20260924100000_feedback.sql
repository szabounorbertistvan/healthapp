-- HealthApp schema · feedback: bugs and suggestions from the people using the app
--
-- A "Send feedback" button in both shells (client and coach) opens a short
-- form — kind (bug / idea / other) and free text. Until now the only channel
-- was WhatsApp, which nobody can triage.
--
-- Same shape as app_errors (20260922100000): written only through a security
-- definer function that caps each account (10 an hour), read and triaged only
-- by an admin through admin_* RPCs. The author's own rows are not readable
-- back — there is no inbox screen, so there is nothing to show them.

create table public.feedback (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  -- Kept when the account goes: what someone told us stays useful.
  user_id uuid references public.users (id) on delete set null,
  kind text not null check (kind in ('bug', 'idea', 'other')),
  message text not null check (length(message) between 1 and 4000),
  -- The screen they were on when they opened the form.
  route text check (route is null or length(route) <= 300),
  user_agent text check (user_agent is null or length(user_agent) <= 512),
  locale text check (locale is null or locale in ('en', 'ro')),
  -- new → seen (read, being considered) → done (fixed / shipped / answered)
  status text not null default 'new' check (status in ('new', 'seen', 'done')),
  handled_at timestamptz,
  handled_by uuid
);
create index feedback_created_idx on public.feedback (created_at desc);
create index feedback_open_idx on public.feedback (created_at desc) where status <> 'done';

alter table public.feedback enable row level security;
create policy feedback_admin_read on public.feedback for select to authenticated
  using (public.is_admin());
revoke insert, update, delete on table public.feedback from authenticated, anon;
revoke all on table public.feedback from anon;
grant select on table public.feedback to authenticated;

/**
 * The only writer. Signed-in accounts only; over the cap it raises, so the
 * form can say "try later" instead of pretending the message went through.
 */
create or replace function public.submit_feedback(
  p_kind text,
  p_message text,
  p_route text default null,
  p_user_agent text default null,
  p_locale text default null
) returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_message text := nullif(btrim(coalesce(p_message, '')), '');
  v_recent int;
  v_id bigint;
begin
  if v_user is null then
    raise exception 'NOT_SIGNED_IN' using errcode = '42501';
  end if;
  if v_message is null then
    raise exception 'FEEDBACK_EMPTY' using errcode = '22023';
  end if;
  if p_kind not in ('bug', 'idea', 'other') then
    raise exception 'FEEDBACK_KIND' using errcode = '22023';
  end if;

  select count(*) into v_recent from public.feedback
   where user_id = v_user and created_at >= now() - interval '1 hour';
  if v_recent >= 10 then
    raise exception 'FEEDBACK_RATE' using errcode = 'P0001';
  end if;

  insert into public.feedback (user_id, kind, message, route, user_agent, locale)
  values (
    v_user, p_kind, left(v_message, 4000), left(nullif(p_route, ''), 300),
    left(nullif(p_user_agent, ''), 512),
    case when p_locale in ('en', 'ro') then p_locale end
  )
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.submit_feedback(text, text, text, text, text) from public, anon;
grant execute on function public.submit_feedback(text, text, text, text, text) to authenticated;

/** Move one item along new → seen → done (or back). Writes an audit row. */
create or replace function public.admin_set_feedback_status(p_id bigint, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_message text;
begin
  perform public.admin_assert();
  if p_status not in ('new', 'seen', 'done') then
    raise exception 'FEEDBACK_STATUS' using errcode = '22023';
  end if;
  update public.feedback
     set status = p_status,
         handled_at = case when p_status = 'new' then null else now() end,
         handled_by = case when p_status = 'new' then null else auth.uid() end
   where id = p_id
   returning message into v_message;
  if v_message is null then return; end if;
  perform public.audit_log('ADMIN_ACTION', 'feedback', p_id::text, null,
    jsonb_build_object('kind', 'feedback_status', 'status', p_status, 'name', left(v_message, 120)));
end;
$$;
revoke execute on function public.admin_set_feedback_status(bigint, text) from public, anon;
grant execute on function public.admin_set_feedback_status(bigint, text) to authenticated;

/** The feedback page: counters plus one page of rows under the filters. */
create or replace function public.admin_feedback(
  p_days int default 30,
  p_kind text default null,
  p_status text default null,
  p_search text default null,
  p_limit int default 50, p_offset int default 0
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_from timestamptz;
  v_needle text := nullif(btrim(coalesce(p_search, '')), '');
  v_rows jsonb; v_stats jsonb;
begin
  perform public.admin_assert();
  p_days := least(greatest(coalesce(p_days, 30), 1), 365);
  p_limit := least(greatest(coalesce(p_limit, 50), 1), 200);
  p_offset := greatest(coalesce(p_offset, 0), 0);
  v_from := now() - make_interval(days => p_days);

  select jsonb_build_object(
    'days', p_days,
    'total', count(*),
    'window', count(*) filter (where created_at >= v_from),
    'new', count(*) filter (where status = 'new'),
    'seen', count(*) filter (where status = 'seen'),
    'done', count(*) filter (where status = 'done'),
    'bug', count(*) filter (where created_at >= v_from and kind = 'bug'),
    'idea', count(*) filter (where created_at >= v_from and kind = 'idea'),
    'other', count(*) filter (where created_at >= v_from and kind = 'other'),
    'users', count(distinct user_id) filter (where created_at >= v_from),
    'last_at', max(created_at)
  ) into v_stats from public.feedback;

  select coalesce(jsonb_agg(row_to_json(r)::jsonb order by r.created_at desc), '[]'::jsonb) into v_rows from (
    select f.id, f.created_at, f.kind, f.message, f.route, f.user_agent, f.locale,
           f.status, f.handled_at, f.user_id, u.username, u.full_name, u.role,
           count(*) over () as total
      from public.feedback f
      left join public.users u on u.id = f.user_id
     where f.created_at >= v_from
       and (p_kind is null or p_kind = '' or f.kind = p_kind)
       and (p_status is null or p_status = '' or f.status = p_status)
       and (v_needle is null or f.message ilike '%' || v_needle || '%' or f.route ilike '%' || v_needle || '%'
            or u.username ilike '%' || v_needle || '%')
     order by f.created_at desc
     limit p_limit offset p_offset
  ) r;

  return jsonb_build_object('stats', v_stats,
    'total', coalesce((v_rows -> 0 ->> 'total')::bigint, 0),
    'rows', (select coalesce(jsonb_agg(r - 'total'), '[]'::jsonb) from jsonb_array_elements(v_rows) r));
end;
$$;
revoke execute on function public.admin_feedback(int, text, text, text, int, int) from public, anon;
grant execute on function public.admin_feedback(int, text, text, text, int, int) to authenticated;
