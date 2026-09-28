-- pgTAP · Media posts (20261016100000_social_post_media.sql)
--
-- A post carries 0..10 pictures, each an upload the server issued to its
-- author and used once; the pictures are readable exactly when the post is;
-- nothing about them can be written, reused or reached around the rules by a
-- direct call. A = owner, B = follower, C = blocked by A, E = suspended,
-- F = another user, S = stranger to A, anon = not signed in.
--
-- Run with a local stack up:  npm run db:test
-- Or without Docker:          npm run db:test:offline

begin;
create extension if not exists pgtap with schema extensions;
select plan(59);

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
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$fn$;
-- The n-th upload issued to a user and still unused (owner-side read).
create or replace function pg_temp.up(p_user uuid, p_n int)
returns text language sql stable security definer as $fn$
  select public_id from public.social_media_uploads
  where user_id = p_user and attached_at is null and discarded_at is null
  order by created_at, public_id offset p_n - 1 limit 1;
$fn$;
create or replace function pg_temp.item(p_public_id text, p_w int default 1200, p_h int default 1500)
returns jsonb language sql immutable as $fn$
  select jsonb_build_object('public_id', p_public_id, 'width', p_w, 'height', p_h);
$fn$;
-- n unused uploads of a user, as a media list
create or replace function pg_temp.items(p_user uuid, p_n int)
returns jsonb language sql stable security definer as $fn$
  select coalesce(jsonb_agg(jsonb_build_object('public_id', x.public_id, 'width', 1080, 'height', 1350) order by x.public_id), '[]')
  from (select public_id from public.social_media_uploads
        where user_id = p_user and attached_at is null and discarded_at is null
        order by created_at, public_id limit p_n) x;
$fn$;
create or replace function pg_temp.media_rows(p_post uuid)
returns int language sql stable security definer as $fn$
  select count(*)::int from public.social_post_media where post_id = p_post;
$fn$;
create or replace function pg_temp.posts_of(p_user uuid)
returns int language sql stable security definer as $fn$
  select count(*)::int from public.social_posts where user_id = p_user;
$fn$;

-- ---------- people ----------
insert into auth.users (id, email, raw_user_meta_data) values
  ('e1000000-0000-0000-0000-00000000000a', 'a@pm.test', '{"full_name":"Ana","username":"apm"}'),
  ('e1000000-0000-0000-0000-00000000000b', 'b@pm.test', '{"full_name":"Bia","username":"bpm"}'),
  ('e1000000-0000-0000-0000-00000000000c', 'c@pm.test', '{"full_name":"Cip","username":"cpm"}'),
  ('e1000000-0000-0000-0000-00000000000e', 'e@pm.test', '{"full_name":"Eva","username":"epm"}'),
  ('e1000000-0000-0000-0000-00000000000f', 'f@pm.test', '{"full_name":"Fil","username":"fpm"}'),
  ('e1000000-0000-0000-0000-000000000005', 's@pm.test', '{"full_name":"Sam","username":"spm"}');
insert into public.social_follows (follower_id, following_id) values
  ('e1000000-0000-0000-0000-00000000000b', 'e1000000-0000-0000-0000-00000000000a'),
  ('e1000000-0000-0000-0000-00000000000b', 'e1000000-0000-0000-0000-00000000000e');
insert into public.social_user_blocks (blocker_id, blocked_id) values
  ('e1000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-00000000000c');

-- ================= uploads are issued by the server, to you =================
select pg_temp.authenticate_as('e1000000-0000-0000-0000-00000000000a');
select throws_ok($$ select public.social_media_upload_register(11) $$, '22023', null, 'at most ten uploads per request');
select throws_ok($$ select public.social_media_upload_register(0) $$, '22023', null, '…and at least one');
select is((select count(*)::int from public.social_media_upload_register(10)), 10, 'A is issued ten uploads');
select ok((select bool_and(x ~ '^voinic/posts/e1000000-0000-0000-0000-00000000000a/m-')
           from public.social_media_upload_register(10) x),
  'every public_id is minted in A''s own post folder');
select throws_ok($$ insert into public.social_media_uploads (public_id, user_id)
                    values ('voinic/posts/e1000000-0000-0000-0000-00000000000a/m-00000000-0000-0000-0000-000000000000',
                            'e1000000-0000-0000-0000-00000000000a') $$,
  '42501', null, 'nobody writes an upload row by hand');
