-- Coach documents: operations (2026-11-20)
--
-- Builds on 20261118100000 (application review) and 20261119100000 (no
-- identity documents). Forward only; nothing here rewrites either.
--
--   1. A revision of a live profile cannot add a discipline that requires a
--      qualification without the evidence: admin_decide_coach_revision()
--      approving would otherwise publish it unchecked. The approval is
--      refused (APPLICATION_INCOMPLETE) and nothing of it is applied.
--   2. Notices that were missing: every admin is told (in-app) that an
--      application is waiting; the coach is told (in-app + email) when one
--      of their qualification documents is not accepted; a revocation
--      (profile_unpublished) is now emailed as well. No document detail in
--      any of them — the payload is the profile id.
--   3. Operator functions for the document cleanup script
--      (scripts/coach-documents.mjs), service role only:
--        coach_document_purge_candidates(mode, retention_days) — the rows a
--          mode may remove: `identity` (every identity document, which Voinic
--          no longer keeps) or `retention` (qualification / other evidence
--          that is no longer needed: a document not accepted, or every
--          document of an application rejected or revoked, untouched for
--          at least `retention_days`, never less than 30);
--        coach_document_purge(id, storage id, mode, days) — deletes one row,
--          only if it is still a candidate under the same rule and still
--          names the same file, and audits it (the mode, never the file);
--        coach_document_storage_ids() — every stored file name, so the
--          script can tell an abandoned upload (a file with no row) from
--          evidence on record.
--      The script deletes the file first and the row after, so a failure
--      leaves the row in place for the next run.

-- ============================================================================
-- 1. revision approval needs the evidence its disciplines require
-- ============================================================================

