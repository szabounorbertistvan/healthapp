-- pgTAP · gym records (20261117110000): who lifts the most at a gym, which
-- sessions count "at" a gym, the opt-in and its reciprocity, both rankings.
--
-- Run with a local stack up:  npm run db:test

begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

create or replace function pg_temp.authenticate_as(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$fn$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('a3000000-0000-0000-0000-0000000000a1', 'admin@gr.local', '{"full_name":"Admin","username":"gradmin"}'),
  ('f1000000-0000-0000-0000-0000000000f1', 'ana@gr.local',  '{"full_name":"Ana","username":"grana"}'),
  ('f2000000-0000-0000-0000-0000000000f2', 'bob@gr.local',  '{"full_name":"Bob","username":"grbob"}'),
  ('f3000000-0000-0000-0000-0000000000f3', 'cid@gr.local',  '{"full_name":"Cid","username":"grcid"}'),
  ('f4000000-0000-0000-0000-0000000000f4', 'dan@gr.local',  '{"full_name":"Dan","username":"grdan"}');
update public.users set role = 'admin' where id = 'a3000000-0000-0000-0000-0000000000a1';
insert into public.exercises (id, name_en, name_ro, source) values
  ('e8000000-0000-0000-0000-0000000000ee', 'Bench', 'Impins', 'custom');

select pg_temp.authenticate_as('a3000000-0000-0000-0000-0000000000a1');
create temp table g as select
  public.admin_save_gym(null, 'Iron', 'Cluj-Napoca') as iron,
  public.admin_save_gym(null, 'Steel', 'Cluj-Napoca') as steel;
grant select on g to authenticated;
reset role;

-- One completed session with one set.
create or replace function pg_temp.lift(p_user uuid, p_gym uuid, p_kg numeric, p_reps int, p_days int default 1)
returns void language plpgsql as $fn$
declare v_id uuid;
begin
  insert into public.logged_sessions (user_id, client_generated_id, started_at, completed_at, gym_id)
  values (p_user, gen_random_uuid(), now() - make_interval(days => p_days), now() - make_interval(days => p_days) + interval '1 hour', p_gym)
  returning id into v_id;
  insert into public.logged_sets (session_id, user_id, exercise_id, set_index, weight_kg, reps, rpe, client_generated_id)
  values (v_id, p_user, 'e8000000-0000-0000-0000-0000000000ee', 1, p_kg, p_reps, 8, gen_random_uuid());
end;
$fn$;
-- Ana: 100×1 at Iron. Bob: 90×8 at Iron (e1RM 114, heaviest 90).
-- Cid: home gym Iron, an untagged 95×3 (counts at Iron) and 200×1 tagged Steel (never Iron).
-- Dan: 140×1 at Iron, but private on leaderboards.
select pg_temp.lift('f1000000-0000-0000-0000-0000000000f1', (select iron from g), 100, 1);
select pg_temp.lift('f2000000-0000-0000-0000-0000000000f2', (select iron from g), 90, 8);
select pg_temp.lift('f3000000-0000-0000-0000-0000000000f3', null, 95, 3);
select pg_temp.lift('f3000000-0000-0000-0000-0000000000f3', (select steel from g), 200, 1);
select pg_temp.lift('f4000000-0000-0000-0000-0000000000f4', (select iron from g), 140, 1, 400);
update public.users set home_gym_id = (select iron from g), gym_board = true
 where id in ('f1000000-0000-0000-0000-0000000000f1', 'f2000000-0000-0000-0000-0000000000f2',
              'f3000000-0000-0000-0000-0000000000f3', 'f4000000-0000-0000-0000-0000000000f4');
update public.users set leaderboard_visibility = 'private' where id = 'f4000000-0000-0000-0000-0000000000f4';

-- ---------- rankings ----------
select pg_temp.authenticate_as('f1000000-0000-0000-0000-0000000000f1');
select is((select array_agg(username order by rank) from public.gym_records((select iron from g), 'e8000000-0000-0000-0000-0000000000ee', 'e1rm')),
  array['grbob', 'grcid', 'grana'], 'e1RM: Bob 114, Cid 104.5 (untagged, home gym), Ana 100');
select is((select array_agg(username order by rank) from public.gym_records((select iron from g), 'e8000000-0000-0000-0000-0000000000ee', 'weight')),
  array['grana', 'grcid', 'grbob'], 'heaviest weight: Ana 100, Cid 95, Bob 90');
select is((select weight_kg from public.gym_records((select iron from g), 'e8000000-0000-0000-0000-0000000000ee', 'weight') where username = 'grcid'),
  95::numeric, 'Cid''s 200 at Steel does not count at Iron');
select is((select count(*)::int from public.gym_records((select iron from g), 'e8000000-0000-0000-0000-0000000000ee', 'e1rm')
           where username = 'grdan'), 0, 'a private leaderboard setting keeps Dan off');
select is((select is_me from public.gym_records((select iron from g), 'e8000000-0000-0000-0000-0000000000ee', 'e1rm') where username = 'grana'),
  true, 'the caller''s own row is marked');
select is((select array_agg(username) from public.gym_records((select steel from g), 'e8000000-0000-0000-0000-0000000000ee', 'weight')),
  array['grcid'], 'Steel: only what was tagged there');
select is((select count(*)::int from public.gym_records((select iron from g), 'e8000000-0000-0000-0000-0000000000ee', 'e1rm', 'all', 1)), 2,
  'p_limit 1: the top row plus the caller''s own (Ana is third)');
select is((select lifters from public.gym_record_lifts((select iron from g))), 3, 'the lift chip counts three listed lifters');
select throws_ok($$ select * from public.gym_records((select iron from g), 'e8000000-0000-0000-0000-0000000000ee', 'volume') $$,
  '22023', null, 'an unknown kind is refused');
select throws_ok($$ select * from public.gym_records((select iron from g), 'e8000000-0000-0000-0000-0000000000ee', 'e1rm', 'week') $$,
  '22023', null, 'an unknown period is refused');

-- ---------- consent ----------
reset role;
update public.users set gym_board = false where id = 'f2000000-0000-0000-0000-0000000000f2';
select pg_temp.authenticate_as('f1000000-0000-0000-0000-0000000000f1');
select is((select count(*)::int from public.gym_records((select iron from g), 'e8000000-0000-0000-0000-0000000000ee', 'e1rm')
           where username = 'grbob'), 0, 'Bob turned the gym board off: he is not listed');
select pg_temp.authenticate_as('f2000000-0000-0000-0000-0000000000f2');
select is((select array_agg(username) from public.gym_records((select iron from g), 'e8000000-0000-0000-0000-0000000000ee', 'e1rm')),
  array['grbob'], 'and, off the boards, Bob sees only his own best');
select is((select lifters from public.gym_record_lifts((select iron from g))), 1,
  'his lift list counts only himself (20261117120000)');

-- ---------- period ----------
reset role;
select pg_temp.lift('f1000000-0000-0000-0000-0000000000f1', (select iron from g), 80, 1, 500);
select pg_temp.authenticate_as('f1000000-0000-0000-0000-0000000000f1');
select is((select weight_kg from public.gym_records((select iron from g), 'e8000000-0000-0000-0000-0000000000ee', 'weight', 'all') where is_me),
  100::numeric, 'all time: Ana''s best');
select ok((select count(*) from public.gym_records((select iron from g), 'e8000000-0000-0000-0000-0000000000ee', 'weight', 'month')) >= 1,
  'this month still has rows');
select is((select count(*)::int from public.gym_records(gen_random_uuid(), 'e8000000-0000-0000-0000-0000000000ee')), 0,
  'an unknown gym has no records');

select * from finish();
rollback;
