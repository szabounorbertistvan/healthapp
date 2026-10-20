-- pgTAP · a photo or voice note in a message (20261207130000)

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
  ('ad000000-0000-0000-0000-000000000001', 'client@att.local', '{"full_name":"Client","username":"att_client"}'),
  ('ad000000-0000-0000-0000-000000000002', 'coach@att.local',  '{"full_name":"Coach","username":"att_coach"}'),
  ('ad000000-0000-0000-0000-000000000003', 'other@att.local',  '{"full_name":"Other","username":"att_other"}');
update public.users set role = 'coach' where id = 'ad000000-0000-0000-0000-000000000002';
insert into public.trainer_clients (coach_id, client_id, status, started_at) values
  ('ad000000-0000-0000-0000-000000000002', 'ad000000-0000-0000-0000-000000000001', 'active', now());
insert into public.conversations (id, coach_id, client_id) values
  ('ad000000-0000-0000-0000-0000000000c1', 'ad000000-0000-0000-0000-000000000002', 'ad000000-0000-0000-0000-000000000001');

select pg_temp.authenticate_as('ad000000-0000-0000-0000-000000000001');

-- 1  a text message still works
select lives_ok($$
  insert into public.messages (conversation_id, sender_id, body)
  values ('ad000000-0000-0000-0000-0000000000c1', 'ad000000-0000-0000-0000-000000000001', 'hi coach')
$$, 'a plain text message is sent as before');

-- 2  a voice note with no text, in the sender's own folder
select lives_ok($$
  insert into public.messages (id, conversation_id, sender_id, attachment_kind, attachment_path, attachment_bytes,
                               attachment_format, attachment_seconds)
  values ('ad000000-0000-0000-0000-0000000000d1', 'ad000000-0000-0000-0000-0000000000c1', 'ad000000-0000-0000-0000-000000000001', 'audio',
          'voinic/messages/ad000000-0000-0000-0000-0000000000c1/ad000000-0000-0000-0000-000000000001/abcdefghij0123456789',
          48000, 'webm', 12.5)
$$, 'a voice note with no text is accepted');

-- 3-6  what is refused
select throws_ok($$
  insert into public.messages (conversation_id, sender_id, body)
  values ('ad000000-0000-0000-0000-0000000000c1', 'ad000000-0000-0000-0000-000000000001', '   ')
$$, '23514', null, 'a message with neither text nor attachment is refused');
select throws_ok($$
  insert into public.messages (conversation_id, sender_id, attachment_kind, attachment_path)
  values ('ad000000-0000-0000-0000-0000000000c1', 'ad000000-0000-0000-0000-000000000001', 'image',
          'voinic/messages/ad000000-0000-0000-0000-0000000000c1/ad000000-0000-0000-0000-000000000002/abcdefghij0123456789')
$$, '23514', null, 'a file from someone else''s folder is refused');
select throws_ok($$
  insert into public.messages (conversation_id, sender_id, attachment_kind, attachment_path, attachment_seconds)
  values ('ad000000-0000-0000-0000-0000000000c1', 'ad000000-0000-0000-0000-000000000001', 'audio',
          'voinic/messages/ad000000-0000-0000-0000-0000000000c1/ad000000-0000-0000-0000-000000000001/abcdefghij0123456789', 3)
$$, '23505', null, 'the same file cannot be sent twice');
select throws_ok($$
  insert into public.messages (conversation_id, sender_id, attachment_kind, attachment_path)
  values ('ad000000-0000-0000-0000-0000000000c1', 'ad000000-0000-0000-0000-000000000001', 'audio',
          'voinic/messages/ad000000-0000-0000-0000-0000000000c1/ad000000-0000-0000-0000-000000000001/zzzzzzzzzz0123456789')
$$, '23514', null, 'a voice note needs its length');

-- 7  the attachment cannot be changed afterwards
select throws_ok($$
  update public.messages set attachment_path = 'x' where id = 'ad000000-0000-0000-0000-0000000000d1'
$$, '42501', null, 'attachment columns are not updatable');

-- 8-9  the coach reads it; a stranger does not
select pg_temp.authenticate_as('ad000000-0000-0000-0000-000000000002');
select is((select attachment_kind from public.messages where id = 'ad000000-0000-0000-0000-0000000000d1'), 'audio',
  'the other participant reads the voice note row');
select pg_temp.authenticate_as('ad000000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.messages), 0, 'someone outside the conversation reads nothing');

select * from finish();
rollback;
