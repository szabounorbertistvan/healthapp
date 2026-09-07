-- HealthApp schema · 16 muscle groups per training day
--
-- A client building their own week picks what a day covers before picking the
-- exercises for it, so the day has to remember the choice: it labels the card
-- and pre-filters the exercise picker.
--
-- No check constraint on the values. They mirror exercises.primary_muscles, the
-- library grows by import, and the picker only ever offers groups that exist in
-- it — so a constraint would age badly while adding nothing today.
alter table public.program_days
  add column muscle_groups text[] not null default '{}';

comment on column public.program_days.muscle_groups is
  'Muscle groups this day trains. Values mirror exercises.primary_muscles.';
