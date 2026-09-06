-- HealthApp schema · 15 portions validator: AND -> CASE
--
-- Restores a correctness fix that a merge dropped. Two people fixed the same
-- "cannot use subquery in check constraint" bug independently on different
-- branches; the resolution kept the version below's *name* but the other
-- version's body was the better one, and it was lost.
--
-- The difference that matters: SQL does not promise left-to-right evaluation
-- of AND, so
--
--     jsonb_typeof(p) = 'array' and jsonb_array_length(p) <= 8 and ...
--
-- lets the planner reach jsonb_array_length() before the type guard has ruled
-- out a non-array — and on a non-array that function raises rather than
-- returning false, which surfaces as an error on INSERT instead of a clean
-- constraint violation. CASE is the one construct with guaranteed ordering,
-- so each guard genuinely runs before the next.
--
-- Body is Relu's from 847b222, verbatim apart from the parameter name and the
-- search_path setting. Replacing the body in place rather than renaming the
-- function keeps foods_portions_shape pointing at the same target, so the
-- constraint is never dropped and the table is never revalidated.
create or replace function public.is_valid_food_portions(p_portions jsonb)
returns boolean language sql immutable parallel safe set search_path = public as $$
  select case
    when jsonb_typeof(p_portions) <> 'array' then false
    when jsonb_array_length(p_portions) > 8  then false
    else not exists (
      select 1
      from jsonb_array_elements(p_portions) as e
      where jsonb_typeof(e) <> 'object'
         or e->>'label' is null
         or length(e->>'label') between 1 and 16 is not true
         or jsonb_typeof(e->'grams') <> 'number'
         or (e->>'grams')::numeric <= 0
         or (e->>'grams')::numeric > 2000
         or coalesce(e->>'origin', '') not in ('curated', 'imported')
    )
  end;
$$;
