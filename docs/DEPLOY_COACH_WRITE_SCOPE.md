# Coach write scope: deployment plan

Migration `20261122100000_coach_write_scope` closes eight authorization gaps found
by the audit of 2026-10-13. The SQL file's header lists them. Every rule is
tested in SQL (pgTAP `coach_write_scope`) and over HTTP through a real
PostgREST (`npm run db:test:api`).

It was first written as `20261121100000`. `main` has since taken that version
for `20261121100000_gym_import`, and the ledger is keyed by version, so this
one is `20261122100000`: it sorts after the three gym migrations and was
validated on top of them.

**Order: the migration before the app.** The program and nutrition editors ask
`can_edit_program` / `can_edit_nutrition_plan` and open editable only on an
explicit yes (`lib/edit-access.ts`, fail-closed). On a database without this
migration `can_edit_nutrition_plan` does not exist, so every nutrition editor
would show read-only until it is applied.

**Nothing here has been applied to production from this repository.** The
remote state is whatever the read-only checks below report against the
confirmed project. The project ref and the backup work exactly as in
[DEPLOY_COACH_DISCOVERY.md](DEPLOY_COACH_DISCOVERY.md) steps 1–4.

Every query on this page is wrapped in `begin transaction read only; … rollback;`.
Postgres refuses a write inside such a transaction, so a mis-pasted line cannot
change anything. The **only** statements that write are in *Remediation*. They
are marked, and they need the owner's approval first.

All of it was run against the local schema on 2026-10-13, with bad rows seeded
before the migration. The expected results below are what that run returned.

## Before `db push`: is the remote what the migration expects?

### P1. The migration is not applied yet

```sql
begin transaction read only;
select version from supabase_migrations.schema_migrations where version = '20261122100000';
rollback;
```
Expected: **0 rows**.

### P2. No policy drift on the twelve tables it touches

Postgres ORs permissive policies together. The migration drops policies by
name, so if the live database has one under another name, that policy stays
and keeps the old access open beside the new rules. Both queries must return
**0 rows**.

```sql
begin transaction read only;
-- policies live that the migration does not know about
select tablename, policyname, cmd, permissive
from pg_policies
where schemaname = 'public'
  and tablename in ('programs','program_days','program_exercises','nutrition_plans','planned_meals','planned_meal_foods','logged_sessions','logged_sets','habit_logs','coach_feedback','check_ins','set_videos')
  and (tablename, policyname) not in (values
  ('check_ins','checkins_coach_read'), ('check_ins','checkins_coach_review'), ('check_ins','checkins_owner'),
  ('coach_feedback','feedback_client_read_mark'), ('coach_feedback','feedback_coach_insert'),
  ('coach_feedback','feedback_select'), ('habit_logs','habit_logs_coach_read'),
  ('habit_logs','habit_logs_owner'), ('logged_sessions','sessions_coach_read'),
  ('logged_sessions','sessions_owner'), ('logged_sets','sets_coach_read'), ('logged_sets','sets_owner'),
  ('nutrition_plans','nplans_client_read'), ('nutrition_plans','nplans_coach_all'),
  ('nutrition_plans','nplans_solo_all'), ('planned_meal_foods','pmfoods_client_read'),
  ('planned_meal_foods','pmfoods_rw'), ('planned_meals','pmeals_client_read'), ('planned_meals','pmeals_rw'),
  ('program_days','program_days_client_read'), ('program_days','program_days_delete'),
  ('program_days','program_days_read'), ('program_days','program_days_shared_read'),
  ('program_days','program_days_update'), ('program_days','program_days_write'),
  ('program_exercises','program_exercises_client_read'), ('program_exercises','program_exercises_delete'),
  ('program_exercises','program_exercises_read'), ('program_exercises','program_exercises_shared_read'),
  ('program_exercises','program_exercises_update'), ('program_exercises','program_exercises_write'),
  ('programs','programs_client_read'), ('programs','programs_coach_all'),
  ('programs','programs_shared_read'), ('programs','programs_solo_delete'),
  ('programs','programs_solo_insert'), ('programs','programs_solo_read'),
  ('programs','programs_solo_update'), ('set_videos','setvideos_coach'),
  ('set_videos','setvideos_coach_review'), ('set_videos','setvideos_owner'));
-- policies the migration expects to replace that are missing live
select * from (values
  ('check_ins','checkins_coach_read'), ('check_ins','checkins_coach_review'), ('check_ins','checkins_owner'),
  ('coach_feedback','feedback_client_read_mark'), ('coach_feedback','feedback_coach_insert'),
  ('coach_feedback','feedback_select'), ('habit_logs','habit_logs_coach_read'),
  ('habit_logs','habit_logs_owner'), ('logged_sessions','sessions_coach_read'),
  ('logged_sessions','sessions_owner'), ('logged_sets','sets_coach_read'), ('logged_sets','sets_owner'),
  ('nutrition_plans','nplans_client_read'), ('nutrition_plans','nplans_coach_all'),
  ('nutrition_plans','nplans_solo_all'), ('planned_meal_foods','pmfoods_client_read'),
  ('planned_meal_foods','pmfoods_rw'), ('planned_meals','pmeals_client_read'), ('planned_meals','pmeals_rw'),
  ('program_days','program_days_client_read'), ('program_days','program_days_delete'),
  ('program_days','program_days_read'), ('program_days','program_days_shared_read'),
  ('program_days','program_days_update'), ('program_days','program_days_write'),
  ('program_exercises','program_exercises_client_read'), ('program_exercises','program_exercises_delete'),
  ('program_exercises','program_exercises_read'), ('program_exercises','program_exercises_shared_read'),
  ('program_exercises','program_exercises_update'), ('program_exercises','program_exercises_write'),
  ('programs','programs_client_read'), ('programs','programs_coach_all'),
  ('programs','programs_shared_read'), ('programs','programs_solo_delete'),
  ('programs','programs_solo_insert'), ('programs','programs_solo_read'),
  ('programs','programs_solo_update'), ('set_videos','setvideos_coach'),
  ('set_videos','setvideos_coach_review'), ('set_videos','setvideos_owner')) as expected(tablename, policyname)
where not exists (select 1 from pg_policies p
                  where p.schemaname = 'public' and p.tablename = expected.tablename and p.policyname = expected.policyname);
rollback;
```

