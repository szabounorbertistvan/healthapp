-- Exercise videos: the official list is the admin's, a custom exercise its owner's.
--
-- 20260923100000 let anyone pin a personal YouTube demo to any exercise
-- (exercise_video_links). That goes: a library row's demo is the one on the
-- row, set by an admin (exercises_admin_update, 20260916100000), and a
-- custom exercise's demo is set by its owner (exercises_owner_update). Both
-- write exercises.video_url, so everyone who sees an exercise sees the same
-- video.
--
-- No one inserts or updates a link any more. Delete stays open to each owner
-- so a link made before this migration can still be removed; reading stays as
-- it was so those links keep showing until they are.

drop policy exercise_video_links_owner on public.exercise_video_links;

create policy exercise_video_links_delete on public.exercise_video_links for delete to authenticated
  using (user_id = auth.uid());

revoke insert, update on table public.exercise_video_links from authenticated;