select is((select count(*)::int from public.social_media_uploads), 20, 'A reads only A''s own uploads');

-- ================= posts with 0, 1, many pictures =================
select lives_ok($$ select public.social_create_post('text', 'no pictures', 'public') $$, 'a text post with no pictures');
select throws_ok($$ select public.social_create_post('text', '   ', 'public') $$, '22023', null,
  'no words and no picture is no post');
select lives_ok(format($$ select public.social_create_post('text', null, 'public', null, '[%s]'::jsonb) $$,
                       pg_temp.item(pg_temp.up('e1000000-0000-0000-0000-00000000000a', 1))),
  'one picture and no words is a post');

create temp table ids (label text, id uuid);
grant all on ids to authenticated;
insert into ids
  select 'single', id from public.social_posts
  where user_id = 'e1000000-0000-0000-0000-00000000000a' and text is null;
select is((select jsonb_array_length(media) from public.social_post((select id from ids where label = 'single'))), 1,
  'social_post returns its one picture');
select is((select media -> 0 ->> 'width' from public.social_post((select id from ids where label = 'single'))), '1200',
  '…with its pixel size');

insert into ids select 'carousel', public.social_create_post('text', 'three', 'followers', null, pg_temp.items('e1000000-0000-0000-0000-00000000000a', 3));
select is(pg_temp.media_rows((select id from ids where label = 'carousel')), 3, 'a carousel of three');
select is((select string_agg(position::text, ',' order by position) from public.social_post_media
           where post_id = (select id from ids where label = 'carousel')), '0,1,2',
  '…in the order they were sent');
select is((select count(distinct m ->> 'public_id')::int
           from public.social_post((select id from ids where label = 'carousel')) p, jsonb_array_elements(p.media) m), 3,
  '…and the read returns each once');

insert into ids select 'ten', public.social_create_post('progress', 'ten', 'public', '{"kind":"progress"}'::jsonb,
                                                          pg_temp.items('e1000000-0000-0000-0000-00000000000a', 6)
                                                          || pg_temp.items('e1000000-0000-0000-0000-00000000000a', 0));
-- (6 left after the first four; top up to ten below)
select pg_temp.authenticate_as('e1000000-0000-0000-0000-00000000000a');
select lives_ok($$ select public.social_media_upload_register(10) $$, 'A is issued ten more');
select throws_ok(format($$ select public.social_create_post('text', 'eleven', 'public', null, %L::jsonb) $$,
                        pg_temp.items('e1000000-0000-0000-0000-00000000000a', 11)),
  '22023', null, 'eleven pictures are refused');
select is(pg_temp.posts_of('e1000000-0000-0000-0000-00000000000a'), 4, '…and no post is left behind');
insert into ids select 'ten2', public.social_create_post('text', 'exactly ten', 'public', null,
                                                           pg_temp.items('e1000000-0000-0000-0000-00000000000a', 10));
select is(pg_temp.media_rows((select id from ids where label = 'ten2')), 10, 'exactly ten is a post');
select throws_ok(format($$ insert into public.social_post_media (post_id, user_id, position, public_id, width, height)
                           values (%L, 'e1000000-0000-0000-0000-00000000000a', 0, %L, 10, 10) $$,
                        (select id from ids where label = 'single'), pg_temp.up('e1000000-0000-0000-0000-00000000000a', 1)),
  '23505', null, 'one picture per position');
select throws_ok(format($$ select public.social_create_post('text', 'x', 'public', null, '[{"public_id":%s,"width":10,"height":10,"kind":"video"}]'::jsonb) $$,
                        to_jsonb(pg_temp.up('e1000000-0000-0000-0000-00000000000a', 1))::text),
  '22023', null, 'no video yet: the schema knows the kind, the guard refuses it');

-- ================= invalid references =================
select throws_ok(format($$ select public.social_create_post('text', 'x', 'public', null, '[%s]'::jsonb) $$,
                        (select media -> 0 from public.social_post((select id from ids where label = 'single')))),
  'P0002', null, 'an upload already used is not a second post''s picture');
select throws_ok($$ select public.social_create_post('text', 'x', 'public', null,
                   '[{"public_id":"voinic/posts/e1000000-0000-0000-0000-00000000000a/m-11111111-1111-1111-1111-111111111111","width":10,"height":10}]'::jsonb) $$,
  'P0002', null, 'a public_id the server never issued is refused');
