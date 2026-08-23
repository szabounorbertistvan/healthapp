-- BuddyGym schema · 01 extensions, enums, shared triggers
create extension if not exists pgcrypto;

create type user_role as enum ('client', 'coach', 'both');
create type relationship_status as enum ('invited', 'active', 'ended');
create type publish_status as enum ('draft', 'published', 'archived');
create type intensity_mode as enum ('rpe', 'rir', 'simple');
create type simple_effort as enum ('easy', 'moderate', 'hard');
create type food_source as enum ('off', 'usda', 'custom');
create type meal_slot as enum ('breakfast', 'lunch', 'dinner', 'snack');
create type food_log_method as enum ('plan', 'search', 'barcode', 'recent', 'copy', 'custom');
create type feedback_reference as enum ('session', 'set', 'check_in', 'set_video');
create type adherence_signal as enum ('on_track', 'needs_attention', 'at_risk');
create type notification_category as enum (
  'workout_reminder', 'streak_at_risk', 'check_in_due', 'plan_updated',
  'new_message', 'new_feedback', 'achievement',
  'checkin_submitted', 'client_at_risk'
);

-- shared updated_at trigger
create or replace function public.handle_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
