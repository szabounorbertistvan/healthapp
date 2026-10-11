-- pgTAP · email unsubscribe links (20261115100000_email_unsubscribe.sql)
--
-- 1. the outbox rows carry the recipient's id and a token for their category
-- 2. a valid link switches off exactly that category and keeps every push switch
-- 3. a wrong token, another person's token, another category or junk do nothing
-- 4. anon can use the link; nobody but the database reads the signing key or signs
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users (id, email, raw_user_meta_data) values
  ('f0000000-0000-0000-0000-000000000001', 'coach@unsub.local', '{"full_name":"Kai","username":"kai_u"}'),
  ('f0000000-0000-0000-0000-000000000002', 'client@unsub.local', '{"full_name":"Ana","username":"ana_u"}');
update public.users set notification_prefs = '{"new_message": false, "email": {"review": true}}'
 where id = 'f0000000-0000-0000-0000-000000000002';

-- 1. tokens on the rows the dispatcher reads
select public.coach_request_notify('f0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000002',
                                   'sent', gen_random_uuid());
create temp table claimed as select * from public.email_outbox_claim(10);
select is((select user_id from claimed), 'f0000000-0000-0000-0000-000000000001'::uuid, 'the row names its recipient');
select ok((select unsubscribe_token ~ '^[0-9a-f]{32}$' from claimed), 'and carries a 32-hex token');
select is((select unsubscribe_token from claimed),
          public.email_unsubscribe_token('f0000000-0000-0000-0000-000000000001', 'coaching_request'),
          'signed for that person and that category');
select isnt(public.email_unsubscribe_token('f0000000-0000-0000-0000-000000000001', 'booking'),
            public.email_unsubscribe_token('f0000000-0000-0000-0000-000000000001', 'coaching_request'),
            'another category gets another token');

-- 3. what must not work (run as anon, like a click from a mail client)
create temp table tok as select
  public.email_unsubscribe_token('f0000000-0000-0000-0000-000000000002', 'booking') as client_booking,
  public.email_unsubscribe_token('f0000000-0000-0000-0000-000000000001', 'booking') as coach_booking;
grant select on tok to anon;
set local role anon;
select is(public.email_unsubscribe('f0000000-0000-0000-0000-000000000002', 'booking', '0123456789abcdef0123456789abcdef'), false,
  'a made-up token is refused');
select is(public.email_unsubscribe('f0000000-0000-0000-0000-000000000002', 'booking', (select coach_booking from tok)), false,
  'someone else''s token is refused');
select is(public.email_unsubscribe('f0000000-0000-0000-0000-000000000002', 'review', (select client_booking from tok)), false,
  'a token for another category is refused');
select is(public.email_unsubscribe('f0000000-0000-0000-0000-000000000002', 'new_kudos', (select client_booking from tok)), false,
  'a category without an email switch is refused');
select is(public.email_unsubscribe('f0000000-0000-0000-0000-000000000002', 'booking', null), false, 'no token, no change');
reset role;
select is((select notification_prefs from public.users where id = 'f0000000-0000-0000-0000-000000000002'),
          '{"new_message": false, "email": {"review": true}}'::jsonb, 'none of those touched the preferences');

-- 2. the real link
set local role anon;
select is(public.email_unsubscribe('f0000000-0000-0000-0000-000000000002', 'booking', (select client_booking from tok)), true,
  'the person''s own link works without signing in');
reset role;
select is((select notification_prefs from public.users where id = 'f0000000-0000-0000-0000-000000000002'),
          '{"new_message": false, "email": {"review": true, "booking": false}}'::jsonb,
          'it switches off that category only, and keeps the push switch');
select is(public.email_unsubscribe('f0000000-0000-0000-0000-000000000002', 'booking',
                                   public.email_unsubscribe_token('f0000000-0000-0000-0000-000000000002', 'booking')), true,
  'clicking it twice is harmless');

-- 4. the key and the signer stay inside
set local role anon;
select throws_ok($$ select secret from public.email_signing_key $$, '42501', null, 'anon cannot read the signing key');
select throws_ok($$ select public.email_unsubscribe_token('f0000000-0000-0000-0000-000000000002', 'booking') $$, '42501', null,
  'nor sign a link for someone');
reset role;
set local role authenticated;
select throws_ok($$ select secret from public.email_signing_key $$, '42501', null, 'neither can a signed-in user');
reset role;

select * from finish();
rollback;
