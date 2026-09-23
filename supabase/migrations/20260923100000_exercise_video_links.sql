-- Exercise video links: anyone can pin a YouTube demo to any exercise.
--
-- exercises.video_url only ever belonged to the row's owner, so the shared
-- library (owner_id null) could not carry a video at all. This table is the
-- per-person layer on top: one link per (person, exercise), for library rows
-- and customs alike. What an exercise shows is resolved in the app
-- (pickExerciseVideo in @healthapp/shared): your own link, else your active
-- coach's, else the exercise's own video_url.
--
-- Only the 11-char YouTube id is stored — never a URL — because the value ends
-- up in an <iframe src>; the check constraint holds that line in the database
-- too, not just in the server action.
--
-- exercise_videos (from 03) stays untouched: it is the storage-upload pipeline
-- the spec plans, keyed by storage_path, and nothing writes it yet.

create table public.exercise_video_links (
  user_id uuid not null references public.users (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id) on delete cascade,
  video_id text not null check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, exercise_id)
);
create trigger exercise_video_links_updated before update on public.exercise_video_links
  for each row execute function public.handle_updated_at();
create index exercise_video_links_exercise_idx on public.exercise_video_links (exercise_id);

comment on table public.exercise_video_links is
  'Per-person YouTube demo for an exercise. Visible to the owner and to the other side of an active coaching relationship.';

-- Read: your own, and those of whoever you are actively connected to — a
-- client sees the demos their coach picked, a coach sees what their client
-- pinned. Ending the relationship hides them, like every other coach read.
-- Write: your own rows only.
alter table public.exercise_video_links enable row level security;
create policy exercise_video_links_read on public.exercise_video_links for select to authenticated
  using (user_id = auth.uid() or public.is_connected_to(user_id));
create policy exercise_video_links_owner on public.exercise_video_links for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- See the note in 20260826075027: tables created by `postgres` get no ambient
-- grants, so without this every query fails with "permission denied".
grant select, insert, update, delete on table public.exercise_video_links to authenticated;