/** admin_decide_coach_revision (20261108100000 + the notice of 20261112100000), plus the evidence check. */
create or replace function public.admin_decide_coach_revision(p_profile uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_missing text[];
begin
  perform public.admin_decide_coach_revision_base(p_profile, p_approve, p_note);
  -- the base has applied the copy (asserting admin first); a discipline that needs a qualification
  -- must have one on file, or the whole approval is undone
  if coalesce(p_approve, false) then
    v_missing := public.coach_application_missing(p_profile);
    if cardinality(v_missing) > 0 then
      raise exception 'APPLICATION_INCOMPLETE: %', array_to_string(v_missing, ',') using errcode = '22023';
    end if;
  end if;
  perform public.marketplace_notify((select user_id from public.coach_profiles where id = p_profile),
    case when coalesce(p_approve, false) then 'revision_approved' else 'revision_returned' end,
    jsonb_build_object('coach_profile_id', p_profile));
end;
$$;
revoke execute on function public.admin_decide_coach_revision(uuid, boolean, text) from public, anon;
grant execute on function public.admin_decide_coach_revision(uuid, boolean, text) to authenticated;

-- A qualification can name a discipline the coach is adding in an open revision.
create or replace function public.coach_add_verification_document(
  p_kind text, p_public_id text, p_format text, p_bytes int, p_label text default null, p_specialization text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_cp public.coach_profiles;
  v_spec uuid;
  v_id uuid;
begin
  select * into v_cp from public.coach_profiles where user_id = auth.uid() for update;
  if not found then
    raise exception 'NO_COACH_PROFILE' using errcode = 'P0002';
  end if;
  -- Voinic does not collect identity documents (20261119100000)
  if p_kind = 'identity' then
    raise exception 'IDENTITY_DOCUMENTS_NOT_ACCEPTED' using errcode = '22023';
  end if;
  -- not while an admin is reviewing what is on file, not while suspended
  if v_cp.status not in ('draft', 'published', 'hidden') then
    raise exception 'DOCUMENTS_LOCKED' using errcode = '55000';
  end if;
  if p_kind not in ('qualification', 'other')
     or lower(coalesce(p_format, '')) not in ('pdf', 'jpg', 'jpeg', 'png', 'webp', 'heic')
     or p_bytes is null or p_bytes < 1 or p_bytes > 10485760 then
    raise exception 'BAD_DOCUMENT' using errcode = '22023';
  end if;
  if coalesce(p_public_id, '') !~ ('^voinic/coach-docs/' || auth.uid()::text || '/[A-Za-z0-9_-]{8,64}$') then
    raise exception 'BAD_DOCUMENT_PATH' using errcode = '22023';
  end if;
  if p_specialization is not null and p_kind = 'qualification' then
    -- one of the coach's own disciplines, live or in their open revision (20261120100000): a live coach
    -- adding a discipline that needs evidence must be able to provide it before the change is approved
    select s.id into v_spec from public.specializations s
     where s.slug = p_specialization
       and (exists (select 1 from public.coach_specializations cs where cs.coach_profile_id = v_cp.id and cs.specialization_id = s.id)
            or exists (select 1 from public.coach_profile_revisions r
                        cross join lateral jsonb_array_elements(coalesce(r.payload -> 'specializations', '[]'::jsonb)) e
                        where r.coach_profile_id = v_cp.id and e ->> 'slug' = s.slug));
    if v_spec is null then
      raise exception 'UNKNOWN_SPECIALIZATION' using errcode = '22023';
    end if;
  end if;
  if (select count(*) from public.coach_verification_documents where coach_profile_id = v_cp.id) >= 12 then
    raise exception 'TOO_MANY_DOCUMENTS' using errcode = '22023';
  end if;
  insert into public.coach_verification_documents (coach_profile_id, kind, specialization_id, label, storage_public_id, format, bytes)
  values (v_cp.id, p_kind, v_spec, nullif(left(btrim(coalesce(p_label, '')), 120), ''), p_public_id, lower(p_format), p_bytes)
  returning id into v_id;
  return v_id;
end;
$$;
-- ============================================================================
-- 2. notices
-- ============================================================================

create or replace function public.marketplace_notify(p_recipient uuid, p_event text, p_payload jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_recipient is null or not exists (select 1 from public.users u where u.id = p_recipient) then
    return;
  end if;
  insert into public.notifications (user_id, category, title, body, payload)
  values (p_recipient, 'marketplace',
          case p_event
            when 'verification_verified' then 'You are Voinic Verified'
            when 'verification_rejected' then 'Verification not approved'
            when 'profile_published' then 'Your coach profile is live'
            when 'profile_returned' then 'Your coach profile needs changes'
            when 'profile_unpublished' then 'Your coach profile was unpublished'
            when 'profile_suspended' then 'Your coach profile was suspended'
            when 'profile_restored' then 'Your coach profile was restored'
            when 'application_submitted' then 'Coach application received'
            when 'application_changes_requested' then 'Your coach application needs more information'
            when 'application_rejected' then 'Your coach application was not approved'
            when 'document_not_accepted' then 'A qualification document was not accepted'
            when 'admin_application_submitted' then 'New coach application to review'
            when 'review_hidden' then 'A review was hidden'
            when 'revision_approved' then 'Your profile changes are live'
            when 'revision_returned' then 'Your profile changes need another look'
            else 'Coach profile update' end,
          case p_event
            when 'verification_verified' then 'Your profile now shows the Voinic Verified badge.'
            when 'verification_rejected' then 'See the note on your coach profile page.'
            when 'profile_published' then 'Your profile can now be found in the coach directory.'
            when 'profile_returned' then 'See the note on your coach profile page.'
            when 'profile_unpublished' then 'It is no longer listed. See the note on your coach profile page.'
            when 'profile_suspended' then 'It is no longer listed. Your clients, bookings and messages are unchanged.'
            when 'profile_restored' then 'Your coach profile was restored.'
            when 'application_submitted' then 'The Voinic team will review your profile and documents. The decision will show on your coach profile page.'
            when 'application_changes_requested' then 'See the note on your coach profile page.'
            when 'application_rejected' then 'See the note on your coach profile page.'
            when 'document_not_accepted' then 'See the note next to the document on your coach profile page.'
            when 'admin_application_submitted' then 'A coach submitted a profile for review.'
            when 'review_hidden' then 'A review on your profile was hidden after moderation.'
            when 'revision_approved' then 'Your public page now shows the changes you submitted.'
            when 'revision_returned' then 'Your public page is unchanged. See the note on your coach profile page.'
            else '' end,
          jsonb_build_object('event', p_event,
                             'screen', case when p_event = 'review_hidden' then 'coach_reviews'
                                             when p_event = 'admin_application_submitted' then 'admin_coach_applications'
                                             else 'coach_profile_settings' end)
            || coalesce(p_payload, '{}'::jsonb));
end;
$$;
create or replace function public.email_rule_delay_minutes(p_category text, p_event text)
returns int language sql immutable set search_path = public as $$
  select r.delay from (values
    ('coaching_request', 'sent', 0), ('coaching_request', 'accepted', 0), ('coaching_request', 'declined', 0),
    ('coaching_request', 'started', 0),
    ('booking', 'booked', 0), ('booking', 'requested', 0), ('booking', 'confirmed', 0), ('booking', 'declined', 0),
    ('booking', 'cancelled', 0), ('booking', 'reminder', 0),
    ('new_message', '*', 15),
    ('review', 'published', 0), ('review', 'response', 0),
    ('marketplace', 'profile_published', 0), ('marketplace', 'profile_returned', 0),
    ('marketplace', 'revision_approved', 0), ('marketplace', 'revision_returned', 0),
    ('marketplace', 'application_submitted', 0), ('marketplace', 'application_changes_requested', 0),
    ('marketplace', 'application_rejected', 0),
    ('marketplace', 'profile_unpublished', 0), ('marketplace', 'document_not_accepted', 0)
  ) r(category, event, delay)
  where r.category = p_category and (r.event = coalesce(p_event, '*') or r.event = '*')
  limit 1;
$$;
-- Every live admin hears of a submission (in-app only; the queue is where it is decided).
create or replace function public.coach_application_notify_admins()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.decision = 'submitted' then
    perform public.marketplace_notify(u.id, 'admin_application_submitted', jsonb_build_object('coach_profile_id', new.coach_profile_id))
       from public.users u
      where u.role = 'admin' and u.suspended_at is null;
  end if;
  return new;
end;
$$;
revoke execute on function public.coach_application_notify_admins() from public, anon, authenticated;
create trigger coach_application_decisions_notify_admins after insert on public.coach_application_decisions
  for each row execute function public.coach_application_notify_admins();

-- The coach hears that a qualification document was not accepted (the note is on their page).
create or replace function public.coach_document_notify_not_accepted()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'rejected' and old.status is distinct from 'rejected' and new.kind <> 'identity' then
    perform public.marketplace_notify((select cp.user_id from public.coach_profiles cp where cp.id = new.coach_profile_id),
      'document_not_accepted', jsonb_build_object('coach_profile_id', new.coach_profile_id));
  end if;
  return new;
end;
$$;
revoke execute on function public.coach_document_notify_not_accepted() from public, anon, authenticated;
create trigger coach_verification_documents_notify_not_accepted after update of status on public.coach_verification_documents
  for each row execute function public.coach_document_notify_not_accepted();

-- ============================================================================
-- 3. the cleanup script's functions (service role only)
-- ============================================================================

create or replace function public.coach_document_purge_candidates(p_mode text, p_retention_days int default null)
returns table (document_id uuid, coach_user_id uuid, storage_public_id text, reason text)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_mode = 'identity' then
    -- only rows explicitly classified as identity documents
    return query
      select d.id, cp.user_id, d.storage_public_id, 'identity_document'::text
        from public.coach_verification_documents d join public.coach_profiles cp on cp.id = d.coach_profile_id
       where d.kind = 'identity'
       order by d.created_at, d.id;
  elsif p_mode = 'retention' then
    if p_retention_days is null or p_retention_days < 30 then
      raise exception 'RETENTION_DAYS_TOO_SHORT' using errcode = '22023';
    end if;
    -- evidence nobody needs any more; never while an application is in review or the profile is suspended,
    -- never what a live profile was approved on
    return query
      select d.id, cp.user_id, d.storage_public_id,
             case when d.status = 'rejected' then 'not_accepted' else 'application_closed' end
        from public.coach_verification_documents d join public.coach_profiles cp on cp.id = d.coach_profile_id
       where d.kind <> 'identity'
         and (
              -- a document that was not accepted, long enough ago, on a profile no admin is looking at
              (d.status = 'rejected' and d.reviewed_at < now() - make_interval(days => p_retention_days)
               and cp.status in ('draft', 'published', 'hidden'))
              -- an application rejected or revoked and left that way
           or (cp.status = 'draft' and cp.review_decision in ('rejected', 'revoked')
               and cp.reviewed_at < now() - make_interval(days => p_retention_days)
               and d.created_at < now() - make_interval(days => p_retention_days))
         )
       order by d.created_at, d.id;
  else
    raise exception 'BAD_MODE' using errcode = '22023';
  end if;
end;
$$;
revoke execute on function public.coach_document_purge_candidates(text, int) from public, anon, authenticated;
grant execute on function public.coach_document_purge_candidates(text, int) to service_role;

-- One row, after its file is gone. False (nothing deleted) when the row is no longer a candidate under the
-- same rule or no longer names the same file: the state changed since the plan was made.
create or replace function public.coach_document_purge(
  p_document uuid, p_storage_public_id text, p_mode text, p_retention_days int default null
) returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_user uuid;
begin
  select c.coach_user_id into v_user
    from public.coach_document_purge_candidates(p_mode, p_retention_days) c
   where c.document_id = p_document and c.storage_public_id = p_storage_public_id;
  if not found then
    return false;
  end if;
  delete from public.coach_verification_documents where id = p_document;
  -- the rule that removed it, never the file
  perform public.audit_log('ADMIN_ACTION', 'coach_verification_document', p_document::text, v_user,
    jsonb_build_object('op', 'document_purge', 'mode', p_mode));
  return true;
end;
$$;
revoke execute on function public.coach_document_purge(uuid, text, text, int) from public, anon, authenticated;
grant execute on function public.coach_document_purge(uuid, text, text, int) to service_role;

-- Every file name on record, for telling an abandoned upload from evidence.
create or replace function public.coach_document_storage_ids()
returns setof text language sql stable security definer set search_path = public as $$
  select storage_public_id from public.coach_verification_documents;
$$;
revoke execute on function public.coach_document_storage_ids() from public, anon, authenticated;
grant execute on function public.coach_document_storage_ids() to service_role;
