-- Settles the ambivalent comment on program_days.day_index ("0=Sun .. 6=Sat,
-- or ordinal within week"). The unique key (program_id, week_index, day_index)
-- only makes sense for a per-week ordinal, and builder-actions.ts now computes
-- it that way. Comment only; no data changes.
comment on column public.program_days.day_index is
  '0-based ordinal of the day within its week. Not a weekday.';
