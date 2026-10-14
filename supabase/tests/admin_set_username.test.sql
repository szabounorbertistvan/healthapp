-- pgTAP · admin_set_username: only an admin renames, the format and the
-- case-insensitive uniqueness hold, and the change is audited.
--
-- Run with a local stack up:  npm run db:test

begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

create or replace function pg_temp.authenticate_as(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$fn$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('e9000000-0000-0000-0000-00000000000a', 'admin@usr.local', '{"full_name":"Ada Admin","username":"usr_admin"}'),
  ('e9000000-0000-0000-0000-000000000001', 'one@usr.local',   '{"full_name":"Client One","username":"usr_one"}'),
  ('e9000000-0000-0000-0000-000000000002', 'two@usr.local',   '{"full_name":"Client Two","username":"usr_two"}');
update public.users set role = 'admin' where id = 'e9000000-0000-0000-0000-00000000000a';

-- a client cannot
select pg_temp.authenticate_as('e9000000-0000-0000-0000-000000000001');
select throws_ok($$ select public.admin_set_username('e9000000-0000-0000-0000-000000000002', 'stolen') $$,
  '42501', 'ADMIN_ONLY', 'a non-admin cannot rename anyone');

select pg_temp.authenticate_as('e9000000-0000-0000-0000-00000000000a');
select throws_ok($$ select public.admin_set_username('e9000000-0000-0000-0000-000000000001', 'a b') $$,
  '22023', 'USERNAME_FORMAT', 'the format check applies');
select throws_ok($$ select public.admin_set_username('e9000000-0000-0000-0000-000000000001', 'USR_TWO') $$,
  '22023', 'USERNAME_TAKEN', 'another person''s username is taken whatever its case');
select throws_ok($$ select public.admin_set_username('e9000000-0000-0000-0000-0000000000ff', 'nobody_here') $$,
  '22023', 'USER_NOT_FOUND', 'an unknown id is refused');
select is(public.admin_set_username('e9000000-0000-0000-0000-000000000001', '  Usr_One  '), 'Usr_One',
  'a case change of one''s own name is allowed, trimmed');
select is(public.admin_set_username('e9000000-0000-0000-0000-000000000001', 'renamed.one'), 'renamed.one',
  'an admin renames');

reset role;
select is((select username from public.users where id = 'e9000000-0000-0000-0000-000000000001'), 'renamed.one',
  'the row carries the new username');
select is((select metadata->>'from' from public.admin_audit_events
            where target_user_id = 'e9000000-0000-0000-0000-000000000001' and metadata->>'kind' = 'set_username'
            order by created_at desc, id desc limit 1), 'Usr_One', 'the audit row names the old username');
select is((select count(*)::int from public.admin_audit_events
            where target_user_id = 'e9000000-0000-0000-0000-000000000001' and metadata->>'kind' = 'set_username'), 2,
  'each rename writes one audit row');

select * from finish();
rollback;
