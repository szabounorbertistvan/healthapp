-- pgTAP · notification snippets across a block (20261018160000_social_notification_snippet_block.sql)
--
-- QA BUG-16: after A blocked B, A's old "B commented" notice still showed B's
-- comment text, only with B anonymized to "Someone". The snippet must follow
-- the thread's own rule: no text from anyone the reader cannot see, in either
-- block direction, including a reply that sits under a hidden comment.
--
-- Run with a local stack up:  npm run db:test
-- Or without Docker:          npm run db:test:offline

begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

create or replace function pg_temp.authenticate_as(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$fn$;

create or replace function pg_temp.as_owner()
returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', '', true);
end;
$fn$;

-- the snippet / actor of A's notice for one comment, as A reads it
create or replace function pg_temp.snippet_for(p_comment text)
returns text language sql as $fn$
  select snippet from public.social_notification_feed(50) where payload ->> 'comment_id' = p_comment;
$fn$;
create or replace function pg_temp.actor_for(p_comment text)
returns text language sql as $fn$
  select actor_name from public.social_notification_feed(50) where payload ->> 'comment_id' = p_comment;
$fn$;

-- ---------- people ----------
-- A posts. B comments and will be blocked BY A. G replies under B's comment.
-- C comments and mentions A, then blocks A (the other direction). F is a bystander.
insert into auth.users (id, email, raw_user_meta_data) values
  ('1e000000-0000-0000-0000-000000000001', 'a@nsb.test', '{"full_name":"Ana","username":"anansb"}'),
  ('1e000000-0000-0000-0000-000000000002', 'b@nsb.test', '{"full_name":"Bogdan","username":"bogdannsb"}'),
  ('1e000000-0000-0000-0000-000000000003', 'g@nsb.test', '{"full_name":"Gina","username":"ginansb"}'),
  ('1e000000-0000-0000-0000-000000000004', 'c@nsb.test', '{"full_name":"Cora","username":"coransb"}'),
  ('1e000000-0000-0000-0000-000000000005', 'f@nsb.test', '{"full_name":"Fan","username":"fannsb"}');
insert into public.social_posts (id, user_id, type, text, visibility) values
  ('1f000000-0000-0000-0000-000000000001', '1e000000-0000-0000-0000-000000000001', 'text', 'ana public', 'public'),
  ('1f000000-0000-0000-0000-000000000002', '1e000000-0000-0000-0000-000000000004', 'text', 'hi @anansb from cora', 'public');

-- ---------- the events, before any block ----------
select pg_temp.authenticate_as('1e000000-0000-0000-0000-000000000002');
insert into public.social_comments (id, post_id, user_id, body)
  values ('1c000000-0000-0000-0000-000000000001', '1f000000-0000-0000-0000-000000000001', '1e000000-0000-0000-0000-000000000002', 'QA comment B1');
select pg_temp.authenticate_as('1e000000-0000-0000-0000-000000000003');
insert into public.social_comments (id, post_id, user_id, body, parent_id)
  values ('1c000000-0000-0000-0000-000000000002', '1f000000-0000-0000-0000-000000000001', '1e000000-0000-0000-0000-000000000003', 'reply by gina',
          '1c000000-0000-0000-0000-000000000001');
select pg_temp.authenticate_as('1e000000-0000-0000-0000-000000000004');
insert into public.social_comments (id, post_id, user_id, body)
  values ('1c000000-0000-0000-0000-000000000003', '1f000000-0000-0000-0000-000000000001', '1e000000-0000-0000-0000-000000000004', 'cora was here');
insert into public.social_post_mentions (post_id, user_id)
  values ('1f000000-0000-0000-0000-000000000002', '1e000000-0000-0000-0000-000000000001');
select pg_temp.authenticate_as('1e000000-0000-0000-0000-000000000005');
insert into public.social_comments (id, post_id, user_id, body)
  values ('1c000000-0000-0000-0000-000000000004', '1f000000-0000-0000-0000-000000000001', '1e000000-0000-0000-0000-000000000005', 'fine by fan');

-- a legacy comment notice with no comment id, carrying the text it was written with
select pg_temp.as_owner();
reset role;
insert into public.notifications (user_id, category, title, body, payload)
  values ('1e000000-0000-0000-0000-000000000001', 'new_comment', 'fannsb', 'legacy stored text',
          jsonb_build_object('post_id', '1f000000-0000-0000-0000-000000000001', 'actor_id', '1e000000-0000-0000-0000-000000000005'));

select pg_temp.authenticate_as('1e000000-0000-0000-0000-000000000001');
select is(pg_temp.snippet_for('1c000000-0000-0000-0000-000000000001'), 'QA comment B1',
  'before the block: B''s comment shows as it is now');
select is(pg_temp.snippet_for('1c000000-0000-0000-0000-000000000002'), 'reply by gina',
  'before the block: G''s reply under it shows');
select is(
  (select snippet from public.social_notification_feed(50)
   where category = 'new_mention' and payload ->> 'post_id' = '1f000000-0000-0000-0000-000000000002'),
  'hi @anansb from cora', 'before the block: the caption that mentions A shows');

-- ---------- A blocks B; C blocks A ----------
select public.social_block_user('1e000000-0000-0000-0000-000000000002');
select pg_temp.authenticate_as('1e000000-0000-0000-0000-000000000004');
select public.social_block_user('1e000000-0000-0000-0000-000000000001');
select pg_temp.authenticate_as('1e000000-0000-0000-0000-000000000001');

select is(pg_temp.snippet_for('1c000000-0000-0000-0000-000000000001'), null,
  'A blocked B: B''s comment text is gone from the old notice (BUG-16)');
select is(pg_temp.actor_for('1c000000-0000-0000-0000-000000000001'), null,
  '…and, as before, so is B''s name — the same rule hides both');
select is(pg_temp.snippet_for('1c000000-0000-0000-0000-000000000002'), null,
  'a reply under the blocked person''s comment is hidden with it, as in the thread');
select is(pg_temp.actor_for('1c000000-0000-0000-0000-000000000002'), 'ginansb',
  '…while its own author is still named');
select is(pg_temp.snippet_for('1c000000-0000-0000-0000-000000000003'), null,
  'C blocked A (the other direction): C''s comment text is gone too');
select is(
  (select snippet from public.social_notification_feed(50)
   where category = 'new_mention' and payload ->> 'post_id' = '1f000000-0000-0000-0000-000000000002'),
  null, '…and so is the caption C mentioned A in');
select is(pg_temp.snippet_for('1c000000-0000-0000-0000-000000000004'), 'fine by fan',
  'a bystander''s comment is untouched');
select is(
  (select snippet from public.social_notification_feed(50)
   where category = 'new_comment' and not (payload ? 'comment_id')),
  null, 'a legacy comment notice without a comment id never falls back to its stored body');

reset role;
select * from finish();
rollback;
