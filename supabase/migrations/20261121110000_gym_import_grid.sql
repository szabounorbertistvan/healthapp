-- HealthApp schema · gym import: a whole city, each gym in its own town
--
-- 20261121100000 imported at most 100 places a call and wrote the searched
-- city on every gym. The import now searches a city as a grid (Text Search
-- stops at 60 results; lib/google-places.ts), which finds more than 100 —
-- Cluj-Napoca has 115 — and reaches the next towns, so:
--   * up to 200 places a call (the app sends batches), 1000 ids to check;
--   * a gym's city is the "locality" of Google's addressComponents when there
--     is one (Florești, Baciu), else the city searched.
-- Both functions from 20261121100000, changed only there.

create or replace function public.admin_import_gyms(p_places jsonb, p_city text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_city text := nullif(btrim(coalesce(p_city, '')), '');
  v_place jsonb;
  v_id uuid;
  v_name text;
  v_url text;
  v_place_city text;
  v_imported int := 0;
  v_skipped int := 0;
begin
  perform public.admin_assert();
  if jsonb_typeof(p_places) <> 'array' or jsonb_array_length(p_places) > 200 then
    raise exception 'GYM_IMPORT' using errcode = '22023';
  end if;
  if v_city is null or length(v_city) > 80 then
    raise exception 'GYM_CITY' using errcode = '22023';
  end if;

  for v_place in select value from jsonb_array_elements(p_places) loop
    if jsonb_typeof(v_place) <> 'object'
       or coalesce(v_place ->> 'id', '') !~ '^[A-Za-z0-9_-]+$' or length(v_place ->> 'id') > 300
       or exists (select 1 from public.gyms g where g.google_place_id = v_place ->> 'id') then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    v_name := left(btrim(coalesce(v_place #>> '{displayName,text}', '')), 120);
    if length(v_name) < 2 then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    v_url := v_place ->> 'googleMapsUri';
    -- The place's own town when Google names it (a gym in Florești is not in
    -- Cluj-Napoca), else the city that was searched.
    select left(btrim(c ->> 'longText'), 80) into v_place_city
      from jsonb_array_elements(case when jsonb_typeof(v_place -> 'addressComponents') = 'array'
                                     then v_place -> 'addressComponents' else '[]' end) c
     where jsonb_typeof(c -> 'types') = 'array' and c -> 'types' ? 'locality'
     limit 1;
    insert into public.gyms (name, city, address, lat, lng, maps_url, status, approved_by, approved_at)
    values (
      v_name, coalesce(nullif(v_place_city, ''), v_city),
      left(nullif(btrim(coalesce(v_place ->> 'formattedAddress', '')), ''), 200),
      case when (v_place #>> '{location,latitude}')::double precision between -90 and 90
            and (v_place #>> '{location,longitude}')::double precision between -180 and 180
           then (v_place #>> '{location,latitude}')::double precision end,
      case when (v_place #>> '{location,latitude}')::double precision between -90 and 90
            and (v_place #>> '{location,longitude}')::double precision between -180 and 180
           then (v_place #>> '{location,longitude}')::double precision end,
      case when v_url ~ '^https://' and length(v_url) <= 500 then v_url end,
      'active', auth.uid(), now()
    )
    returning id into v_id;
    perform public.gym_apply_google(v_id, v_place);
    v_imported := v_imported + 1;
  end loop;

  perform public.audit_log('ADMIN_ACTION', 'gym', null, null,
    jsonb_build_object('kind', 'gym_import', 'city', v_city, 'imported', v_imported, 'skipped', v_skipped));
  return jsonb_build_object('imported', v_imported, 'skipped', v_skipped);
end;
$$;
revoke execute on function public.admin_import_gyms(jsonb, text) from public, anon;
grant execute on function public.admin_import_gyms(jsonb, text) to authenticated;

/** Which of these Google place ids are already gyms — the import list marks them. */
create or replace function public.admin_known_place_ids(p_ids text[])
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(g.google_place_id), '{}')
  from public.gyms g
  where public.is_admin() and g.google_place_id = any (p_ids[1:1000]);
$$;
revoke execute on function public.admin_known_place_ids(text[]) from public, anon;
grant execute on function public.admin_known_place_ids(text[]) to authenticated;
