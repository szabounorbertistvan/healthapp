-- Nobody could create a challenge (web or app): 0 user challenges live.
--
-- createChallenge inserts with `.select("id")`, i.e. INSERT … RETURNING, and
-- RETURNING checks the new row against challenges_select. That policy was
-- only `can_see_challenge(id)`, a stable security-definer function that
-- looks the challenge up by id — in a snapshot taken before the INSERT, so
-- the row being written is not there, the function answers false and the
-- whole insert fails with "new row violates row-level security policy".
--
-- The creator is now matched on the row itself, before the function is
-- called. can_see_challenge already let the creator see their challenge, so
-- nobody gains access they did not have.

drop policy if exists challenges_select on public.challenges;
create policy challenges_select on public.challenges for select to authenticated
  using (creator_id = auth.uid() or public.can_see_challenge(id));
