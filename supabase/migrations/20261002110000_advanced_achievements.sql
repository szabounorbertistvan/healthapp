-- HealthApp schema · advanced achievements
--
-- Extends the badge engine that 20260930120000_social_v2_completion.sql built
-- instead of adding a second one. The tables stay `badges` / `user_badges`;
-- the award function, its triggers, the share guard and social_badges() are
-- the same objects, rewritten in place.
--
-- 1. The catalog carries its own rule. Each badge gains `category`, `rarity`,
--    `kind` (standard | advanced — metadata only, nothing is gated on it),
--    `metric`, `target` and `active`. The twelve thresholds that were
--    hard-coded in award_badges_for() move into those columns unchanged, so
--    a new milestone is a catalog row, not a code change.
--
-- 2. achievement_facts(user, metrics) computes every metric the catalog can
--    name from the owner's real rows — one aggregate per metric, and only the
--    metrics asked for. Nothing a client sends is ever an input: there is no
--    "current" anywhere in the API that a browser could set.
--
--      workouts          completed logged_sessions                (as before)
--      longest_streak    longest_workout_streak()                  (as before)
--      prs               logged_sets flagged is_pr                 (as before)
--      checkins          check_ins                                 (as before)
--      challenges        challenge_participants.completed_at       (as before)
--      longest_food_run  longest run of days with a food log       (as before)
--      volume_kg         Σ weight × reps, completed sessions, reps > 0 — the
--                        rule challenge_value('volume') already uses
--      active_days       distinct local days with a completed workout, a food
--                        log or a habit log — challenge_value('active_days'),
--                        over the whole history
--      nutrition_days    days whose food logs add up to more than 0 kcal —
--                        challenge_value('nutrition_days'), whole history
--      bench_kg / squat_kg / deadlift_kg
--                        the HEAVIEST WEIGHT actually lifted for at least one
--                        rep in a completed session, on the canonical library
--                        lift (below). Weight lifted — never an estimate.
--      e1rm_total_kg     Σ over the three lifts of the best ESTIMATED 1RM,
--                        under relevantOneRm() (packages/shared
--                        exercise-analytics): weight > 0, 1..12 reps, one rep
--                        at face value, otherwise Epley. Same rule and the same
--                        exact ×30 key as exercise_best_sets() and
--                        challenge_value('strength_gain'); no new formula.
--
--    The canonical lifts are system rows from Free Exercise DB, matched by
--    external_id (bench: Barbell_Bench_Press_-_Medium_Grip,
--    Bench_Press_-_Powerlifting · squat: Barbell_Squat, Barbell_Full_Squat ·
--    deadlift: Barbell_Deadlift). A coach's custom "Bench press" does not
--    count: a free-text exercise cannot vouch for what was lifted.
--
-- 3. award_badges_for(user, notify, metrics) is still engine-only, still
--    idempotent on the (user_id, badge_id) key, still one notification per
--    newly inserted row — so a retry, a refresh or two racing transactions
--    award and notify once. It now computes only the metrics of badges the
--    person does not hold yet, and every badge those facts satisfy is awarded
--    in the same run. Inactive badges are never awarded.
--
-- 4. Triggers: logged_sessions and challenge_participants as before; check_ins
--    evaluates only `checkins`; food_logs becomes a statement trigger (a meal
--    of five foods is one evaluation, not five) and habit_logs gets one, both
--    stopping early when nothing they could move is still missing.
--
-- 5. achievement_progress(): the caller's own catalog with current / target
--    and the award date. It answers for auth.uid() only, and awards anything
--    the facts already satisfy before answering (the same award path, so it
--    is idempotent and notifies once) — a backstop, never the primary path.
--
-- 6. social_badges() and the achievement post snapshot carry the new metadata.
--    Privacy is unchanged: can_see_stats() gates social_badges().
--
-- 7. History: every existing user is awarded what their rows already earn,
--    silently (p_notify = false), exactly like the social v2 backfill.

-- ---------- 1. catalog metadata ----------
alter table public.badges
  add column if not exists category text,
  add column if not exists rarity text,
  add column if not exists kind text not null default 'standard',
  add column if not exists metric text,
  add column if not exists target numeric,
  add column if not exists active boolean not null default true;

comment on column public.badges.kind is
  'standard | advanced. Catalog metadata only — no access rule reads it.';
comment on column public.badges.rarity is
  'common | rare | epic | legendary. A property of the badge, fixed in the catalog; never computed from who holds it.';
