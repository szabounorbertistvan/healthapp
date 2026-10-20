-- pgTAP · custom foods: a person creates their own food (the food logger's
-- "Create a food", a barcode miss) and finds it again by search and by scan;
-- nobody else can read, find, scan, edit or publish it.
-- Migrations 20260823000800 (policies), 20261019120000 (not listable),
-- 20261206100000 (custom stays custom, own barcode row first).
--
-- Run with a local stack up:  npm run db:test

begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

create or replace function pg_temp.authenticate_as(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$fn$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('cf000000-0000-0000-0000-000000000001', 'owner@customfoods.local', '{"full_name":"Owner","username":"cf_owner"}'),
  ('cf000000-0000-0000-0000-000000000002', 'other@customfoods.local', '{"full_name":"Other","username":"cf_other"}');

-- an Open Food Facts row for a second code, to check which row a scan returns
insert into public.foods (id, source, external_id, barcode, name_en, kcal_100g, verified) values
  ('cf000000-0000-0000-0000-00000000a002', 'off', '5940000000002', '5940000000002', 'Shop zacusca', 90, true);

select pg_temp.authenticate_as('cf000000-0000-0000-0000-000000000001');

-- 1  the owner creates a custom food the way createCustomFood does
select lives_ok($$
  insert into public.foods (id, source, owner_id, name_en, name_ro, brand, barcode,
                            kcal_100g, protein_100g, carbs_100g, fat_100g,
                            saturated_fat_100g, sugar_100g, salt_100g, portions)
  values ('cf000000-0000-0000-0000-00000000a001', 'custom', 'cf000000-0000-0000-0000-000000000001',
          'Zacusca bunicii', 'Zacusca bunicii', 'Acasa', '5940000000001',
          95, 1.5, 8, 6, 0.8, 5, 1.1,
          '[{"label":"1 jar","grams":400,"note":"","origin":"curated"}]')
$$, 'an owner inserts their own custom food with label nutrients, barcode and a serving');

-- 2-4  the insert is pinned to custom / own / unverified
select throws_ok($$
  insert into public.foods (source, owner_id, name_en, kcal_100g)
  values ('custom', 'cf000000-0000-0000-0000-000000000002', 'Planted', 10)
$$, '42501', null, 'nobody creates a custom food in someone else''s name');
select throws_ok($$
  insert into public.foods (source, owner_id, name_en, kcal_100g)
  values ('off', 'cf000000-0000-0000-0000-000000000001', 'Fake shared', 10)
$$, '42501', null, 'a user cannot insert a shared-library row');
select throws_ok($$
  insert into public.foods (source, owner_id, name_en, kcal_100g, verified)
  values ('custom', 'cf000000-0000-0000-0000-000000000001', 'Self-verified', 10, true)
$$, '42501', null, 'a user cannot mark their own food verified');

-- 5  a malformed serving list is refused by the shape constraint
select throws_ok($$
  insert into public.foods (source, owner_id, name_en, kcal_100g, portions)
  values ('custom', 'cf000000-0000-0000-0000-000000000001', 'Bad serving', 10,
          '[{"label":"a label far longer than sixteen","grams":10,"origin":"curated"}]')
$$, '23514', null, 'portions must match foods_portions_shape');

-- 6-9  the owner finds it again
select is((select count(*)::int from public.search_foods('zacusca bun')), 1,
  'search_foods finds the owner''s custom food');
select is((select name_ro from public.food_by_barcode('5940000000001')), 'Zacusca bunicii',
  'food_by_barcode finds it by the scanned code');
select is((select count(*)::int from public.food_by_id('cf000000-0000-0000-0000-00000000a001')), 1,
  'food_by_id reaches it');
select is((select salt_100g from public.foods where id = 'cf000000-0000-0000-0000-00000000a001'), 1.10::numeric(6,2),
  'the owner reads the row, label nutrients included');

-- 10  an owner's own row beats a shared row on the same code
insert into public.foods (id, source, owner_id, barcode, name_en, name_ro, kcal_100g)
values ('cf000000-0000-0000-0000-00000000a003', 'custom', 'cf000000-0000-0000-0000-000000000001',
        '5940000000002', 'My zacusca', 'Zacusca mea', 80);
select is((select id from public.food_by_barcode('5940000000002')), 'cf000000-0000-0000-0000-00000000a003'::uuid,
  'a scan returns the person''s own row before the shared one');

-- 11  the owner may edit it, but it stays custom
select throws_ok($$
  update public.foods set source = 'off', external_id = 'leak'
   where id = 'cf000000-0000-0000-0000-00000000a001'
$$, '42501', null, 'an owner cannot turn their custom food into a shared-library row');

-- 12-17  nobody else sees, finds, scans or edits it
select pg_temp.authenticate_as('cf000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.foods where id = 'cf000000-0000-0000-0000-00000000a001'), 0,
  'another user cannot read the row');
select is((select count(*)::int from public.search_foods('zacusca bun')), 0,
  'another user''s search does not find it');
select is((select count(*)::int from public.food_by_barcode('5940000000001')), 0,
  'another user''s scan of the code does not find it');
select is((select id from public.food_by_barcode('5940000000002')), 'cf000000-0000-0000-0000-00000000a002'::uuid,
  'another user''s scan of the shared code gets the shared row, not the custom one');
update public.foods set name_en = 'hijacked' where id = 'cf000000-0000-0000-0000-00000000a001';
delete from public.foods where id = 'cf000000-0000-0000-0000-00000000a001';
reset role;
select is((select name_en from public.foods where id = 'cf000000-0000-0000-0000-00000000a001'), 'Zacusca bunicii',
  'another user can neither edit nor delete it');
select is((select source::text from public.foods where id = 'cf000000-0000-0000-0000-00000000a001'), 'custom',
  'the row is still custom');

select * from finish();
rollback;