If either query returns a row, **stop**. The migration was written against
another schema, so compare the live definition first
(`select * from pg_policies where policyname = '…'`).

### P3. Names the migration creates are free

```sql
begin transaction read only;
select 'constraint' as kind, conname as name from pg_constraint where conname = 'nutrition_plans_macro_targets_check'
union all
select 'function', proname from pg_proc where pronamespace = 'public'::regnamespace
  and proname in ('can_edit_nutrition_plan', 'review_only_by_non_owner')
union all
select 'trigger', tgname from pg_trigger where tgname in ('check_ins_review_only', 'set_videos_review_only');
rollback;
```
Expected: **0 rows**. A leftover constraint would make the `alter table` fail.

## Before `db push`: data the new rules meet

None of these blocks the migration: it validates no existing row. They say
what is already in the data and what will happen to it.

### D1. Macro targets outside 0–2 500 g

```sql
begin transaction read only;
select id, coach_id, client_id, status, protein_target_g, carbs_target_g, fat_target_g, updated_at
from public.nutrition_plans
where not (protein_target_g between 0 and 2500
       and carbs_target_g  between 0 and 2500
       and fat_target_g    between 0 and 2500);
rollback;
```
Expected: **0 rows**. Each row is a plan whose **next update fails** with 23514
once the constraint exists, even an update that does not touch the targets.
That includes `publishNutritionPlan`, and a coach's plan has no screen to
correct its targets. See *Remediation R1*.

### D2. Sets filed under another person's session

```sql
begin transaction read only;
select ls.id, ls.user_id as set_owner, s.user_id as session_owner, ls.session_id, ls.received_at
from public.logged_sets ls
join public.logged_sessions s on s.id = ls.session_id
where s.user_id <> ls.user_id;
rollback;
```
Expected: **0 rows**. After the migration such a row stays readable by its
owner, but no update to it is accepted. A shared workout post computed before
the deploy keeps the totals it was given.

### D3. Habit ticks on someone else's habit

```sql
begin transaction read only;
select l.id, l.user_id as tick_owner, h.user_id as habit_owner, h.created_by, l.habit_id, l.date
from public.habit_logs l
join public.habits h on h.id = l.habit_id
where h.user_id <> l.user_id;
rollback;
```
Expected: **0 rows**. Each row blocks the habit's owner from ticking that day,
and the owner cannot see or remove it. The migration stops new ones but leaves
these in place. See *Remediation R2*.

### D4. Coach feedback re-attributed to a coach who never coached the client

```sql
begin transaction read only;
select f.id, f.coach_id, f.client_id, f.created_at
from public.coach_feedback f
where not exists (select 1 from public.trainer_clients tc
                  where tc.coach_id = f.coach_id and tc.client_id = f.client_id);
rollback;
```
Expected: **0 rows**. A rewritten feedback text cannot be detected: there is no
history of `coach_feedback`, and none of `check_ins` either.

### D5. Programs deleted by a coach who was not coaching the client then

`admin_audit_events` records every `PROGRAM_DELETED` with its actor and the
client. This lists the deletions where no active relationship covered that
moment. Pauses are not reconstructed, so a hit is a lead to investigate, not
proof.

```sql
begin transaction read only;
select e.created_at, e.actor_user_id, e.target_user_id, e.entity_id as program_id, e.metadata ->> 'name' as name
from public.admin_audit_events e
where e.action = 'PROGRAM_DELETED'
  and e.actor_user_id is distinct from e.target_user_id
  and not exists (select 1 from public.trainer_clients tc
                  where tc.coach_id = e.actor_user_id and tc.client_id = e.target_user_id
                    and tc.started_at <= e.created_at
                    and (tc.ended_at is null or tc.ended_at > e.created_at));
rollback;
```

