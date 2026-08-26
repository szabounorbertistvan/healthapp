-- Serving sizes for foods that are eaten by the piece, not weighed.
--
-- Two origins, deliberately kept in one column:
--
--   * imported  — Open Food Facts serving_quantity, written by the food-search
--                 and barcode-lookup functions. One entry per product at most:
--                 OFF stores a single serving per barcode, so nothing richer
--                 can come from it.
--   * curated   — hand-authored ranges for generic whole foods (egg S/M/L,
--                 banana, bread slice). OFF cannot supply these: an egg grade
--                 is a property of loose eggs, not of a packaged product, and
--                 OFF is a packaged-product database.
--
-- Grams are ALWAYS edible weight. OFF reports eggs shell-on (an EU large is
-- 63-73 g in the box, ~58 g eaten), so the import applies a per-category
-- refuse factor rather than storing the label number.

alter table public.foods
  add column portions jsonb not null default '[]';

comment on column public.foods.portions is
  'Serving presets: [{"label":"M","grams":50,"note":"...","origin":"curated|imported"}]. Grams are edible weight.';

-- Shape guard. jsonb has no schema of its own, and these rows are written by
-- an edge function parsing third-party free text, so the constraint is the only
-- thing standing between a bad upstream value and the client UI.
alter table public.foods
  add constraint foods_portions_shape check (
    jsonb_typeof(portions) = 'array'
    and jsonb_array_length(portions) <= 8
    and not exists (
      select 1
      from jsonb_array_elements(portions) as p
      where jsonb_typeof(p) <> 'object'
         or p->>'label' is null
         or length(p->>'label') between 1 and 16 is not true
         or jsonb_typeof(p->'grams') <> 'number'
         or (p->>'grams')::numeric <= 0
         or (p->>'grams')::numeric > 2000
         or coalesce(p->>'origin', '') not in ('curated', 'imported')
    )
  );

-- Curated ranges for the generic staples the demo table already ships, matched
-- by name because these rows have no barcode. Only touches foods that exist;
-- a fresh database simply gets nothing here, which is correct.
update public.foods set portions = '[
  {"label":"S","grams":44,"note":"small, under 53 g with shell","origin":"curated"},
  {"label":"M","grams":50,"note":"medium, 53-63 g with shell","origin":"curated"},
  {"label":"L","grams":58,"note":"large, 63-73 g with shell","origin":"curated"},
  {"label":"XL","grams":66,"note":"very large, over 73 g with shell","origin":"curated"}
]'::jsonb
where source = 'custom'
  and (lower(name_en) like '%egg%' or lower(name_ro) like '%ou%')
  and lower(coalesce(name_en, '')) not like '%white%'
  and lower(coalesce(name_ro, '')) not like '%albu%';

update public.foods set portions = '[
  {"label":"S","grams":90,"note":"small, peeled","origin":"curated"},
  {"label":"M","grams":118,"note":"medium, peeled","origin":"curated"},
  {"label":"L","grams":136,"note":"large, peeled","origin":"curated"}
]'::jsonb
where source = 'custom'
  and (lower(name_en) like '%banana%' or lower(name_ro) like '%banan%');

create index foods_portions_idx on public.foods using gin (portions)
  where jsonb_array_length(portions) > 0;

-- The cache-fill path upserts whole rows, so every re-fetch of a product would
-- otherwise overwrite portions with whatever OFF says today. Two things must
-- survive that: a curated range (which OFF can never reproduce) and a good
-- imported value (which a later fetch may return as empty).
create or replace function public.preserve_food_portions()
returns trigger language plpgsql as $$
begin
  -- an incoming empty list never destroys what is already there
  if jsonb_array_length(new.portions) = 0 then
    new.portions := old.portions;
    return new;
  end if;

  -- curated entries outrank anything imported
  if exists (
    select 1 from jsonb_array_elements(old.portions) as p
    where p->>'origin' = 'curated'
  ) and not exists (
    select 1 from jsonb_array_elements(new.portions) as p
    where p->>'origin' = 'curated'
  ) then
    new.portions := old.portions;
  end if;

  return new;
end;
$$;

create trigger foods_preserve_portions
  before update on public.foods
  for each row execute function public.preserve_food_portions();
