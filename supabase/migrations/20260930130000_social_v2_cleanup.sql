-- HealthApp schema · social v2 cleanup
--
-- 1. The Fitness Score is computed by the DATABASE when it is published or
--    shared. Until now set_public_fitness_score(p_score) and a direct insert
--    of a 'fitness_score' post accepted any 0..100 number the owner's JWT
--    sent: the server action computed the real score, but PostgREST let the
--    same user skip the action and send `100`. The only party that can vouch
--    for the number without a service-role key in the app is the database, so
--    it now computes it itself — and ignores whatever the caller sent.
--
--    fitness_score_of() is NOT a new formula. It is fitnessScore() in
--    packages/shared/src/fitness-score.ts applied to per-session training
--    load from training_load_score() — the SQL mirror of trainingLoadFromStats()
--    that the leaderboards already use and that leaderboard.test.* pins to the
--    TypeScript. The composition (28 local days, the four subscores, their
--    weights, the 3-workout minimum, the bands) is transcribed line for line,
--    and fitness_score_parity (vitest) + social_v2_cleanup.test.sql (pgTAP)
--    pin the two implementations to the same numbers on the same sessions.
--
--    JavaScript's Math.round rounds halves up; Postgres' round(double
--    precision) may round them to even. floor(x + 0.5) is Math.round for the
--    non-negative values used here, so every rounding below uses it.
--
-- 2. Posts get `edited_at`, stamped by a trigger when the caption changes, and
--    the feed carries it so the card can say "edited". The update grant stays
--    exactly as 20260930120000 left it: text, visibility, deleted_at.

-- ---------- 1. the score, computed where it can be trusted ----------
create or replace function public.fitness_score_of(p_user uuid)
returns table (
  score int, status text, band text,
  completed_workouts int, active_days int, total_volume double precision, average_training_load double precision
) language sql stable security definer set search_path = public as $$
  with tz as (
    select coalesce(u.timezone, 'Europe/Bucharest') as name from public.users u where u.id = p_user
  ),
  win as (
    -- fitnessScoreWindow(today, 0): the 28 inclusive local days ending today.
    select (now() at time zone (select name from tz))::date as today
  ),
  sessions as (
    -- loadOf(): sets with reps > 0 carry volume, count and intensity; the
    -- exercise count is every distinct exercise on the session (loadOf counts
    -- names across all sets); duration is Math.round(ms / 60 000).
    select
      (s.started_at at time zone (select name from tz))::date as day,
      public.training_load_score(
        coalesce(sum(greatest(coalesce(ls.weight_kg, 0), 0) * ls.reps) filter (where ls.reps > 0), 0)::double precision,
        (count(ls.id) filter (where ls.reps > 0))::int,
        floor(extract(epoch from (s.completed_at - s.started_at))::double precision / 60 + 0.5)::int,
        -- Only sets that carry an RPE or RIR count toward intensity (effectiveRpe
        -- returns null otherwise). The filter matters: greatest(1, NULL) is 1 in
        -- Postgres, so without it a set with neither would count as RPE 1.
        (avg(least(10, greatest(1, coalesce(ls.rpe, 10 - ls.rir))))
           filter (where ls.reps > 0 and coalesce(ls.rpe, ls.rir) is not null))::double precision,
        (count(distinct ls.exercise_id))::int
      ) as load,
      -- TrainingLoad.volume_kg is Math.round(volume); fitness-score-data sums that.
      floor(coalesce(sum(greatest(coalesce(ls.weight_kg, 0), 0) * ls.reps) filter (where ls.reps > 0), 0)::double precision + 0.5) as volume_kg
    from public.logged_sessions s
    left join public.logged_sets ls on ls.session_id = s.id
    where s.user_id = p_user
      and s.completed_at is not null
      and (s.started_at at time zone (select name from tz))::date
          between (select today from win) - 27 and (select today from win)
    group by s.id, s.started_at, s.completed_at
  ),
  totals as (
    select
      count(*)::int as workouts,
      count(distinct day)::int as days,
      coalesce(sum(volume_kg), 0)::double precision as volume,
      -- sum / n in double precision, as the reduce in fitnessScore() does it
      case when count(*) = 0 then 0::double precision else sum(load)::double precision / count(*) end as avg_load
    from sessions
  ),
  subs as (
    select t.*,
      least(100, greatest(0, case when t.avg_load <= 0 then 0 else 100 * (1 - exp(-t.avg_load / 40.0)) end)) as tl,
      least(100, greatest(0, t.days::double precision / 16 * 100)) as cons,
      least(100, greatest(0, t.workouts::double precision / 16 * 100)) as freq,
      least(100, greatest(0, t.volume / 50000 * 100)) as vol
    from totals t
  ),
  scored as (
    select s.*,
      case when s.workouts < 3 then null
           else least(100, greatest(0, floor(s.tl * 0.35 + s.cons * 0.25 + s.freq * 0.2 + s.vol * 0.2 + 0.5)))::int
      end as sc
    from subs s
  )
  select
    sc,
    case when sc is null then 'building' else 'active' end,
    case when sc is null then null
         when sc >= 80 then 'strong_activity'
         when sc >= 60 then 'developing'
         when sc >= 40 then 'building'
         else 'getting_started' end,
    workouts, days, volume, avg_load
  from scored;
