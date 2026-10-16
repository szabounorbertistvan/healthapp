-- search_foods(): the plain food before the dishes that mention it.
--
-- Until now the order inside the Romanian-named block was alphabetical, so a
-- one-word search like "morcovi" listed "Mazăre cu morcovi (conservă)",
-- "Mazăre cu morcovi congelată"… before "Morcovi cruzi" / "Morcovi fierți" —
-- with 1,114 Romanian names applied on 2026-10-16, a common word now matches
-- dozens of compound dishes, and the 60-row cut could drop the plain food
-- altogether.
--
-- New order, everything else unchanged (same matching, same ≥ 2 characters,
-- same 60-row cap, same 400-a-day quota, other people's customs still hidden):
--
--   1. Romanian-named rows before the English USDA tail (as before);
--   2. within each block: a name equal to the term, then a name starting with
--      it, then the rest — judged on name_ro and name_en, whichever ranks
--      better, both normalised the way search_text is (lower + unaccent);
--   3. then the previous tie-breaks: name_ro, verified first, name_en.

create or replace function public.search_foods(p_q text, p_limit int default 60)
returns table (
  id uuid, source food_source, name_en text, name_ro text, brand text,
  kcal_100g numeric, protein_100g numeric, carbs_100g numeric, fat_100g numeric,
  portions jsonb, verified boolean
)
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  -- search_text is the lower-cased, unaccented name+brand kept by the table;
  -- the term gets the same treatment, minus LIKE/filter metacharacters.
  v_q    text := btrim(public.search_normalize(regexp_replace(coalesce(p_q, ''), '[,()%\\_]', ' ', 'g')));
  v_hits int;
begin
  if v_user is null then
    raise exception 'NOT_SIGNED_IN' using errcode = '42501';
  end if;
  if length(v_q) < 2 then
    return;
  end if;

  insert into public.food_search_quota as q (user_id, day, hits)
  values (v_user, current_date, 1)
  on conflict (user_id, day) do update set hits = q.hits + 1
  returning q.hits into v_hits;
  if v_hits > 400 then
    raise exception 'FOOD_SEARCH_RATE' using errcode = 'P0001';
  end if;

  return query
    select f.id, f.source, f.name_en, f.name_ro, f.brand,
           f.kcal_100g, f.protein_100g, f.carbs_100g, f.fat_100g,
           f.portions, f.verified
      from public.foods f
      cross join lateral (
        select btrim(public.search_normalize(f.name_ro)) as ro,
               btrim(public.search_normalize(f.name_en)) as en
      ) n
     where f.search_text like '%' || v_q || '%'
       and (f.source <> 'custom' or f.owner_id = v_user)
     -- Romanian-named rows first (the pickers fold what is left of the English
     -- USDA tail); inside each block exact name, then name prefix, then the
     -- rest; then by name, the verified first.
     order by (f.name_ro is null),
              least(
                case when f.name_ro is null then 2
                     when n.ro = v_q then 0
                     when n.ro like v_q || '%' then 1
                     else 2 end,
                case when n.en = v_q then 0
                     when n.en like v_q || '%' then 1
                     else 2 end),
              f.name_ro, f.verified desc, f.name_en
     limit least(greatest(coalesce(p_limit, 60), 1), 60);
end;
$$;
revoke execute on function public.search_foods(text, int) from public, anon;
grant execute on function public.search_foods(text, int) to authenticated;
