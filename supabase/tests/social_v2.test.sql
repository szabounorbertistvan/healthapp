-- pgTAP · social v2: replies, mentions and the notifications they produce.
--
-- The question running through every case is the same one: can any of the new
-- surface be used to reach a post you were not allowed to see? A mention is
-- the obvious candidate — it names somebody and creates a notification, so if
-- it leaked it would leak with a link attached.
--
-- Also pinned here: notifications are not sent to yourself, not sent twice for
-- one comment, and cannot be marked read by anyone but their owner.
--
-- Run with a local stack up:  npm run db:test
-- Or without Docker:          npm run db:test:offline

begin;
create extension if not exists pgtap with schema extensions;
select plan(37);

create or replace function pg_temp.authenticate_as(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$fn$;

/** Rows an UPDATE/DELETE actually touched under the current role. 0 = refused. */
create or replace function pg_temp.rows_touched(p_sql text)
returns int language plpgsql as $fn$
declare v_n int;
begin
  execute p_sql;
  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

-- Reading somebody ELSE's bell to check that a trigger fired is a question
-- about the trigger, not about RLS — and notifications_read would hide the row
-- from whoever happens to be authenticated at that moment. So these two run as
-- the owner. The RLS assertions further down deliberately do NOT use them.
create or replace function pg_temp.notes(p_user uuid, p_category text)
returns int language sql stable security definer as $fn$
  select count(*)::int from public.notifications
  where user_id = p_user and category::text = p_category;
$fn$;

/** Notifications in somebody's bell carrying a given payload key. */
create or replace function pg_temp.notes_about(p_user uuid, p_key text, p_value text)
returns int language sql stable security definer as $fn$
  select count(*)::int from public.notifications
  where user_id = p_user and payload ->> p_key = p_value;
$fn$;

-- ---------- people ----------
-- AUTHOR writes. FAN follows AUTHOR. STRANGER follows nobody. GUEST is the
-- one who gets mentioned.
insert into auth.users (id, email, raw_user_meta_data) values
  ('5a000000-0000-0000-0000-00000000a111', 'author@v2.test',   '{"full_name":"Author"}'),
  ('5a000000-0000-0000-0000-00000000fa11', 'fan@v2.test',      '{"full_name":"Fan"}'),
  ('5a000000-0000-0000-0000-000000005747', 'stranger@v2.test', '{"full_name":"Stranger"}'),
  ('5a000000-0000-0000-0000-000000009e57', 'guest@v2.test',    '{"full_name":"Guest"}');

update public.users set username = 'author'   where id = '5a000000-0000-0000-0000-00000000a111';
update public.users set username = 'fan'      where id = '5a000000-0000-0000-0000-00000000fa11';
update public.users set username = 'stranger' where id = '5a000000-0000-0000-0000-000000005747';
update public.users set username = 'guest'    where id = '5a000000-0000-0000-0000-000000009e57';

insert into public.social_follows (follower_id, following_id) values
  ('5a000000-0000-0000-0000-00000000fa11', '5a000000-0000-0000-0000-00000000a111');

insert into public.social_posts (id, user_id, type, text, visibility) values
  ('b0000000-0000-0000-0000-0000000000b1', '5a000000-0000-0000-0000-00000000a111', 'text', 'Public post',    'public'),
  ('b0000000-0000-0000-0000-0000000000f0', '5a000000-0000-0000-0000-00000000a111', 'text', 'Followers post', 'followers'),
  ('b0000000-0000-0000-0000-0000000000b2', '5a000000-0000-0000-0000-00000000a111', 'text', 'Private post',   'private');

-- The follow above already wrote a 'new_follower' notification. Clear the slate
-- so every count below is about the thing being tested.
reset role;
delete from public.notifications;

-- ---------- 1. a comment tells the post's author, once, and never yourself ----------
select pg_temp.authenticate_as('5a000000-0000-0000-0000-00000000fa11');
insert into public.social_comments (id, post_id, user_id, body)
values ('c0000000-0000-0000-0000-0000000000c1', 'b0000000-0000-0000-0000-0000000000b1',
        '5a000000-0000-0000-0000-00000000fa11', 'Great workout!');
select is(pg_temp.notes('5a000000-0000-0000-0000-00000000a111', 'new_comment'), 1,
  'commenting on a post notifies its author');

select pg_temp.authenticate_as('5a000000-0000-0000-0000-00000000a111');
insert into public.social_comments (post_id, user_id, body)
values ('b0000000-0000-0000-0000-0000000000b1', '5a000000-0000-0000-0000-00000000a111', 'Thanks all');
select is(pg_temp.notes('5a000000-0000-0000-0000-00000000a111', 'new_comment'), 1,
  'commenting on your own post does not notify you');

-- ---------- 2. a reply tells the comment's author ----------
insert into public.social_comments (id, post_id, user_id, body, parent_id)
values ('c0000000-0000-0000-0000-0000000000c2', 'b0000000-0000-0000-0000-0000000000b1',
        '5a000000-0000-0000-0000-00000000a111', 'Thanks!', 'c0000000-0000-0000-0000-0000000000c1');
select is(pg_temp.notes('5a000000-0000-0000-0000-00000000fa11', 'comment_reply'), 1,
  'replying notifies the author of the comment being answered');
select is(pg_temp.notes('5a000000-0000-0000-0000-00000000a111', 'new_comment'), 1,
  'and the post author, who wrote the reply, hears nothing extra');

-- ---------- 3. replies are one level deep ----------
select throws_ok(
  $$insert into public.social_comments (post_id, user_id, body, parent_id)
    values ('b0000000-0000-0000-0000-0000000000b1', '5a000000-0000-0000-0000-00000000a111',
            'reply to a reply', 'c0000000-0000-0000-0000-0000000000c2')$$,
  '22023', null,
  'a reply cannot itself be replied to'
);
select throws_ok(
  $$insert into public.social_comments (post_id, user_id, body, parent_id)
    values ('b0000000-0000-0000-0000-0000000000f0', '5a000000-0000-0000-0000-00000000a111',
            'wrong post', 'c0000000-0000-0000-0000-0000000000c1')$$,
  '22023', null,
  'a reply cannot be hung off a comment belonging to another post'
);

-- ---------- 4. mentions notify only when the post is already visible ----------
reset role;
delete from public.notifications;
select pg_temp.authenticate_as('5a000000-0000-0000-0000-00000000a111');
insert into public.social_comments (id, post_id, user_id, body)
values ('c0000000-0000-0000-0000-0000000000c3', 'b0000000-0000-0000-0000-0000000000b1',
        '5a000000-0000-0000-0000-00000000a111', 'ask @guest');
insert into public.social_comment_mentions (comment_id, user_id)
values ('c0000000-0000-0000-0000-0000000000c3', '5a000000-0000-0000-0000-000000009e57');
select is(pg_temp.notes('5a000000-0000-0000-0000-000000009e57', 'new_mention'), 1,
  'a mention on a public post notifies the person named');

-- The same mention on a private post must be silent: a mention is not a way to
-- point somebody at something they cannot open.
insert into public.social_comments (id, post_id, user_id, body)
values ('c0000000-0000-0000-0000-0000000000c4', 'b0000000-0000-0000-0000-0000000000b2',
        '5a000000-0000-0000-0000-00000000a111', 'secretly @guest');
insert into public.social_comment_mentions (comment_id, user_id)
values ('c0000000-0000-0000-0000-0000000000c4', '5a000000-0000-0000-0000-000000009e57');
select is(pg_temp.notes('5a000000-0000-0000-0000-000000009e57', 'new_mention'), 1,
  'a mention on a private post notifies nobody — no visibility bypass');
select is(
  pg_temp.notes_about('5a000000-0000-0000-0000-000000009e57', 'post_id',
                      'b0000000-0000-0000-0000-0000000000b2'),
  0,
  'and leaves no trace of the private post in their bell'
);

-- Mentioning yourself is not news.
insert into public.social_comments (id, post_id, user_id, body)
values ('c0000000-0000-0000-0000-0000000000c5', 'b0000000-0000-0000-0000-0000000000b1',
        '5a000000-0000-0000-0000-00000000a111', 'me, @author');
insert into public.social_comment_mentions (comment_id, user_id)
values ('c0000000-0000-0000-0000-0000000000c5', '5a000000-0000-0000-0000-00000000a111');
select is(pg_temp.notes('5a000000-0000-0000-0000-00000000a111', 'new_mention'), 0,
  'mentioning yourself notifies nobody');

-- ---------- 5. one comment, one notification per person ----------
reset role;
delete from public.notifications;
select pg_temp.authenticate_as('5a000000-0000-0000-0000-00000000fa11');
insert into public.social_comments (id, post_id, user_id, body, parent_id)
values ('c0000000-0000-0000-0000-0000000000c6', 'b0000000-0000-0000-0000-0000000000b1',
        '5a000000-0000-0000-0000-00000000fa11', 'replying and naming @author',
        'c0000000-0000-0000-0000-0000000000c3');
insert into public.social_comment_mentions (comment_id, user_id)
values ('c0000000-0000-0000-0000-0000000000c6', '5a000000-0000-0000-0000-00000000a111');
select is(
  pg_temp.notes_about('5a000000-0000-0000-0000-00000000a111', 'comment_id',
                      'c0000000-0000-0000-0000-0000000000c6'),
  1,
  'being replied to and mentioned in the same comment is one notification'
);
select is(pg_temp.notes('5a000000-0000-0000-0000-00000000a111', 'comment_reply'), 1,
  'and it is the reply, which is the more specific of the two');

-- ---------- 6. what a stranger cannot do ----------
select pg_temp.authenticate_as('5a000000-0000-0000-0000-000000005747');
select is(
  (select count(*)::int from public.social_posts where id = 'b0000000-0000-0000-0000-0000000000b2'),
  0, 'a stranger cannot read a private post');
select is(
  (select count(*)::int from public.social_posts where id = 'b0000000-0000-0000-0000-0000000000f0'),
  0, 'nor a followers-only post of someone they do not follow');
select is((select public.can_see_post('b0000000-0000-0000-0000-0000000000b2')), false,
  'can_see_post agrees');
select is(
  (select count(*)::int from public.social_post_comments('b0000000-0000-0000-0000-0000000000b2')),
  0, 'and reads none of its comments');
select is(
  (select count(*)::int from public.social_comment_mentions m
   join public.social_comments c on c.id = m.comment_id
   where c.post_id = 'b0000000-0000-0000-0000-0000000000b2'),
  0, 'nor the mentions inside them');

select throws_ok(
  $$insert into public.social_comments (post_id, user_id, body)
    values ('b0000000-0000-0000-0000-0000000000b2', '5a000000-0000-0000-0000-000000005747', 'hello?')$$,
  '42501', null,
  'a stranger cannot comment on a post they cannot see'
);
select throws_ok(
  $$insert into public.social_reactions (post_id, user_id)
    values ('b0000000-0000-0000-0000-0000000000b2', '5a000000-0000-0000-0000-000000005747')$$,
  '42501', null,
  'nor give it kudos'
);

-- ---------- 7. forged ids ----------
select throws_ok(
  $$insert into public.social_comments (post_id, user_id, body)
    values ('b0000000-0000-0000-0000-0000000000b1', '5a000000-0000-0000-0000-00000000a111', 'not me')$$,
  '42501', null,
  'a forged user_id on a comment is refused — the row must be your own'
);
select throws_ok(
  $$insert into public.social_follows (follower_id, following_id)
    values ('5a000000-0000-0000-0000-00000000a111', '5a000000-0000-0000-0000-000000009e57')$$,
  '42501', null,
  'a forged follower_id is refused — you cannot make someone else follow'
);
select throws_ok(
  $$insert into public.social_posts (user_id, type, text, visibility)
    values ('5a000000-0000-0000-0000-00000000a111', 'text', 'forged', 'public')$$,
  '42501', null,
  'nor post as somebody else'
);
select throws_ok(
  $$insert into public.social_follows (follower_id, following_id)
    values ('5a000000-0000-0000-0000-000000005747', '5a000000-0000-0000-0000-000000005747')$$,
  '23514', null,
  'nobody follows themselves'
);
select throws_ok(
  $$insert into public.social_comment_mentions (comment_id, user_id)
    values ('c0000000-0000-0000-0000-0000000000c1', '5a000000-0000-0000-0000-000000005747')$$,
  '42501', null,
  'a mention can only be attached to your own comment'
);

-- ---------- 8. other people's rows stay theirs ----------
select is(
  pg_temp.rows_touched($$update public.social_comments set body = 'hijacked'
                        where id = 'c0000000-0000-0000-0000-0000000000c1'$$),
  0, 'a stranger cannot edit someone else''s comment');
select is(
  pg_temp.rows_touched($$delete from public.social_comments
                        where id = 'c0000000-0000-0000-0000-0000000000c1'$$),
  0, 'nor delete it');
select is(
  pg_temp.rows_touched($$update public.notifications set read_at = now()
                        where user_id = '5a000000-0000-0000-0000-00000000a111'$$),
  0, 'nor mark someone else''s notifications read');
select is(
  (select count(*)::int from public.notifications),
  0, 'and reads none of them in the first place');
select is(
  pg_temp.rows_touched($$delete from public.social_follows
                        where follower_id = '5a000000-0000-0000-0000-00000000fa11'$$),
  0, 'nor break somebody else''s follow');

-- ---------- 9. the owner can ----------
select pg_temp.authenticate_as('5a000000-0000-0000-0000-00000000a111');
select cmp_ok(
  (select count(*)::int from public.notifications), '>', 0,
  'the owner reads their own notifications');
select cmp_ok(
  pg_temp.rows_touched($$update public.notifications set read_at = now()
                        where user_id = '5a000000-0000-0000-0000-00000000a111' and read_at is null$$),
  '>', 0,
  'and marks them read');

-- ---------- 10. feed scopes ----------
select is(
  (select count(*)::int from public.social_feed(20, null, null, 'mine')),
  3, 'the mine scope lists exactly the caller''s own posts');
select pg_temp.authenticate_as('5a000000-0000-0000-0000-000000005747');
select is(
  (select count(*)::int from public.social_feed(20, null, null, 'following')),
  0, 'a stranger following nobody has an empty following feed');
select is(
  (select count(*)::int from public.social_feed(20, null, null, 'all')),
  1, 'but sees the one public post under all — scope widens who is listed, not what is visible');

-- ---------- 11. a deleted post takes its conversation with it ----------
select pg_temp.authenticate_as('5a000000-0000-0000-0000-00000000a111');
update public.social_posts set deleted_at = now() where id = 'b0000000-0000-0000-0000-0000000000b1';
select is((select public.can_see_post('b0000000-0000-0000-0000-0000000000b1')), false,
  'a soft-deleted post is no longer visible to its own author');
select is(
  (select count(*)::int from public.social_feed(20, null, null, 'mine')),
  2, 'and is gone from the feed');
select is(
  (select count(*)::int from public.social_post_comments('b0000000-0000-0000-0000-0000000000b1')),
  0, 'its comments are unreachable, even by id');

select * from finish();
rollback;