$$;
-- Engine-only: answering it for an arbitrary id would expose someone's
-- training volume. The two callers below ask it about the caller / the author.
revoke execute on function public.fitness_score_of(uuid) from public, anon, authenticated;

/** The caller's own score — what /fitness-score shows, computed here. */
create or replace function public.my_fitness_score()
returns table (score int, status text, band text)
language sql stable security definer set search_path = public as $$
  select f.score, f.status, f.band from public.fitness_score_of(auth.uid()) f where auth.uid() is not null;
$$;
revoke execute on function public.my_fitness_score() from public, anon;
grant execute on function public.my_fitness_score() to authenticated;

-- Publishing takes NO number: it stores the caller's own score as computed
-- above. There is no argument through which a browser could say "100".
drop function if exists public.set_public_fitness_score(int);
create or replace function public.set_public_fitness_score()
returns int language plpgsql security definer set search_path = public as $$
declare
  v_score int;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;
  select f.score into v_score from public.fitness_score_of(auth.uid()) f;
  if v_score is null then
    raise exception 'fitness score is still building' using errcode = '22023';
  end if;
  update public.users
  set fitness_score_public = v_score, fitness_score_public_at = now()
  where id = auth.uid();
  return v_score;
end;
$$;
revoke execute on function public.set_public_fitness_score() from public, anon;
grant execute on function public.set_public_fitness_score() to authenticated;

-- The guard, as in 20260930120000, except a Fitness Score post: the score,
-- milestone and band the caller sent are thrown away and replaced by the
-- author's real ones. A score still building cannot be shared at all.
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
    select b.slug, b.name_en, b.name_ro, b.icon, ub.awarded_at into v_badge
    from public.user_badges ub join public.badges b on b.id = ub.badge_id
    where ub.user_id = new.user_id and b.slug = new.payload ->> 'badge_slug';
    if not found then
      raise exception 'badge not earned' using errcode = '42501';
    end if;
    new.payload := jsonb_build_object(
      'kind', 'achievement', 'badge_slug', v_badge.slug, 'name_en', v_badge.name_en,
      'name_ro', v_badge.name_ro, 'icon', v_badge.icon, 'awarded_at', v_badge.awarded_at);
  elsif new.type = 'fitness_score' then
    select f.score, f.band into v_real from public.fitness_score_of(new.user_id) f;
    if v_real.score is null then
      raise exception 'fitness score is still building' using errcode = '22023';
    end if;
    -- fitnessScoreMilestone(): the highest of the fixed milestones at or under the score.
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

-- ---------- 2. edited posts ----------
alter table public.social_posts add column if not exists edited_at timestamptz;
comment on column public.social_posts.edited_at is
  'Set when the author changes the caption after posting; null for an untouched post.';

create or replace function public.social_posts_mark_edited()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.text is distinct from old.text then
    new.edited_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists social_posts_edited on public.social_posts;
create trigger social_posts_edited before update on public.social_posts
  for each row execute function public.social_posts_mark_edited();

