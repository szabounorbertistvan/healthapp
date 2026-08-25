-- BuddyGym schema · 12 account deletion + the two missing scheduled jobs
--
-- Closes three gaps against PRODUCT_SPEC §5/§8:
--   · request_account_deletion() — G2, and a hard App Store review requirement
--   · detect_streak_risk()       — "19:00 local, items untouched"
--   · detect_checkin_due()       — "check-in day 09:00"
-- request_data_export() and compute_adherence_snapshots() already existed.

-- ---------- GDPR: account deletion ----------
-- Deletion is a queued job (§5): the profile is anonymised immediately so the
-- coach sees "account deleted" on their next refresh, while auth removal and
-- storage purge run under service role within 30 days (§G2).
create table public.account_deletion_requests (
  user_id uuid primary key references public.users (id) on delete cascade,
  requested_at timestamptz not null default now(),
  purge_after timestamptz not null default now() + interval '30 days',
  status text not null default 'pending' check (status in ('pending', 'completed')),
  completed_at timestamptz
);
alter table public.account_deletion_requests enable row level security;

create policy deletion_requests_owner_read on public.account_deletion_requests
  for select to authenticated using (user_id = auth.uid());

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

  -- immediate effects: the account stops being usable to anyone else
  update public.users
  set full_name = 'Deleted user', avatar_url = null, push_token = null
  where id = v_user;

  update public.trainer_clients
  set status = 'ended', ended_at = coalesce(ended_at, now())
  where status in ('invited', 'active')
    and (client_id = v_user or coach_id = v_user);

  return jsonb_build_object('status', 'pending', 'purge_after', v_purge);
end;
$$;

-- ---------- engagement jobs ----------
-- Both run hourly and select the users whose *local* hour matches, because
-- "19:00" and "09:00" in the catalog mean the user's clock, not UTC.

create or replace function public.detect_streak_risk()
returns int language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  with candidates as (
    select u.id, u.locale, s.current,
           (now() at time zone u.timezone)::date as local_date
    from public.users u
    join public.streaks s on s.user_id = u.id and s.type = 'overall' and s.current > 0
    where u.role in ('client', 'both')
      and extract(hour from (now() at time zone u.timezone)) = 19
      -- nothing logged today: the streak really is at risk
      and not exists (select 1 from public.habit_logs hl
                      where hl.user_id = u.id
                        and hl.date = (now() at time zone u.timezone)::date)
      and not exists (select 1 from public.logged_sets ls
                      where ls.user_id = u.id
                        and (ls.received_at at time zone u.timezone)::date
                            = (now() at time zone u.timezone)::date)
      -- max one a day (§8)
      and not exists (select 1 from public.notifications n
                      where n.user_id = u.id and n.category = 'streak_at_risk'
                        and n.created_at > now() - interval '20 hours')
  )
  insert into public.notifications (user_id, category, title, body, payload)
  select c.id, 'streak_at_risk',
         case when c.locale = 'ro' then 'Seria ta se încheie diseară'
              else 'Your streak ends tonight' end,
         case when c.locale = 'ro'
              then format('Ai %s zile la rând — mai ai timp azi.', c.current)
              else format('%s days in a row — there is still time today.', c.current) end,
         jsonb_build_object('screen', 'today', 'streak', c.current)
  from candidates c;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.detect_checkin_due()
returns int language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  with candidates as (
    select u.id, u.locale,
           date_trunc('week', (now() at time zone u.timezone))::date as week_start
    from public.users u
    where u.role in ('client', 'both')
      and extract(hour from (now() at time zone u.timezone)) = 9
      and extract(dow from (now() at time zone u.timezone)) = u.check_in_weekday
      and not exists (select 1 from public.check_ins ci
                      where ci.user_id = u.id
                        and ci.week_start
                            = date_trunc('week', (now() at time zone u.timezone))::date)
      and not exists (select 1 from public.notifications n
                      where n.user_id = u.id and n.category = 'check_in_due'
                        and n.created_at > now() - interval '20 hours')
  )
  insert into public.notifications (user_id, category, title, body, payload)
  select c.id, 'check_in_due',
         case when c.locale = 'ro' then 'Check-in-ul săptămânal te așteaptă'
              else 'Weekly check-in is ready' end,
         case when c.locale = 'ro' then 'Durează 2 minute.' else 'Takes 2 minutes.' end,
         jsonb_build_object('screen', 'check_in', 'week_start', c.week_start)
  from candidates c;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------- execution rights ----------
grant execute on function public.request_account_deletion() to authenticated;
revoke execute on function public.detect_streak_risk() from public, anon, authenticated;
revoke execute on function public.detect_checkin_due() from public, anon, authenticated;

-- ---------- scheduling ----------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    -- hourly: each run only touches users for whom it is 19:00 / 09:00 locally
    perform cron.schedule('streak-risk-hourly', '0 * * * *',
      $cron$ select public.detect_streak_risk(); $cron$);
    perform cron.schedule('checkin-due-hourly', '0 * * * *',
      $cron$ select public.detect_checkin_due(); $cron$);
  end if;
end;
$$;
