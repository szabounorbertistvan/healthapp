-- pgTAP · two reactions, one per person (20261002100000), and a text post
-- that carries a photo.
--
-- Run with a local stack up:  npm run db:test

begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

create or replace function pg_temp.authenticate_as(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$fn$;

-- ---------- fixtures ----------
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-0000-0000-00000000000a', 'alex@react.local',     '{"full_name":"Alex","username":"alex"}'),
  ('b0000000-0000-0000-0000-00000000000b', 'maria@react.local',    '{"full_name":"Maria D.","username":"maria"}'),
  ('c0000000-0000-0000-0000-00000000000c', 'stranger@react.local', '{"full_name":"Stranger","username":"stranger"}');

insert into public.social_posts (id, user_id, type, text, visibility) values
  ('91000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000b', 'text', 'public post', 'public'),
  ('91000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000b', 'text', 'private post', 'private');

-- ---------- the flip ----------
select pg_temp.authenticate_as('a0000000-0000-0000-0000-00000000000a');

select is(public.social_react('91000000-0000-0000-0000-000000000001', 'kudos'), 'kudos', 'the arm goes on');
select is((select type from public.social_reactions where post_id = '91000000-0000-0000-0000-000000000001' and user_id = 'a0000000-0000-0000-0000-00000000000a'),
  'kudos', '…and is the row');
select is(public.social_react('91000000-0000-0000-0000-000000000001', 'love'), 'love', 'the peach replaces it');
select is((select count(*)::int from public.social_reactions where post_id = '91000000-0000-0000-0000-000000000001' and user_id = 'a0000000-0000-0000-0000-00000000000a'),
  1, 'one row per person, whatever was pressed');
select is((select type from public.social_reactions where post_id = '91000000-0000-0000-0000-000000000001' and user_id = 'a0000000-0000-0000-0000-00000000000a'),
  'love', '…and it is the peach');
select is(public.social_react('91000000-0000-0000-0000-000000000001', 'love'), null, 'the same button again takes it back');
select is((select count(*)::int from public.social_reactions where post_id = '91000000-0000-0000-0000-000000000001'),
  0, '…and the row is gone');
select throws_ok($$ select public.social_react('91000000-0000-0000-0000-000000000001', 'fire') $$,
  '22023', null, 'an unknown reaction is refused');
select throws_ok($$ select public.social_react('91000000-0000-0000-0000-000000000002', 'kudos') $$,
  '42501', null, 'reacting to a post you cannot see is refused (RLS, through the invoker)');
select throws_ok($$
  insert into public.social_reactions (post_id, user_id, type)
  values ('91000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'fire')
$$, '23514', null, 'the table itself only takes the two kinds');

-- the two counts, and the caller's own
select is(public.social_react('91000000-0000-0000-0000-000000000001', 'love'), 'love', 'alex loves the post');
select pg_temp.authenticate_as('c0000000-0000-0000-0000-00000000000c');
select is(public.social_react('91000000-0000-0000-0000-000000000001', 'kudos'), 'kudos', 'the stranger gives the arm on a public post');
select is((select kudos_count from public.social_feed(20, null, null, 'all') where id = '91000000-0000-0000-0000-000000000001'),
  1, 'the feed counts the arms');
select is((select love_count from public.social_feed(20, null, null, 'all') where id = '91000000-0000-0000-0000-000000000001'),
  1, '…and the peaches separately');
select is((select my_reaction from public.social_feed(20, null, null, 'all') where id = '91000000-0000-0000-0000-000000000001'),
  'kudos', '…and knows what the caller pressed');
select is((select my_reaction from public.social_post('91000000-0000-0000-0000-000000000001')),
  'kudos', 'social_post() says the same');
select is((select count(*)::int from public.social_post_kudos('91000000-0000-0000-0000-000000000001', 20, null)),
  2, 'the list shows both people');
select is((select type from public.social_post_kudos('91000000-0000-0000-0000-000000000001', 20, null) where user_id = 'a0000000-0000-0000-0000-00000000000a'),
  'love', '…each with what they pressed');

-- the author: self-reaction refused, one notification per giver naming the kind
select pg_temp.authenticate_as('b0000000-0000-0000-0000-00000000000b');
select throws_ok($$ select public.social_react('91000000-0000-0000-0000-000000000001', 'kudos') $$,
  '42501', null, 'self-reaction is refused');
select is((select count(*)::int from public.notifications
           where user_id = 'b0000000-0000-0000-0000-00000000000b' and category = 'new_kudos'
             and payload ->> 'post_id' = '91000000-0000-0000-0000-000000000001'),
  2, 'one notification per giver, however many times they switched');
select is((select payload ->> 'reaction' from public.notifications
           where user_id = 'b0000000-0000-0000-0000-00000000000b' and category = 'new_kudos'
             and payload ->> 'actor_id' = 'c0000000-0000-0000-0000-00000000000c'),
  'kudos', 'the notification names the reaction');

-- ---------- a text post with a photo ----------
select lives_ok($$
  insert into public.social_posts (id, user_id, type, text, visibility, payload)
  values ('91000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000b', 'text', 'with a picture', 'public',
          '{"kind":"text","photo_url":"https://res.cloudinary.com/x/a.jpg","photo_w":1200,"photo_h":1500,"overlay":{"text":{"x":0.5,"y":0.8,"body":"Leg day","size":"m"}},"kcal":900}')
$$, 'a text post may carry a photo');
select is((select payload from public.social_posts where id = '91000000-0000-0000-0000-000000000003'),
  '{"kind":"text","photo_url":"https://res.cloudinary.com/x/a.jpg","photo_w":1200,"photo_h":1500,"overlay":{"text":{"x":0.5,"y":0.8,"body":"Leg day","size":"m"}}}'::jsonb,
  '…reduced to the photo fields; and a text post without a photo keeps no payload');

select * from finish();
rollback;