-- The feed and one post carry edited_at. Same select as 20260930120000 plus
-- the column; the return shape changes, so both are dropped and recreated.
drop function if exists public.social_feed(int, timestamptz, uuid, text, text);
create function public.social_feed(
  p_limit int default 20,
  p_before timestamptz default null,
  p_author uuid default null,
  p_scope text default 'following',
  p_type text default null
)
returns table (
  id uuid, user_id uuid, author_name text, author_username text, author_avatar text,
  type text, text text, payload jsonb, visibility text, created_at timestamptz,
  activity_id uuid, challenge_id uuid,
  kudos_count int, comment_count int, my_kudos boolean, kudos_names text[], mentions jsonb,
  edited_at timestamptz
) language sql stable security definer set search_path = public as $$
  select
    p.id, p.user_id,
    coalesce(u.username, u.full_name) as author_name, u.username, u.avatar_url,
    p.type, p.text, p.payload, p.visibility, p.created_at,
    p.activity_id, p.challenge_id,
    (select count(*)::int from public.social_reactions r where r.post_id = p.id),
    (select count(*)::int from public.social_comments c where c.post_id = p.id),
    exists (select 1 from public.social_reactions r where r.post_id = p.id and r.user_id = auth.uid()),
    coalesce((select array_agg(x.name order by x.created_at, x.id) from (
      select coalesce(ru.username, ru.full_name) as name, r.created_at, r.id
      from public.social_reactions r join public.users ru on ru.id = r.user_id
      where r.post_id = p.id order by r.created_at, r.id limit 2
    ) x), '{}'),
    coalesce((
      select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'username', mu.username))
      from public.social_post_mentions m join public.users mu on mu.id = m.user_id
      where m.post_id = p.id
    ), '[]'::jsonb),
    p.edited_at
  from public.social_posts p
  join public.users u on u.id = p.user_id
  where p.deleted_at is null
    and (p_before is null or p.created_at < p_before)
    and (p_type is null or p.type = p_type)
    and (
      case
        when p_author is not null then p.user_id = p_author
        when coalesce(p_scope, 'following') = 'mine' then p.user_id = auth.uid()
        when coalesce(p_scope, 'following') = 'all' then true
        else (p.user_id = auth.uid() or public.is_following(p.user_id))
      end
    )
    and (
      p.user_id = auth.uid()
      or p.visibility = 'public'
      or (p.visibility = 'followers'
          and (public.is_following(p.user_id) or public.is_active_coach_of(p.user_id)))
    )
  order by p.created_at desc, p.id desc
  limit greatest(1, least(p_limit, 50));
$$;
grant execute on function public.social_feed(int, timestamptz, uuid, text, text) to authenticated;

drop function if exists public.social_post(uuid);
create function public.social_post(p_post uuid)
returns table (
  id uuid, user_id uuid, author_name text, author_username text, author_avatar text,
  type text, text text, payload jsonb, visibility text, created_at timestamptz,
  activity_id uuid, challenge_id uuid,
  kudos_count int, comment_count int, my_kudos boolean, kudos_names text[], mentions jsonb,
  edited_at timestamptz
) language sql stable security definer set search_path = public as $$
  select
    p.id, p.user_id,
    coalesce(u.username, u.full_name), u.username, u.avatar_url,
    p.type, p.text, p.payload, p.visibility, p.created_at,
    p.activity_id, p.challenge_id,
    (select count(*)::int from public.social_reactions r where r.post_id = p.id),
    (select count(*)::int from public.social_comments c where c.post_id = p.id),
    exists (select 1 from public.social_reactions r where r.post_id = p.id and r.user_id = auth.uid()),
    coalesce((select array_agg(x.name order by x.created_at, x.id) from (
      select coalesce(ru.username, ru.full_name) as name, r.created_at, r.id
      from public.social_reactions r join public.users ru on ru.id = r.user_id
      where r.post_id = p.id order by r.created_at, r.id limit 2
    ) x), '{}'),
    coalesce((
      select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'username', mu.username))
      from public.social_post_mentions m join public.users mu on mu.id = m.user_id
      where m.post_id = p.id
    ), '[]'::jsonb),
    p.edited_at
  from public.social_posts p
  join public.users u on u.id = p.user_id
  where p.id = p_post and p.deleted_at is null and public.can_see_post(p.id);
$$;
grant execute on function public.social_post(uuid) to authenticated;