comment on column public.badges.metric is
  'The achievement_facts() key the award compares with target.';

update public.badges b set category = v.category, rarity = v.rarity, metric = v.metric, target = v.target
from (values
  ('first-workout',   'workouts',    'common', 'workouts',          1),
  ('workouts-10',     'workouts',    'common', 'workouts',          10),
  ('workouts-50',     'workouts',    'rare',   'workouts',          50),
  ('workouts-100',    'workouts',    'rare',   'workouts',          100),
  ('streak-7',        'consistency', 'common', 'longest_streak',    7),
  ('streak-30',       'consistency', 'rare',   'longest_streak',    30),
  ('streak-100',      'consistency', 'epic',   'longest_streak',    100),
  ('first-pr',        'strength',    'common', 'prs',               1),
  ('prs-10',          'strength',    'common', 'prs',               10),
  ('first-checkin',   'progress',    'common', 'checkins',          1),
  ('first-challenge', 'challenges',  'common', 'challenges',        1),
  ('nutrition-week',  'nutrition',   'common', 'longest_food_run',  7)
) as v(slug, category, rarity, metric, target)
where b.slug = v.slug;

insert into public.badges (slug, name_en, name_ro, icon, sort, category, rarity, kind, metric, target) values
  ('workouts-250',      '250 workouts',              '250 de antrenamente',              'dumbbell', 13, 'workouts',    'epic',      'advanced', 'workouts',       250),
  ('workouts-500',      '500 workouts',              '500 de antrenamente',              'dumbbell', 14, 'workouts',    'epic',      'advanced', 'workouts',       500),
  ('workouts-1000',     '1,000 workouts',            '1.000 de antrenamente',            'dumbbell', 15, 'workouts',    'legendary', 'advanced', 'workouts',       1000),
  ('volume-100k',       '100,000 kg lifted',         '100.000 kg ridicate',              'weight',   16, 'volume',      'rare',      'advanced', 'volume_kg',      100000),
  ('volume-500k',       '500,000 kg lifted',         '500.000 kg ridicate',              'weight',   17, 'volume',      'epic',      'advanced', 'volume_kg',      500000),
  ('volume-1m',         '1,000,000 kg lifted',       '1.000.000 kg ridicate',            'weight',   18, 'volume',      'legendary', 'advanced', 'volume_kg',      1000000),
  ('active-days-30',    '30 active days',            '30 de zile active',                'calendar', 19, 'consistency', 'common',    'advanced', 'active_days',    30),
  ('active-days-90',    '90 active days',            '90 de zile active',                'calendar', 20, 'consistency', 'rare',      'advanced', 'active_days',    90),
  ('active-days-180',   '180 active days',           '180 de zile active',               'calendar', 21, 'consistency', 'epic',      'advanced', 'active_days',    180),
  ('active-days-365',   '365 active days',           '365 de zile active',               'calendar', 22, 'consistency', 'legendary', 'advanced', 'active_days',    365),
  ('prs-25',            '25 personal records',       '25 de recorduri personale',        'trophy',   23, 'strength',    'rare',      'advanced', 'prs',            25),
  ('prs-50',            '50 personal records',       '50 de recorduri personale',        'trophy',   24, 'strength',    'epic',      'advanced', 'prs',            50),
  ('prs-100',           '100 personal records',      '100 de recorduri personale',       'trophy',   25, 'strength',    'legendary', 'advanced', 'prs',            100),
  ('bench-100',         'Bench press 100 kg',        'Împins la piept 100 kg',           'barbell',  26, 'strength',    'epic',      'advanced', 'bench_kg',       100),
  ('squat-140',         'Squat 140 kg',              'Genuflexiuni 140 kg',              'barbell',  27, 'strength',    'epic',      'advanced', 'squat_kg',       140),
  ('deadlift-180',      'Deadlift 180 kg',           'Îndreptări 180 kg',                'barbell',  28, 'strength',    'epic',      'advanced', 'deadlift_kg',    180),
  ('e1rm-total-1000',   '1,000 kg estimated total',  'Total estimat de 1.000 kg',        'barbell',  29, 'strength',    'legendary', 'advanced', 'e1rm_total_kg',  1000),
  ('nutrition-days-30', '30 days of food logged',    '30 de zile cu mesele notate',      'food',     30, 'nutrition',   'rare',      'advanced', 'nutrition_days', 30),
  ('nutrition-days-100','100 days of food logged',   '100 de zile cu mesele notate',     'food',     31, 'nutrition',   'epic',      'advanced', 'nutrition_days', 100),
  ('challenges-5',      '5 challenges completed',    '5 provocări finalizate',           'target',   32, 'challenges',  'rare',      'advanced', 'challenges',     5),
  ('challenges-10',     '10 challenges completed',   '10 provocări finalizate',          'target',   33, 'challenges',  'epic',      'advanced', 'challenges',     10),
  ('challenges-25',     '25 challenges completed',   '25 de provocări finalizate',       'target',   34, 'challenges',  'legendary', 'advanced', 'challenges',     25)
