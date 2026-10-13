-- Onboarding state: the welcome cards, the setup steps and the page tours (2026-11-23)
--
-- What a person has already seen of the app's guidance, so it follows them
-- from the phone to the laptop instead of starting over per device. Until now
-- the only onboarding memory was the `bg_onboarding` cookie (lib/onboarding.ts),
-- which still decides the coach-or-solo choice and is left alone.
--
-- One row per person, a flat jsonb map of key → mark:
--   welcome           the welcome cards            done | skipped
--   setup             the setup checklist as such  done | dismissed
--   step:<id>         one setup step               done | skipped
--   tour:<id>         one page's guided tour       done | dismissed
--   tips              automatic tours as a whole   dismissed
-- The app's model is lib/onboarding-model.ts; the same key pattern is checked
-- here, so a hand-made request cannot fill the row with anything else.
--
-- Its own table, not a users column: users rows are readable by the people
-- one is connected to (users_select → is_connected_to), and which tips someone
-- closed is nobody's business but theirs. Owner-only select; no write grant —
-- the one door is onboarding_mark(), which merges a single key atomically, so
-- two tabs closing two tours cannot overwrite each other.
--
-- Accounts that exist when this runs already know the app: they get
-- welcome = done and never see the welcome cards. Their setup checklist and
-- page tours stay available (once, dismissible), and so does the whole flow
-- from the "Getting started" link. New accounts start with no row.

create table public.onboarding_state (
  user_id uuid primary key references public.users (id) on delete cascade,
  state jsonb not null default '{}'::jsonb
    check (jsonb_typeof(state) = 'object' and pg_column_size(state) <= 4096),
  updated_at timestamptz not null default now()
);
comment on table public.onboarding_state is
  'Which welcome cards, setup steps and page tours a person has finished, skipped or closed. Owner-only; written through onboarding_mark().';

alter table public.onboarding_state enable row level security;

create policy onboarding_state_owner_read on public.onboarding_state for select to authenticated
  using (user_id = auth.uid());

revoke all on table public.onboarding_state from public, anon, authenticated;
grant select on table public.onboarding_state to authenticated;

-- existing accounts: past the welcome cards already
insert into public.onboarding_state (user_id, state)
select id, jsonb_build_object('welcome', 'done') from public.users
on conflict (user_id) do nothing;

-- Set one key (or clear it with 'reset') for the signed-in person; returns the whole map.
create or replace function public.onboarding_mark(p_key text, p_mark text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_state jsonb;
begin
  if v_user is null then
    raise exception 'NOT_SIGNED_IN' using errcode = '42501';
  end if;
  if p_key is null or p_key !~ '^(welcome|setup|tips|step:[a-z_]{1,32}|tour:[a-z_]{1,32})$' then
    raise exception 'ONBOARDING_KEY' using errcode = '22023';
  end if;
  if p_mark is null or p_mark not in ('done', 'skipped', 'dismissed', 'reset') then
    raise exception 'ONBOARDING_MARK' using errcode = '22023';
  end if;

  if p_mark = 'reset' then
    update public.onboarding_state
       set state = state - p_key, updated_at = now()
     where user_id = v_user
    returning state into v_state;
    return coalesce(v_state, '{}'::jsonb);
  end if;

  insert into public.onboarding_state as o (user_id, state)
  values (v_user, jsonb_build_object(p_key, p_mark))
  on conflict (user_id) do update
    set state = o.state || jsonb_build_object(p_key, p_mark), updated_at = now()
  returning o.state into v_state;
  return v_state;
end;
$$;

revoke all on function public.onboarding_mark(text, text) from public, anon;
grant execute on function public.onboarding_mark(text, text) to authenticated;