### D6. Sessions and sets logged against someone else's private program

Section 8 stops a session pointing at a program day, and a set at a program
exercise, of a program the logger cannot see. This lists the existing ones
where the program is neither the logger's own nor public / for followers. A
program shared "for followers" is not checked (a follow may have ended since),
so a hit is a lead, not proof.

```sql
begin transaction read only;
select 'session' as kind, s.id, s.user_id as logger, p.id as program_id, p.visibility, s.started_at as at
from public.logged_sessions s
join public.program_days d on d.id = s.program_day_id
join public.programs p on p.id = d.program_id
where s.user_id is distinct from p.client_id and s.user_id is distinct from p.coach_id
  and p.visibility not in ('public', 'followers')
union all
select 'set', ls.id, ls.user_id, p.id, p.visibility, ls.received_at
from public.logged_sets ls
join public.program_exercises pe on pe.id = ls.program_exercise_id
join public.program_days d on d.id = pe.program_day_id
join public.programs p on p.id = d.program_id
where ls.user_id is distinct from p.client_id and ls.user_id is distinct from p.coach_id
  and p.visibility not in ('public', 'followers');
rollback;
```
Expected: **0 rows**. Such a session was counted in that program's statistics.
After the migration the row stays readable by its owner; an update that keeps
the reference is refused.

### D7. Set videos on another person's set

```sql
begin transaction read only;
select v.id, v.user_id as video_owner, ls.user_id as set_owner, v.logged_set_id
from public.set_videos v
join public.logged_sets ls on ls.id = v.logged_set_id
where ls.user_id <> v.user_id;
rollback;
```
Expected: **0 rows**. Read any hit before deciding anything (*Remediation R3*).

## After `db push`: smoke checks

```sql
begin transaction read only;
select version from supabase_migrations.schema_migrations where version = '20261122100000';     -- 1 row
select (select count(*) from pg_policies where schemaname = 'public' and tablename in ('programs','program_days','program_exercises','nutrition_plans','planned_meals','planned_meal_foods','logged_sessions','logged_sets','habit_logs','coach_feedback','check_ins','set_videos')) as policies;  -- 53 (41 before)
select has_column_privilege('authenticated', 'public.coach_feedback', 'body', 'UPDATE')    as feedback_body,     -- false
       has_column_privilege('authenticated', 'public.coach_feedback', 'read_at', 'UPDATE') as feedback_read_at,  -- true
       has_function_privilege('anon', 'public.admin_set_tier(uuid, text)', 'execute')     as anon_set_tier,     -- false
       has_function_privilege('anon', 'public.can_edit_nutrition_plan(uuid)', 'execute')  as anon_can_edit,     -- false
       (select count(*) from pg_trigger where tgname in ('check_ins_review_only', 'set_videos_review_only')) as triggers,  -- 2
       (select convalidated from pg_constraint where conname = 'nutrition_plans_macro_targets_check') as validated;    -- false (NOT VALID)
rollback;
```

Then, in the app:
- as a coach with an **active** client: edit a day, add a meal food, review a check-in with feedback;
- as a coach with a **paused or ended** client: the same edits answer
  "Nothing was saved. This item is no longer available to you…";
- as a client: tick and un-tick a habit; log a set.

## Remediation (writes: only with the owner's approval, after the backup)

**R1. Plans from D1.** Agree with the coach (or the client, for a solo plan)
on the intended targets, then correct each row by id:
```sql
update public.nutrition_plans set protein_target_g = …, carbs_target_g = …, fat_target_g = … where id = '…';
```
Never clamp them automatically: zero protein is a valid target, and a wrong
guess is invisible.

Once D1 returns 0 rows **and** stays at 0, a later migration may run
`alter table public.nutrition_plans validate constraint nutrition_plans_macro_targets_check;`.
It scans the table under a lock that still allows reads and writes. Do not
validate before D1 is empty: it would fail, and nothing is gained by forcing it.

**R2. Ticks from D3.** These rows block a real person's tick, and their
"owner" put them on a habit that was never theirs:
```sql
delete from public.habit_logs l using public.habits h
where h.id = l.habit_id and h.user_id <> l.user_id;   -- the D3 rows exactly
```
Run D3 first, and delete only if the count matches.

**R3. Rows from D2, D4, D5, D6 and D7** are evidence. Read them before deciding
anything. Deleting a D2 set does not recompute a post that already showed it.

## Rollback / fix forward

There is no down migration. To restore a previous rule, write a new migration
that recreates the old policy from `20260823000800_rls.sql` (or the grant from
`20260826075027_table_grants.sql`), with a pgTAP test that says why. Do not
edit `20261122100000` once it has been applied anywhere.
