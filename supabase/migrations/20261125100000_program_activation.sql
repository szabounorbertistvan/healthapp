-- Program activation: which program the next workout comes from (2026-11-25)
--
-- A person can hold several published programs — a solo client builds one per
-- block, a coach writes a new block for the same client — and Today, the
-- weekly adherence and the coach dashboard all follow exactly one of them
-- (packages/shared pickProgram). Until now that one was "the newest
-- updated_at", so renaming a day in last month's program silently made it the
-- plan again, and nothing let anyone say "this is the one I am on now".
--
-- `activated_at` is that statement. It is stamped by "Set as active" in the
-- builder and by publishing (a freshly published block is the one to follow,
-- which is what the old rule did by accident). pickProgram reads it first and
-- falls back to updated_at only on a side where nothing was ever activated —
-- every existing row is therefore read exactly as before: nothing is
-- backfilled, no row changes.
--
-- Who may stamp it is who may already update the program: the coach while
-- coaching (programs_coach_update), the solo owner while uncoached
-- (programs_solo_update). `programs` is written through column grants since
-- 20260930100000 (an owner must not set featured_at / is_official), so the
-- column gets an update grant of its own — update only: a program is born a
-- draft and stamped when it is published or activated, never at insert.
-- copy_program() lists its columns, so a duplicate starts unactivated: copying
-- a program never changes which one is followed.
--
-- Activation writes nothing else: no session, no set, no day is created, so it
-- cannot produce a duplicate workout, and logged history is never touched.

alter table public.programs
  add column if not exists activated_at timestamptz;

comment on column public.programs.activated_at is
  'When this program was last made the one to follow (Set as active, or publishing). Null = never; pickProgram then falls back to updated_at.';

grant update (activated_at) on table public.programs to authenticated;
