-- HealthApp schema · invite codes without pgcrypto
--
-- create_invite() raised `function gen_random_bytes(integer) does not exist`
-- against the hosted project, so a coach could not invite anyone.
--
-- Why: `gen_random_bytes` comes from pgcrypto, and Supabase installs pgcrypto
-- into the `extensions` schema, not `public`. The `create extension if not
-- exists pgcrypto` in 20260823000100 therefore did nothing — the extension was
-- already there, just elsewhere — while the function is declared
-- `set search_path = public`, which is what makes it security-definer-safe and
-- also what puts `extensions` out of reach. Nothing else in the schema noticed:
-- `gen_random_uuid()` looks like it comes from the same place but has been core
-- Postgres since 13, and the only other pgcrypto callers (`crypt`/`gen_salt` in
-- supabase/seed/accounts.sql) run from the dashboard SQL editor, whose own
-- search_path does include `extensions`.
--
-- Fix: drop the pgcrypto dependency rather than widen the function's
-- search_path. The first 32 bits of a v4 UUID are pure CSPRNG output — the
-- version nibble sits at hex position 13 and the variant at 17 — so the first
-- eight hex characters carry exactly the entropy `gen_random_bytes(4)` gave us,
-- from a function that is always on the path. Code shape is unchanged: 8 upper
-- hex characters.
--
-- The body is otherwise verbatim from 20260826090000, which is the definition
-- currently live.

create or replace function public.create_invite()
returns table (invite_id uuid, code text, expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_code text := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  v_row public.trainer_clients;
  v_tier text := public.effective_tier(auth.uid());
  v_limit int;
  v_used int;
begin
  v_limit := case coalesce(v_tier, 'free') when 'coach_pro' then 30 else 3 end;

  select count(*) into v_used from public.trainer_clients
  where coach_id = auth.uid() and status in ('invited', 'active');
  if v_used >= v_limit then
    raise exception 'CLIENT_LIMIT_REACHED';
  end if;

  insert into public.trainer_clients (coach_id, status, invite_code, invite_expires_at)
  values (auth.uid(), 'invited', v_code, now() + interval '30 days')
  returning * into v_row;
  return query select v_row.id, v_row.invite_code, v_row.invite_expires_at;
end;
$$;

grant execute on function public.create_invite() to authenticated;
