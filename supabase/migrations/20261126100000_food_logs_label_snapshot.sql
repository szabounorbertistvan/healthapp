-- Label nutrients snapshotted at log time, like the macros.
--
-- food_logs has always stored the four macros of an entry as they were when it
-- was logged (an edited or re-imported food must not rewrite history). The
-- label nutrients added in 20261019100000 (saturated fat, sugar, salt) were
-- not: the Progress nutrition card and the progress report read them through
-- the food as it is *now*, so editing a custom food, or a re-run of the USDA
-- import, silently changed past days' averages.
--
-- Three nullable columns, grams on the row (the per-100 g value × grams / 100).
-- Null stays "not measured", never 0 — a food without the value, a quick entry
-- without a food, or a food that was deleted before this backfill.
--
-- Written only by the trigger below, never by the browser: food_logs has no
-- column grants, so an insert or update could carry any value; the trigger
-- replaces what was sent.
--   insert                         → from the linked food (null without one)
--   update changing food_id        → from the new food
--   update changing grams only     → the existing snapshot, rescaled
--   any other update               → the existing snapshot, unchanged

alter table public.food_logs
  add column if not exists saturated_fat_g numeric(9,2) check (saturated_fat_g is null or saturated_fat_g >= 0),
  add column if not exists sugar_g         numeric(9,2) check (sugar_g is null or sugar_g >= 0),
  add column if not exists salt_g          numeric(9,2) check (salt_g is null or salt_g >= 0);

comment on column public.food_logs.saturated_fat_g is 'g in this entry, snapshotted at log time by food_logs_label_snapshot(); null = not measured';
comment on column public.food_logs.sugar_g         is 'g total sugars in this entry, snapshotted at log time; null = not measured';
comment on column public.food_logs.salt_g          is 'g salt (NaCl) in this entry, snapshotted at log time; null = not measured';

-- Backfill: the best there is for past rows is the food as it is today — what
-- the readers showed until now, so no figure changes on the day this lands.
update public.food_logs l
   set saturated_fat_g = round(f.saturated_fat_100g * l.grams / 100, 2),
       sugar_g         = round(f.sugar_100g         * l.grams / 100, 2),
       salt_g          = round(f.salt_100g          * l.grams / 100, 2)
  from public.foods f
 where f.id = l.food_id
   and (f.saturated_fat_100g is not null or f.sugar_100g is not null or f.salt_100g is not null);

-- security definer: foods is not listable (20261001), and the snapshot must be
-- taken whatever the caller may read; it reads one row by primary key and
-- returns nothing to the caller.
create or replace function public.food_logs_label_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  f record;
begin
  if tg_op = 'UPDATE' and new.food_id is not distinct from old.food_id then
    if new.grams is distinct from old.grams and old.grams > 0 then
      new.saturated_fat_g := round(old.saturated_fat_g * new.grams / old.grams, 2);
      new.sugar_g         := round(old.sugar_g         * new.grams / old.grams, 2);
      new.salt_g          := round(old.salt_g          * new.grams / old.grams, 2);
    else
      new.saturated_fat_g := old.saturated_fat_g;
      new.sugar_g         := old.sugar_g;
      new.salt_g          := old.salt_g;
    end if;
    return new;
  end if;

  new.saturated_fat_g := null;
  new.sugar_g         := null;
  new.salt_g          := null;
  if new.food_id is not null then
    select saturated_fat_100g, sugar_100g, salt_100g into f
      from public.foods where id = new.food_id;
    if found then
      new.saturated_fat_g := round(f.saturated_fat_100g * new.grams / 100, 2);
      new.sugar_g         := round(f.sugar_100g         * new.grams / 100, 2);
      new.salt_g          := round(f.salt_100g          * new.grams / 100, 2);
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.food_logs_label_snapshot() from public, anon, authenticated;

drop trigger if exists food_logs_label_snapshot on public.food_logs;
create trigger food_logs_label_snapshot
  before insert or update on public.food_logs
  for each row execute function public.food_logs_label_snapshot();
