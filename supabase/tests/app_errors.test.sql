-- pgTAP · the application error store (20260922100000).
--
-- What matters here is the shape of the boundary, not the counting: anyone may
-- report an error (a boundary fires for a signed-out visitor too), nobody but
-- an admin may read one, nobody at all may write one directly or edit one
-- afterwards, and a browser stuck in a render loop cannot fill the table.
--
-- Run with a local stack up:  npm run db:test

begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

create or replace function pg_temp.authenticate_as(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$fn$;
create or replace function pg_temp.anonymous()
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '', true);
end;
$fn$;

-- ---------- fixtures ----------
insert into auth.users (id, email, raw_user_meta_data) values
  ('f1000000-0000-0000-0000-00000000000a', 'admin@err.local', '{"full_name":"Ada Admin","username":"err_admin"}'),
  ('f1000000-0000-0000-0000-000000000001', 'one@err.local',   '{"full_name":"Client One","username":"err_one"}');
update public.users set role = 'admin' where id = 'f1000000-0000-0000-0000-00000000000a';

-- ---------- 1. the table is not a writable surface ----------
select has_table('public', 'app_errors', 'app_errors exists');
select ok(
  not has_table_privilege('authenticated', 'public.app_errors', 'INSERT'),
  'authenticated cannot insert an error row directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.app_errors', 'UPDATE'),
  'authenticated cannot edit an error row'
);
select ok(
  not has_table_privilege('authenticated', 'public.app_errors', 'DELETE'),
  'authenticated cannot delete an error row'
);
select ok(
  not has_table_privilege('anon', 'public.app_errors', 'SELECT'),
  'anon cannot read the error log'
);

-- ---------- 2. anyone may report ----------
select pg_temp.anonymous();
select lives_ok(
  $$ select public.record_app_error('client', 'anon boundary error', null, '/login') $$,
  'a signed-out visitor can report an error'
);

reset role;
select pg_temp.authenticate_as('f1000000-0000-0000-0000-000000000001');
select lives_ok(
  $$ select public.record_app_error('client', 'signed-in boundary error', 'abc123', '/today', 'at Foo (x.js:1)') $$,
  'a signed-in person can report an error'
);

-- Garbage in, nothing out: an empty message and an unknown source are dropped
-- rather than stored as noise.
select lives_ok(
  $$ select public.record_app_error('client', '   ') $$,
  'an empty message is accepted and ignored'
);
select lives_ok(
  $$ select public.record_app_error('kernel', 'from nowhere') $$,
  'an unknown source is accepted and ignored'
);

-- ---------- 3. the flood cap ----------
do $$
begin
  for i in 1..40 loop
    perform public.record_app_error('client', 'loop error ' || i, null, '/loop');
  end loop;
end;
$$;

-- ---------- 4. what actually landed, read as the owner ----------
reset role;
select is(
  (select count(*)::int from public.app_errors where message = 'signed-in boundary error'),
  1,
  'the signed-in report landed'
);
select is(
  (select user_id from public.app_errors where message = 'signed-in boundary error'),
  'f1000000-0000-0000-0000-000000000001'::uuid,
  'and it is attributed to the caller, not to whatever the caller claimed'
);
select is(
  (select user_id from public.app_errors where message = 'anon boundary error'),
  null::uuid,
  'the anonymous one carries no user'
);
select is(
  (select count(*)::int from public.app_errors where message = 'from nowhere'),
  0,
  'an unknown source wrote nothing'
);
select is(
  (select count(*)::int from public.app_errors where message = ''),
  0,
  'and neither did an empty message'
);
select cmp_ok(
  (select count(*)::int from public.app_errors where user_id = 'f1000000-0000-0000-0000-000000000001'),
  '<=', 20,
  'one person cannot write more than twenty errors an hour'
);

-- ---------- 5. reading is admin-only ----------
select pg_temp.authenticate_as('f1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$ select public.admin_app_errors() $$,
  '42501',
  null,
  'a plain user asking for the error page is refused'
);
select is(
  (select count(*)::int from public.app_errors),
  0,
  'and cannot see a single row through the table either'
);

reset role;
select pg_temp.authenticate_as('f1000000-0000-0000-0000-00000000000a');
select cmp_ok(
  (select count(*)::int from public.app_errors),
  '>', 0,
  'the admin sees the log'
);
select ok(
  (public.admin_app_errors(7, null, null, null, 10, 0)) ? 'stats',
  'admin_app_errors answers with its counters'
);

-- ---------- 6. resolving marks, never deletes ----------
select is(
  public.admin_resolve_app_error((select id from public.app_errors where message = 'anon boundary error'), false),
  1,
  'resolving one error changes exactly one row'
);
select is(
  (select count(*)::int from public.app_errors where message = 'anon boundary error' and resolved_at is not null),
  1,
  'and the row is still there, marked rather than removed'
);

select * from finish();
rollback;