select pg_temp.authenticate_as('e1000000-0000-0000-0000-00000000000f');
select lives_ok($$ select public.social_media_upload_register(2) $$, 'F is issued uploads');
select pg_temp.authenticate_as('e1000000-0000-0000-0000-00000000000a');
select throws_ok(format($$ select public.social_create_post('text', 'x', 'public', null, '[%s]'::jsonb) $$,
                        pg_temp.item(pg_temp.up('e1000000-0000-0000-0000-00000000000f', 1))),
  'P0002', null, 'someone else''s upload is refused');
select is(pg_temp.posts_of('e1000000-0000-0000-0000-00000000000a'), 5, 'none of the refused calls left a post');
select throws_ok($$ select public.social_create_post('text', 'x', 'public', null, '[{"public_id":"x"}]'::jsonb) $$,
  '22023', null, 'a media item without a size is invalid');
select throws_ok($$ select public.social_create_post('text', 'x', 'public', null, '{"public_id":"x"}'::jsonb) $$,
  '22023', null, 'media is a list');

-- a picture without a valid post: none, someone else's, deleted, old
select throws_ok(format($$ insert into public.social_post_media (post_id, user_id, position, public_id, width, height)
                           values ('e2000000-0000-0000-0000-000000000000', 'e1000000-0000-0000-0000-00000000000a', 0, %L, 10, 10) $$,
                        pg_temp.up('e1000000-0000-0000-0000-00000000000a', 1)),
  'P0002', null, 'a picture on a post that does not exist');
select pg_temp.authenticate_as('e1000000-0000-0000-0000-00000000000f');
insert into ids select 'fpost', public.social_create_post('text', 'F''s post', 'public');
select pg_temp.authenticate_as('e1000000-0000-0000-0000-00000000000a');
select throws_ok(format($$ insert into public.social_post_media (post_id, user_id, position, public_id, width, height)
                           values (%L, 'e1000000-0000-0000-0000-00000000000a', 0, %L, 10, 10) $$,
                        (select id from ids where label = 'fpost'), pg_temp.up('e1000000-0000-0000-0000-00000000000a', 1)),
  'P0002', null, 'a picture on someone else''s post');
insert into ids select 'plain', public.social_create_post('text', 'plain', 'public');
select pg_temp.as_owner();
update public.social_posts set created_at = now() - interval '1 hour' where id = (select id from ids where label = 'plain');
select pg_temp.authenticate_as('e1000000-0000-0000-0000-00000000000a');
select throws_ok(format($$ insert into public.social_post_media (post_id, user_id, position, public_id, width, height)
                           values (%L, 'e1000000-0000-0000-0000-00000000000a', 0, %L, 10, 10) $$,
                        (select id from ids where label = 'plain'), pg_temp.up('e1000000-0000-0000-0000-00000000000a', 1)),
  '22023', null, 'pictures are added when a post is created, not to an old one');
select throws_ok($$ update public.social_post_media set width = 1 $$, '42501', null, 'nobody changes a picture row');
select throws_ok($$ delete from public.social_post_media $$, '42501', null, 'nor deletes one directly');

-- ================= who sees the pictures =================
select pg_temp.authenticate_as('e1000000-0000-0000-0000-00000000000b');
select is(pg_temp.media_rows((select id from ids where label = 'carousel')), 3, 'owner-side: three rows exist');
select is((select count(*)::int from public.social_post_media where post_id = (select id from ids where label = 'carousel')), 3,
  'B, a follower, reads the followers post''s pictures');
select is((select jsonb_array_length(media) from public.social_feed(50) where id = (select id from ids where label = 'carousel')), 3,
  '…and the feed carries them');
select pg_temp.authenticate_as('e1000000-0000-0000-0000-000000000005');
select is((select count(*)::int from public.social_post_media where post_id = (select id from ids where label = 'carousel')), 0,
  'S, not a follower: no picture rows…');
select is((select count(*)::int from public.social_post((select id from ids where label = 'carousel'))), 0, '…and no post');
select is((select count(*)::int from public.social_post_media where post_id = (select id from ids where label = 'single')), 1,
  'S reads a public post''s picture');
select pg_temp.authenticate_as('e1000000-0000-0000-0000-00000000000c');
select is((select count(*)::int from public.social_post_media where post_id = (select id from ids where label = 'single')), 0,
  'C, blocked by A: not even the public post''s picture');
select is((select count(*)::int from public.social_feed(50, null, 'e1000000-0000-0000-0000-00000000000a')), 0, '…nor the posts');