on conflict (slug) do nothing;

-- Every row has a rule now; a badge nobody can compute is not a badge.
alter table public.badges
  alter column category set not null,
  alter column rarity set not null,
  alter column metric set not null,
  alter column target set not null;
alter table public.badges drop constraint if exists badges_category_check;
alter table public.badges add constraint badges_category_check
  check (category in ('strength', 'workouts', 'consistency', 'volume', 'nutrition', 'challenges', 'progress'));
alter table public.badges drop constraint if exists badges_rarity_check;
alter table public.badges add constraint badges_rarity_check
  check (rarity in ('common', 'rare', 'epic', 'legendary'));
alter table public.badges drop constraint if exists badges_kind_check;
alter table public.badges add constraint badges_kind_check check (kind in ('standard', 'advanced'));
alter table public.badges drop constraint if exists badges_metric_check;
alter table public.badges add constraint badges_metric_check
  check (metric in ('workouts', 'longest_streak', 'prs', 'checkins', 'challenges', 'longest_food_run',
                    'volume_kg', 'active_days', 'nutrition_days',
                    'bench_kg', 'squat_kg', 'deadlift_kg', 'e1rm_total_kg'));
alter table public.badges drop constraint if exists badges_target_check;
alter table public.badges add constraint badges_target_check check (target > 0);

-- ---------- 2. the facts ----------
/**
 * The metrics the catalog compares against, computed from the person's own
 * rows. `p_metrics` limits the work to the keys asked for (null = all).
 * Engine-only: not granted, because it reads past can_see_stats().
 */
