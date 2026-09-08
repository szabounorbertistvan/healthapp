-- Diacritic-insensitive food search.
--
-- Romanian names carry ă â î ș ț, and nobody types them on a phone: a search
-- for "varza" must find "Varză". The app already normalises what the person
-- typed (packages/shared normalizeForSearch); this gives the table the same
-- treatment, once, in a stored generated column, so a plain ILIKE on it
-- matches regardless of accents or case in either place.
--
-- `unaccent` is only STABLE, and a generated column needs an IMMUTABLE
-- expression, hence the wrapper that pins the dictionary. Standard trick.

create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;

create or replace function public.search_normalize(p_text text)
returns text
language sql immutable parallel safe
set search_path = extensions, public
as $$
  select lower(unaccent('unaccent', coalesce(p_text, '')));
$$;

comment on function public.search_normalize(text) is
  'lower() + unaccent(), immutable so it can back generated columns. Mirrors normalizeForSearch in packages/shared.';

alter table public.foods
  add column if not exists search_text text
  generated always as (
    public.search_normalize(
      coalesce(name_en, '') || ' ' || coalesce(name_ro, '') || ' ' || coalesce(brand, '')
    )
  ) stored;

-- Trigram index so the substring search stays an index scan as the cache grows.
create index if not exists foods_search_text_trgm_idx
  on public.foods using gin (search_text extensions.gin_trgm_ops);
