-- Messages: a photo or a voice note, and live delivery (2026-12-07)
--
-- 1. Attachments. A message may now carry one picture or one voice note
--    instead of (or beside) its text. The file is an AUTHENTICATED Cloudinary
--    asset in the sender's own folder of that conversation,
--      voinic/messages/<conversation_id>/<sender_id>/<random>
--    uploaded with a signature the server issues for exactly that path
--    (app/message-actions.ts) and checked against what Cloudinary stored before
--    the row is written. The browser never gets a Cloudinary URL: the picture
--    or the audio is streamed by /api/messages/<id>/attachment, which reads the
--    row with the caller's session — msg_select decides who may hear or see it.
--    body may now be null when an attachment is present; one of the two is
--    always there. Attachment columns are insert-only (update stays read_at).
--
-- 2. Realtime. public.messages joins the supabase_realtime publication, so a
--    thread open on screen hears new rows the moment they are written.
--    Realtime applies RLS (msg_select) to every change it delivers; nothing
--    becomes readable that was not before. Guarded: a database without the
--    publication (the offline test harness) skips it.

alter table public.messages alter column body drop not null;
alter table public.messages drop constraint if exists messages_body_check;

alter table public.messages
  add column attachment_kind text check (attachment_kind is null or attachment_kind in ('image', 'audio')),
  add column attachment_path text,
  add column attachment_bytes int check (attachment_bytes is null or attachment_bytes between 1 and 10485760),
  add column attachment_format text check (attachment_format is null or attachment_format ~ '^[a-z0-9]{2,8}$'),
  add column attachment_seconds numeric(6,1) check (attachment_seconds is null or attachment_seconds between 0 and 300),
  add column attachment_width int check (attachment_width is null or attachment_width between 1 and 10000),
  add column attachment_height int check (attachment_height is null or attachment_height between 1 and 10000);

alter table public.messages
  add constraint messages_body_length check (body is null or length(body) between 1 and 4000),
  add constraint messages_has_content check (body is not null or attachment_path is not null),
  add constraint messages_attachment_whole check ((attachment_path is null) = (attachment_kind is null));

create or replace function public.messages_attachment_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.body is not null then
    new.body := nullif(btrim(new.body), '');
  end if;
  if new.attachment_path is not null then
    if new.attachment_path !~ ('^voinic/messages/' || new.conversation_id::text || '/' || new.sender_id::text || '/[a-z0-9]{20,40}$') then
      raise exception 'ATTACHMENT_PATH' using errcode = '23514';
    end if;
    if exists (select 1 from public.messages m where m.attachment_path = new.attachment_path) then
      raise exception 'ATTACHMENT_REUSED' using errcode = '23505';
    end if;
    if new.attachment_kind = 'audio' and new.attachment_seconds is null then
      raise exception 'ATTACHMENT_DURATION' using errcode = '23514';
    end if;
  else
    new.attachment_kind := null; new.attachment_bytes := null; new.attachment_format := null;
    new.attachment_seconds := null; new.attachment_width := null; new.attachment_height := null;
  end if;
  return new;
end;
$$;
revoke execute on function public.messages_attachment_guard() from public, anon, authenticated;

drop trigger if exists messages_attachment_guard on public.messages;
create trigger messages_attachment_guard before insert on public.messages
  for each row execute function public.messages_attachment_guard();

create unique index if not exists messages_attachment_path_idx on public.messages (attachment_path)
  where attachment_path is not null;

-- ---------- 2. realtime ----------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
    execute 'alter publication supabase_realtime add table public.messages';
  end if;
end;
$$;