create or replace function public.achievement_facts(p_user uuid, p_metrics text[] default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  f jsonb := '{}'::jsonb;
  tz text;
  want text[] := coalesce(p_metrics, array[
    'workouts', 'longest_streak', 'prs', 'checkins', 'challenges', 'longest_food_run',
    'volume_kg', 'active_days', 'nutrition_days', 'bench_kg', 'squat_kg', 'deadlift_kg', 'e1rm_total_kg']);
  n numeric;
  lifts jsonb;
begin
  if p_user is null then return f; end if;
  select coalesce(u.timezone, 'Europe/Bucharest') into tz from public.users u where u.id = p_user;
  tz := coalesce(tz, 'Europe/Bucharest');

  if 'workouts' = any(want) then
    select count(*) into n from public.logged_sessions where user_id = p_user and completed_at is not null;
    f := f || jsonb_build_object('workouts', n);
  end if;

  if 'longest_streak' = any(want) then
    f := f || jsonb_build_object('longest_streak', public.longest_workout_streak(p_user));
  end if;

  if 'prs' = any(want) then
    select count(*) into n from public.logged_sets where user_id = p_user and is_pr;
    f := f || jsonb_build_object('prs', n);
  end if;

  if 'checkins' = any(want) then
    select count(*) into n from public.check_ins where user_id = p_user;
    f := f || jsonb_build_object('checkins', n);
  end if;

  if 'challenges' = any(want) then
    select count(*) into n from public.challenge_participants where user_id = p_user and completed_at is not null;
    f := f || jsonb_build_object('challenges', n);
  end if;

  if 'longest_food_run' = any(want) then
    select coalesce(max(c), 0) into n from (
      select count(*) as c from (
        select d - (row_number() over (order by d))::int as grp
        from (select distinct date as d from public.food_logs where user_id = p_user) days
      ) runs group by grp
    ) x;
    f := f || jsonb_build_object('longest_food_run', n);
  end if;

  if 'volume_kg' = any(want) then
    select coalesce(sum(greatest(ls.weight_kg, 0) * ls.reps), 0) into n
    from public.logged_sets ls
    join public.logged_sessions s on s.id = ls.session_id
    where ls.user_id = p_user and s.completed_at is not null and ls.reps > 0;
    f := f || jsonb_build_object('volume_kg', n);
  end if;

  if 'active_days' = any(want) then
    select count(*) into n from (
      select (s.started_at at time zone tz)::date as d from public.logged_sessions s
      where s.user_id = p_user and s.completed_at is not null
      union
      select fl.date from public.food_logs fl where fl.user_id = p_user
      union
      select h.date from public.habit_logs h where h.user_id = p_user
    ) days;
    f := f || jsonb_build_object('active_days', n);
  end if;

  if 'nutrition_days' = any(want) then
    select count(*) into n from (
      select fl.date from public.food_logs fl where fl.user_id = p_user
      group by fl.date having sum(fl.kcal) > 0
    ) days;
    f := f || jsonb_build_object('nutrition_days', n);
  end if;

  if want && array['bench_kg', 'squat_kg', 'deadlift_kg', 'e1rm_total_kg'] then
    with canon(lift, external_id) as (
      values ('bench', 'Barbell_Bench_Press_-_Medium_Grip'), ('bench', 'Bench_Press_-_Powerlifting'),
             ('squat', 'Barbell_Squat'), ('squat', 'Barbell_Full_Squat'),
             ('deadlift', 'Barbell_Deadlift')
    ),
    ids as (
      select c.lift, e.id from canon c
      join public.exercises e
        on e.external_id = c.external_id and e.source = 'free-exercise-db' and e.owner_id is null
    ),
    per as (
      select i.lift,
             max(ls.weight_kg) as top_kg,
             -- relevantOneRm × 30, exact: a single at face value, else w · (30 + reps).
             max(case when ls.reps = 1 then ls.weight_kg * 30
                      when ls.reps <= 12 then ls.weight_kg * (30 + ls.reps) end) as key30
      from public.logged_sets ls
      join ids i on i.id = ls.exercise_id
      join public.logged_sessions s on s.id = ls.session_id
      where ls.user_id = p_user and s.completed_at is not null
        and ls.weight_kg > 0 and ls.reps >= 1
      group by i.lift
    )
    select jsonb_build_object(
      'bench_kg',      coalesce(max(top_kg) filter (where lift = 'bench'), 0),
      'squat_kg',      coalesce(max(top_kg) filter (where lift = 'squat'), 0),
      'deadlift_kg',   coalesce(max(top_kg) filter (where lift = 'deadlift'), 0),
      'e1rm_total_kg', round(coalesce(sum(key30), 0) / 30, 2))
    into lifts from per;
    f := f || lifts;
  end if;

  return f;
end;
$$;
revoke execute on function public.achievement_facts(uuid, text[]) from public, anon, authenticated;

-- ---------- 3. the award ----------
/**
 * Insert every active badge these facts satisfy and the person does not hold,
 * then notify each newly inserted one. The primary key makes the insert the
 * only arbiter: a second run, or a racing transaction, inserts nothing and so
 * notifies nothing.
 */
create or replace function public.award_badges_from_facts(p_user uuid, p_facts jsonb, p_notify boolean)
returns setof text language plpgsql security definer set search_path = public as $$
declare
  v_slug text;
  v_name text;
  v_name_ro text;
  v_rarity text;
begin
  if p_user is null or p_facts is null then return; end if;
  for v_slug, v_name, v_name_ro, v_rarity in
    with inserted as (
      insert into public.user_badges (user_id, badge_id)
      select p_user, b.id from public.badges b
      where b.active
        and p_facts ? b.metric
        and (p_facts ->> b.metric)::numeric >= b.target
      on conflict (user_id, badge_id) do nothing
      returning badge_id
    )
    select b.slug, b.name_en, b.name_ro, b.rarity
    from inserted i join public.badges b on b.id = i.badge_id
    order by b.sort
  loop
    if p_notify then
      -- Both names travel in the payload so the card reads in the reader's
      -- language; body stays English for push-dispatch, like the other rows.
      insert into public.notifications (user_id, category, title, body, payload)
      values (p_user, 'badge_earned', 'Achievement unlocked', v_name,
              jsonb_build_object('badge_slug', v_slug, 'profile_id', p_user,
                                 'name_en', v_name, 'name_ro', v_name_ro, 'rarity', v_rarity));
    end if;
    return next v_slug;
  end loop;
end;
$$;
revoke execute on function public.award_badges_from_facts(uuid, jsonb, boolean) from public, anon, authenticated;

-- The old two-argument signature goes; the new third argument has a default,
-- so every existing call — award_badges_for(uid) and (uid, false) — still binds.
drop function if exists public.award_badges_for(uuid, boolean);

/**
 * Award every badge this person has earned and does not have yet; return the
 * slugs that were new. Only the metrics of still-missing badges are computed,
 * optionally narrowed further to `p_metrics` by a trigger that knows which
 * rows it touched. Engine-only.
 */
create or replace function public.award_badges_for(p_user uuid, p_notify boolean default true, p_metrics text[] default null)
returns setof text language plpgsql security definer set search_path = public as $$
declare
  v_need text[];
begin
  if p_user is null then return; end if;
  select array_agg(distinct b.metric) into v_need
  from public.badges b
  where b.active
    and (p_metrics is null or b.metric = any(p_metrics))
    and not exists (select 1 from public.user_badges ub where ub.user_id = p_user and ub.badge_id = b.id);
  if v_need is null then return; end if;
  return query select * from public.award_badges_from_facts(p_user, public.achievement_facts(p_user, v_need), p_notify);
end;
$$;
revoke execute on function public.award_badges_for(uuid, boolean, text[]) from public, anon, authenticated;

-- ---------- 4. triggers ----------
/**
 * Row trigger wrapper. TG_ARGV[0], when given, is a comma-separated list of
 * the metrics this table can move. A badge is a nicety; the write that fired
 * the trigger is not — so any failure is logged and swallowed.
 */
create or replace function public.award_badges_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    perform public.award_badges_for(new.user_id, true,
      case when tg_nargs > 0 then string_to_array(tg_argv[0], ',') end);
  exception when others then
    raise warning 'award_badges_for(%) failed: %', new.user_id, sqlerrm;
  end;
  return new;
end;
$$;

-- logged_sessions: unchanged — completion moves nearly every metric.
drop trigger if exists check_ins_award_badges on public.check_ins;
create trigger check_ins_award_badges after insert on public.check_ins
  for each row execute function public.award_badges_trigger('checkins');

drop trigger if exists challenge_participants_award_badges on public.challenge_participants;
create trigger challenge_participants_award_badges
  after update of completed_at on public.challenge_participants
  for each row when (new.completed_at is not null and old.completed_at is null)
  execute function public.award_badges_trigger('challenges');

/**
 * Statement trigger for food and habit logs: once per inserting statement and
 * person, and only while a badge those rows could move is still missing —
 * food is logged many times a day, and most of those inserts have nothing
 * left to decide.
 */
create or replace function public.log_rows_award_badges()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_metrics text[] := string_to_array(tg_argv[0], ',');
  v_user uuid;
begin
  for v_user in select distinct r.user_id from inserted_rows r loop
    if exists (select 1 from public.badges b
               where b.active and b.metric = any(v_metrics)
                 and not exists (select 1 from public.user_badges ub
                                 where ub.user_id = v_user and ub.badge_id = b.id)) then
      begin
        perform public.award_badges_for(v_user, true, v_metrics);
      exception when others then
        raise warning 'award_badges_for(%) failed: %', v_user, sqlerrm;
      end;
    end if;
  end loop;
  return null;
end;
$$;

drop trigger if exists food_logs_award_badges on public.food_logs;
drop function if exists public.food_logs_award_badges();
create trigger food_logs_award_badges after insert on public.food_logs
  referencing new table as inserted_rows
  for each statement execute function public.log_rows_award_badges('longest_food_run,nutrition_days,active_days');

drop trigger if exists habit_logs_award_badges on public.habit_logs;
create trigger habit_logs_award_badges after insert on public.habit_logs
  referencing new table as inserted_rows
  for each statement execute function public.log_rows_award_badges('active_days');

-- ---------- 5. the owner's progress ----------
/**
 * The caller's catalog: every active badge plus any retired one they hold,
 * with the metric's current value computed here from their rows. Awards
 * whatever those facts already satisfy first, through the same idempotent
 * path the triggers use. There is no user argument: it answers for the
 * signed-in person only.
 */
create or replace function public.achievement_progress()
returns table (
  slug text, name_en text, name_ro text, icon text, category text, rarity text, kind text,
  metric text, target numeric, current_value numeric, awarded_at timestamptz, shared boolean, sort int
) language plpgsql volatile security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_user uuid := auth.uid();
  v_facts jsonb;
begin
  if v_user is null then return; end if;
  v_facts := public.achievement_facts(v_user, null);
  perform public.award_badges_from_facts(v_user, v_facts, true);
  return query
    select b.slug, b.name_en, b.name_ro, b.icon, b.category, b.rarity, b.kind, b.metric, b.target,
           coalesce((v_facts ->> b.metric)::numeric, 0), ub.awarded_at,
           (ub.awarded_at is not null and exists (
             select 1 from public.social_posts p
             where p.user_id = v_user and p.type = 'achievement' and p.deleted_at is null
               and p.payload ->> 'badge_slug' = b.slug)),
           b.sort
    from public.badges b
    left join public.user_badges ub on ub.badge_id = b.id and ub.user_id = v_user
    where b.active or ub.user_id is not null
    order by b.sort;
end;
$$;
revoke execute on function public.achievement_progress() from public, anon;
grant execute on function public.achievement_progress() to authenticated;

-- ---------- 6. profile and share ----------
drop function if exists public.social_badges(uuid);
/**
 * A person's badges, for their profile. Empty unless the caller may see their
 * stats. `shared` says whether the owner already posted it — answered only to
 * the owner, since it is about their own feed.
 */
create function public.social_badges(p_user uuid)
returns table (
  slug text, name_en text, name_ro text, icon text, awarded_at timestamptz, shared boolean,
  category text, rarity text, kind text, metric text, target numeric
)
language sql stable security definer set search_path = public as $$
  select b.slug, b.name_en, b.name_ro, b.icon, ub.awarded_at,
    (p_user = auth.uid() and exists (
      select 1 from public.social_posts p
      where p.user_id = p_user and p.type = 'achievement' and p.deleted_at is null
        and p.payload ->> 'badge_slug' = b.slug)),
    b.category, b.rarity, b.kind, b.metric, b.target
  from public.user_badges ub
  join public.badges b on b.id = ub.badge_id
  where ub.user_id = p_user
    and public.can_see_stats(p_user)
  order by ub.awarded_at desc, b.sort;
$$;
revoke execute on function public.social_badges(uuid) from public, anon;
grant execute on function public.social_badges(uuid) to authenticated;

-- The guard, as in 20260930130000, except an achievement's snapshot now also
-- freezes its category, rarity and rule — as the catalog had them when shared.
create or replace function public.social_posts_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_badge record;
  v_real record;
  v_milestone int;
begin
  if new.type = 'text' then
    new.payload := null;
    return new;
  end if;
  if new.payload is not null and new.payload ->> 'kind' is distinct from new.type then
    raise exception 'payload kind does not match post type' using errcode = '22023';
  end if;

  if new.type = 'achievement' then
    select b.slug, b.name_en, b.name_ro, b.icon, b.category, b.rarity, b.metric, b.target, ub.awarded_at
      into v_badge
    from public.user_badges ub join public.badges b on b.id = ub.badge_id
    where ub.user_id = new.user_id and b.slug = new.payload ->> 'badge_slug';
    if not found then
      raise exception 'badge not earned' using errcode = '42501';
    end if;
    new.payload := jsonb_build_object(
      'kind', 'achievement', 'badge_slug', v_badge.slug, 'name_en', v_badge.name_en,
      'name_ro', v_badge.name_ro, 'icon', v_badge.icon, 'awarded_at', v_badge.awarded_at,
      'category', v_badge.category, 'rarity', v_badge.rarity,
      'metric', v_badge.metric, 'target', v_badge.target);
  elsif new.type = 'fitness_score' then
    select f.score, f.band into v_real from public.fitness_score_of(new.user_id) f;
    if v_real.score is null then
      raise exception 'fitness score is still building' using errcode = '22023';
    end if;
    select max(m) into v_milestone
    from unnest(array[25, 50, 60, 70, 80, 90, 100]) m
    where m <= v_real.score;
    if v_milestone is null then
      raise exception 'fitness score is below the first milestone' using errcode = '22023';
    end if;
    new.payload := jsonb_build_object(
      'kind', 'fitness_score', 'score', v_real.score, 'milestone', v_milestone, 'band', v_real.band);
  end if;
  return new;
end;
$$;

-- ---------- 7. history ----------
-- Award everything already earned, silently: a wall of "achievement unlocked"
-- for last year's workouts is noise, not news.
select count(*) from public.users u, lateral public.award_badges_for(u.id, false) a;
