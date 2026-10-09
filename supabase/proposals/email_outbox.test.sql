-- pgTAP · email outbox PROPOSAL (supabase/proposals/20261114100000_email_outbox.sql)
--
-- Runs only once the proposal is a migration. Until then, validate it on a
-- throwaway Postgres: copy both files into supabase/migrations and
-- supabase/tests, `node scripts/pgtest/run.mjs email_outbox`, remove them.
--
-- 1. the existing notify functions enqueue exactly the eligible rows, once
-- 2. a message waits 15 minutes; an ineligible event is never queued
-- 3. claim is exclusive and joins the recipient's address server-side
-- 4. mark only moves a claimed row; attempts count sends, not skips
-- 5. a crashed run's lock expires and the row comes back
-- 6. nobody but the service role reads the outbox or calls its functions
-- 7. deleting the account deletes its outbox rows
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

create or replace function pg_temp.authenticate_as(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$fn$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('e0000000-0000-0000-0000-000000000001', 'coach@outbox.local', '{"full_name":"Kai","username":"kai_o"}'),
  ('e0000000-0000-0000-0000-000000000002', 'client@outbox.local', '{"full_name":"Ana","username":"ana_o"}');

-- 1. a coaching request through the real notify function
select public.coach_request_notify('e0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002',
                                   'sent', gen_random_uuid());
select is((select count(*)::int from public.email_outbox where user_id = 'e0000000-0000-0000-0000-000000000001'), 1,
  'a new coaching request queues one email for the coach');
select is((select status from public.email_outbox where user_id = 'e0000000-0000-0000-0000-000000000001'), 'pending',
  'it starts pending');

-- 2. ineligible events and the message hold
select public.coach_request_notify('e0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002',
                                   'cancelled', gen_random_uuid());
insert into public.notifications (user_id, category, title, payload)
values ('e0000000-0000-0000-0000-000000000002', 'new_kudos', 'Kudos', '{"post_id":"00000000-0000-0000-0000-000000000000"}');
select is((select count(*)::int from public.email_outbox), 1, 'a cancelled request and a kudos are never queued');

insert into public.notifications (id, user_id, category, title, payload)
values ('e0000000-0000-0000-0000-0000000000a1', 'e0000000-0000-0000-0000-000000000002', 'new_message', 'New message',
        '{"conversation_id":"e0000000-0000-0000-0000-0000000000c1","screen":"client_thread","actor_id":"e0000000-0000-0000-0000-000000000001"}');
select is((select not_before - n.created_at from public.email_outbox o join public.notifications n on n.id = o.notification_id
            where o.notification_id = 'e0000000-0000-0000-0000-0000000000a1'), interval '15 minutes',
  'a message waits 15 minutes for the in-app notice');
select throws_ok($$ insert into public.email_outbox (notification_id, user_id, not_before)
                    values ('e0000000-0000-0000-0000-0000000000a1', 'e0000000-0000-0000-0000-000000000002', now()) $$,
  '23505', null, 'one notification can never be two emails');

-- 3. claim
select is((select count(*)::int from public.email_outbox_claim(10)), 1, 'only the due row is claimed (the message is still held)');
select is((select email from public.email_outbox_peek(10)), null, 'peek does not see a row that is already claimed');
select is((select count(*)::int from public.email_outbox_claim(10)), 0, 'a second run cannot claim the same row');
select is((select status from public.email_outbox where user_id = 'e0000000-0000-0000-0000-000000000001'), 'sending',
  'the claimed row is locked as sending');

update public.email_outbox set status = 'pending', locked_until = null where user_id = 'e0000000-0000-0000-0000-000000000001';
create temp table claimed as select * from public.email_outbox_claim(10);
select is((select email from claimed), 'coach@outbox.local', 'the claim reads the address server-side');
select is((select actor_name from claimed), 'ana_o', 'and the other person''s public name, nothing more');

-- 4. mark
select lives_ok(format($$ select public.email_outbox_mark(%L, 'sent', null, null, 200, null, 're_123') $$, (select id from claimed)),
  'a claimed row can be marked sent');
select is((select attempts from public.email_outbox where id = (select id from claimed)), 1, 'a send counts as an attempt');
select throws_ok(format($$ select public.email_outbox_mark(%L, 'sent', null, null, 200, null, null) $$, (select id from claimed)),
  'P0002', 'EMAIL_OUTBOX_NOT_CLAIMED', 'a sent row cannot be marked again');

-- 5. an expired lock comes back
update public.email_outbox set not_before = now() - interval '1 minute' where notification_id = 'e0000000-0000-0000-0000-0000000000a1';
select is((select count(*)::int from public.email_outbox_claim(10)), 1, 'the held message is claimed once due');
update public.email_outbox set locked_until = now() - interval '1 second' where notification_id = 'e0000000-0000-0000-0000-0000000000a1';
select is((select count(*)::int from public.email_outbox_claim(10)), 1, 'a row whose lock expired (crashed run) is claimed again');

-- 6. nobody else
select pg_temp.authenticate_as('e0000000-0000-0000-0000-000000000001');
select throws_ok($$ select count(*) from public.email_outbox $$, '42501', null, 'a signed-in user cannot read the outbox');
select throws_ok($$ select * from public.email_outbox_claim(10) $$, '42501', null, 'nor claim from it');
reset role;

-- 7. account deletion
delete from auth.users where id = 'e0000000-0000-0000-0000-000000000002';
select is((select count(*)::int from public.email_outbox where user_id = 'e0000000-0000-0000-0000-000000000002'), 0,
  'deleting the account deletes its outbox rows');

select * from finish();
rollback;
