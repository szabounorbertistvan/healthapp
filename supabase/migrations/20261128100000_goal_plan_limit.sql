-- Plan limit on active goals (2026-11-28)
--
-- Progress → Goals (20261125110000) lets anyone hold up to 12 active
-- measurable goals (goals_guard's cap). Premium keeps that; the free plans
-- (free, coach_free) hold 2 at once. Mirrors ENTITLEMENTS.maxActiveGoals in
-- packages/shared/src/entitlements.ts, pinned by entitlements.test.ts.
--
-- Same shape as the other limits (20260923120000): a new key in plan_limit(),
-- read through user_plan_limit(), which answers NULL while the paywall is off
-- for the person — so nothing changes for anyone until the switch is on.
-- Existing goals over the limit (someone who downgraded) stay active; only a
-- goal *becoming* active is refused, with PLAN_LIMIT_REACHED.
--
-- Its own trigger rather than a line in goals_guard: goals_guard is security
-- invoker on purpose (its exercise lookup runs under the caller's RLS), and
-- user_plan_limit is not executable by authenticated since 20261120110000.
-- The setup step's main goal (metric null) is not counted and never refused.

create or replace function public.plan_limit(p_tier text, p_key text)
returns int language sql immutable as $$
  select case p_tier
    when 'free' then case p_key
      when 'own_programs' then 1
      when 'custom_exercises' then 3
      when 'favorite_foods' then 10
      when 'barcode_scans_day' then 5
      when 'active_goals' then 2
    end
    when 'coach_free' then case p_key
      when 'own_programs' then 1
      when 'custom_exercises' then 10
      when 'favorite_foods' then 10
      when 'barcode_scans_day' then 5
      when 'active_goals' then 2
    end
  end;
$$;

create or replace function public.enforce_goal_plan_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_limit int;
begin
  -- Service role, migrations and seeds carry no JWT: they are not a person on a plan.
  if auth.uid() is null or new.metric is null or new.status <> 'active' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'active' and old.metric is not null then
    return new;  -- already counted: editing an active goal is never refused
  end if;
  v_limit := public.user_plan_limit(new.user_id, 'active_goals');
  if v_limit is not null
     and (select count(*) from public.goals
          where user_id = new.user_id and status = 'active' and metric is not null and id <> new.id) >= v_limit then
    raise exception 'PLAN_LIMIT_REACHED' using hint = 'active_goals';
  end if;
  return new;
end;
$$;
revoke execute on function public.enforce_goal_plan_limit() from public, anon, authenticated;

drop trigger if exists goals_plan_limit on public.goals;
create trigger goals_plan_limit before insert or update on public.goals
  for each row execute function public.enforce_goal_plan_limit();