set local role anon;
select throws_ok($$ select count(*) from public.social_post_media $$, '42501', null, 'anonymous: no picture rows');
select throws_ok($$ select public.social_create_post('text', 'x', 'public') $$, '42501', null, 'anonymous: no posts');
select throws_ok($$ select public.social_media_upload_register(1) $$, '42501', null, 'anonymous: no uploads');

-- a suspended author's pictures leave with the posts
select pg_temp.authenticate_as('e1000000-0000-0000-0000-00000000000e');
select lives_ok($$ select public.social_media_upload_register(1) $$, 'E is issued an upload');
insert into ids select 'epost', public.social_create_post('text', 'by E', 'public', null, pg_temp.items('e1000000-0000-0000-0000-00000000000e', 1));
select pg_temp.as_owner();
update public.users set suspended_at = now() where id = 'e1000000-0000-0000-0000-00000000000e';
select pg_temp.authenticate_as('e1000000-0000-0000-0000-00000000000b');
select is((select count(*)::int from public.social_post_media where post_id = (select id from ids where label = 'epost')), 0,
  'a suspended author''s picture is not readable');
select pg_temp.authenticate_as('e1000000-0000-0000-0000-00000000000e');
select throws_ok($$ select public.social_media_upload_register(1) $$, '42501', null, 'suspended: no new uploads');
select throws_ok($$ select public.social_create_post('text', 'still', 'public') $$, '42501', null, 'suspended: no new posts');

-- a deleted post's pictures are gone from every read, and the rows stay
select pg_temp.authenticate_as('e1000000-0000-0000-0000-00000000000a');
update public.social_posts set deleted_at = now() where id = (select id from ids where label = 'single');
select pg_temp.authenticate_as('e1000000-0000-0000-0000-00000000000b');
select is((select count(*)::int from public.social_post_media where post_id = (select id from ids where label = 'single')), 0,
  'deleted post: its picture is not readable');
select is((select count(*)::int from public.social_post((select id from ids where label = 'single'))), 0, '…nor the post');
select is(pg_temp.media_rows((select id from ids where label = 'single')), 1, '…while the row is kept (soft delete, moderation)');

-- shared and saved surfaces carry the same pictures
select lives_ok(format($$ insert into public.social_posts (user_id, type, payload, visibility)
                         values ('e1000000-0000-0000-0000-00000000000b', 'shared_post',
                                 jsonb_build_object('kind', 'shared_post', 'original_post_id', %L::text), 'public') $$,
                       (select id from ids where label = 'ten2')),
  'B shares A''s ten-picture post');
select is((select jsonb_array_length(shared -> 'media') from public.social_feed(50) where type = 'shared_post' and user_id = 'e1000000-0000-0000-0000-00000000000b'), 10,
  'the share carries the original''s pictures');
insert into public.social_post_saves (user_id, post_id) values ('e1000000-0000-0000-0000-00000000000b', (select id from ids where label = 'carousel'));
select is((select jsonb_array_length(media) from public.social_saved_posts(20) where id = (select id from ids where label = 'carousel')), 3,
  'the saved list carries them too');

-- ================= abandoned uploads =================
select pg_temp.authenticate_as('e1000000-0000-0000-0000-00000000000f');
select is((select count(*)::int from public.social_media_discardable(array[pg_temp.up('e1000000-0000-0000-0000-00000000000a', 1)])), 0,
  'F cannot list A''s uploads as discardable…');
select is(public.social_media_mark_discarded(array[pg_temp.up('e1000000-0000-0000-0000-00000000000a', 1)]), 0,
  '…nor discard them');
select pg_temp.authenticate_as('e1000000-0000-0000-0000-00000000000a');
select is((select count(*)::int from public.social_media_discardable(null)), 0, 'nothing of A''s is a day old yet');
select pg_temp.as_owner();
update public.social_media_uploads set created_at = now() - interval '2 days'
 where public_id = pg_temp.up('e1000000-0000-0000-0000-00000000000a', 1);
select pg_temp.authenticate_as('e1000000-0000-0000-0000-00000000000a');
select is((select count(*)::int from public.social_media_discardable(null)), 1, 'an unused upload older than a day is abandoned');
select is(public.social_media_mark_discarded(array(select public.social_media_discardable(null))), 1, 'A discards it');
select is((select count(*)::int from public.social_media_discardable(null)), 0, '…and it is not listed again');

select * from finish();
rollback;
