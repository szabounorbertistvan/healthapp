-- HealthApp schema · 09 RPCs and engine functions

-- ---------- invites ----------
create or replace function public.create_invite()
returns table (invite_id uuid, code text, expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_code text := upper(encode(gen_random_bytes(4), 'hex')); -- 8-char code
  v_row public.trainer_clients;
begin
  insert into public.trainer_clients (coach_id, status, invite_code, invite_expires_at)
  values (auth.uid(), 'invited', v_code, now() + interval '30 days')
  returning * into v_row;
  return query select v_row.id, v_row.invite_code, v_row.invite_expires_at;
end;
$$;

create or replace function public.accept_invite(p_code text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_row public.trainer_clients;
begin
  select * into v_row from public.trainer_clients
  where invite_code = upper(p_code) and status = 'invited'
  for update;

  if not found then
    raise exception 'INVALID_CODE';
  end if;
  if v_row.invite_expires_at < now() then
    raise exception 'EXPIRED';
  end if;
  if v_row.coach_id = auth.uid() then
    raise exception 'INVALID_CODE'; -- coach cannot accept own invite
  end if;
  if exists (select 1 from public.trainer_clients
             where client_id = auth.uid() and status = 'active') then
    raise exception 'ALREADY_HAS_COACH';
  end if;

  update public.trainer_clients
  set client_id = auth.uid(), status = 'active', started_at = now(),
      invite_code = null, invite_expires_at = null
  where id = v_row.id;

  insert into public.conversations (coach_id, client_id)
  values (v_row.coach_id, auth.uid())
  on conflict (coach_id, client_id) do nothing;

  return v_row.id;
end;
$$;

-- ---------- coach dashboard (spec W1: "who needs me today?") ----------
create or replace function public.coach_dashboard()
returns table (
  client_id uuid, full_name text, avatar_url text,
  signal adherence_signal, reason text, overall_pct numeric,
  last_activity timestamptz, pending_checkin boolean, unread_messages bigint
)
language sql stable security definer set search_path = public as $$
  select
    u.id, u.full_name, u.avatar_url,
    coalesce(a.signal, 'needs_attention') as signal,
    coalesce(a.reason, 'No adherence data yet') as reason,
    coalesce(a.overall_pct, 0) as overall_pct,
    greatest(
      (select max(received_at) from public.logged_sets    ls where ls.user_id = u.id),
      (select max(received_at) from public.food_logs      fl where fl.user_id = u.id),
      (select max(submitted_at) from public.check_ins     ci where ci.user_id = u.id)
    ) as last_activity,
    exists (select 1 from public.check_ins ci
            where ci.user_id = u.id and ci.coach_reviewed_at is null) as pending_checkin,
    (select count(*) from public.messages m
       join public.conversations c on c.id = m.conversation_id
     where c.coach_id = auth.uid() and c.client_id = u.id
       and m.sender_id = u.id and m.read_at is null) as unread_messages
  from public.trainer_clients tc
  join public.users u on u.id = tc.client_id
  left join lateral (
    select signal, reason, overall_pct from public.adherence_snapshots s
    where s.user_id = u.id order by s.week_start desc limit 1
  ) a on true
  where tc.coach_id = auth.uid() and tc.status = 'active'
  order by
    case coalesce(a.signal, 'needs_attention')
      when 'at_risk' then 0 when 'needs_attention' then 1 else 2 end,
    pending_checkin desc;
$$;

-- ---------- adherence engine (formula v1, PRODUCT_SPEC.md §7) ----------
-- Computes last week's snapshot for every user who is an active client or has
-- any activity. Weights: workout .40, nutrition .30, habits .15, check-in .15.
-- Runs weekly via pg_cron (see bottom). Service role / cron only — not exposed.
create or replace function public.compute_adherence_snapshots(p_week_start date default null)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_week date := coalesce(p_week_start, date_trunc('week', now() - interval '7 days')::date);
  v_count int := 0;
  r record;
  v_workout numeric; v_nutrition numeric; v_habits numeric;
  v_checkin boolean; v_overall numeric;
  v_signal adherence_signal; v_reason text;
  v_planned int; v_done int; v_days_logged int; v_macro numeric;
  v_ticks int; v_scheduled int; v_last date; v_inactive_days int;
begin
  for r in
    select distinct u.id as user_id
    from public.users u
    where exists (select 1 from public.trainer_clients tc
                  where tc.client_id = u.id and tc.status = 'active')
       or exists (select 1 from public.logged_sessions s
                  where s.user_id = u.id and s.started_at >= v_week - 28)
  loop
    -- workout: completed sessions / planned days this week (solo: self-scheduled)
    select count(distinct d.id) into v_planned
    from public.program_days d
    join public.programs p on p.id = d.program_id
    where p.client_id = r.user_id and p.status = 'published';
    select count(*) into v_done
    from public.logged_sessions s
    where s.user_id = r.user_id and s.completed_at is not null
      and s.started_at >= v_week and s.started_at < v_week + 7;
    v_workout := case when coalesce(v_planned, 0) = 0
                      then least(v_done / 3.0, 1.0)               -- solo heuristic: 3/wk = 100%
                      else least(v_done::numeric / least(v_planned, 7), 1.0) end;

    -- nutrition: 0.6·coverage + 0.4·macro score vs plan kcal target
    select count(distinct date) into v_days_logged
    from public.food_logs where user_id = r.user_id and date >= v_week and date < v_week + 7;
    select coalesce(avg(greatest(0, 1 - abs(day_kcal - t.kcal_target) / t.kcal_target)), 0)
    into v_macro
    from (select date, sum(kcal) as day_kcal from public.food_logs
          where user_id = r.user_id and date >= v_week and date < v_week + 7
          group by date) days
    cross join lateral (
      select kcal_target from public.nutrition_plans
      where client_id = r.user_id and status = 'published'
      order by updated_at desc limit 1
    ) t;
    v_nutrition := 0.6 * (v_days_logged / 7.0) + 0.4 * coalesce(v_macro, 0);

    -- habits
    select count(*) into v_ticks from public.habit_logs
    where user_id = r.user_id and date >= v_week and date < v_week + 7;
    select coalesce(sum(cardinality(weekdays)), 0) into v_scheduled
    from public.habits where user_id = r.user_id and active;
    v_habits := case when v_scheduled = 0 then 0
                     else least(v_ticks::numeric / v_scheduled, 1.0) end;

    -- check-in
    v_checkin := exists (select 1 from public.check_ins
                         where user_id = r.user_id and week_start = v_week);

    v_overall := round(0.40 * v_workout + 0.30 * v_nutrition
               + 0.15 * v_habits + 0.15 * (v_checkin::int), 3);

    -- inactivity override + signal thresholds (spec §7)
    select max(d) into v_last from (
      select max(received_at)::date as d from public.logged_sets  where user_id = r.user_id
      union all
      select max(received_at)::date from public.food_logs where user_id = r.user_id
      union all
      select max(received_at)::date from public.habit_logs where user_id = r.user_id
    ) x;
    v_inactive_days := coalesce(current_date - v_last, 99);

    if v_overall < 0.50 or v_inactive_days >= 5 then
      v_signal := 'at_risk';
    elsif v_overall < 0.80 or not v_checkin or v_inactive_days >= 3 then
      v_signal := 'needs_attention';
    else
      v_signal := 'on_track';
    end if;

    v_reason := format('%s/%s workouts · food logged %s/7 days · habits %s%% · check-in %s%s',
      v_done, coalesce(nullif(least(v_planned,7),0), 3), v_days_logged,
      round(v_habits * 100),
      case when v_checkin then 'done' else 'missed' end,
      case when v_inactive_days >= 3 and v_inactive_days < 99
           then format(' · no logs for %s days', v_inactive_days) else '' end);

    insert into public.adherence_snapshots
      (user_id, week_start, workout_pct, nutrition_pct, habit_pct,
       checkin_done, overall_pct, signal, reason, inputs, formula_version)
    values
      (r.user_id, v_week, round(v_workout,3), round(v_nutrition,3), round(v_habits,3),
       v_checkin, v_overall, v_signal, v_reason,
       jsonb_build_object('planned', v_planned, 'done', v_done,
         'days_logged', v_days_logged, 'macro_score', round(coalesce(v_macro,0),3),
         'habit_ticks', v_ticks, 'habit_scheduled', v_scheduled,
         'inactive_days', v_inactive_days), 1)
    on conflict (user_id, week_start) do update set
      workout_pct = excluded.workout_pct, nutrition_pct = excluded.nutrition_pct,
      habit_pct = excluded.habit_pct, checkin_done = excluded.checkin_done,
      overall_pct = excluded.overall_pct, signal = excluded.signal,
      reason = excluded.reason, inputs = excluded.inputs, computed_at = now();

    -- alert the coach when a client transitions to at_risk
    if v_signal = 'at_risk' then
      insert into public.notifications (user_id, category, title, body, payload)
      select tc.coach_id, 'client_at_risk',
             coalesce(u.full_name, 'A client') || ' is At Risk', v_reason,
             jsonb_build_object('client_id', r.user_id)
      from public.trainer_clients tc join public.users u on u.id = r.user_id
      where tc.client_id = r.user_id and tc.status = 'active'
        and not exists (select 1 from public.notifications n
              where n.user_id = tc.coach_id and n.category = 'client_at_risk'
                and n.payload ->> 'client_id' = r.user_id::text
                and n.created_at > now() - interval '6 days');
    end if;

    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ---------- GDPR ----------
create or replace function public.request_data_export()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return jsonb_build_object(
    'profile',       (select to_jsonb(u) - 'push_token' from public.users u where id = auth.uid()),
    'measurements',  (select coalesce(jsonb_agg(to_jsonb(m)), '[]') from public.measurements m where user_id = auth.uid()),
    'check_ins',     (select coalesce(jsonb_agg(to_jsonb(c)), '[]') from public.check_ins c where user_id = auth.uid()),
    'sessions',      (select coalesce(jsonb_agg(to_jsonb(s)), '[]') from public.logged_sessions s where user_id = auth.uid()),
    'sets',          (select coalesce(jsonb_agg(to_jsonb(l)), '[]') from public.logged_sets l where user_id = auth.uid()),
    'food_logs',     (select coalesce(jsonb_agg(to_jsonb(f)), '[]') from public.food_logs f where user_id = auth.uid()),
    'habits',        (select coalesce(jsonb_agg(to_jsonb(h)), '[]') from public.habits h where user_id = auth.uid()),
    'habit_logs',    (select coalesce(jsonb_agg(to_jsonb(hl)), '[]') from public.habit_logs hl where user_id = auth.uid()),
    'goals',         (select coalesce(jsonb_agg(to_jsonb(g)), '[]') from public.goals g where user_id = auth.uid())
  );
end;
$$;

-- lock down execution
revoke execute on function public.compute_adherence_snapshots(date) from public, anon, authenticated;
grant execute on function public.create_invite() to authenticated;
grant execute on function public.accept_invite(text) to authenticated;
grant execute on function public.coach_dashboard() to authenticated;
grant execute on function public.request_data_export() to authenticated;

-- ---------- scheduling (pg_cron ships with Supabase; guarded for local dev) ----------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('adherence-weekly', '0 3 * * 1',
      $cron$ select public.compute_adherence_snapshots(); $cron$);
  end if;
end;
$$;
