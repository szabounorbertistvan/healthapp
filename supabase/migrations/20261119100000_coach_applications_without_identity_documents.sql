-- Coach applications without identity documents (2026-11-19)
--
-- Product decision: Voinic does not collect or store identity documents. This
-- forward migration changes the application review of 20261118100000 so that
-- it works whether or not that migration has already been applied somewhere:
-- nothing here rewrites it, every change is a redefinition or an addition.
--
-- What stays exactly as it was:
--   * no coach is public until an admin approves the application
--     (admin_decide_coach_application is still the one approval path, admin
--     only, audited, with a recorded decision);
--   * professional qualifications are still evidenced by private documents
--     (Cloudinary `authenticated` assets, owner-or-admin rows, no write grant);
--   * the coach still cannot write status, review_decision, reviewed_by,
--     published_at or suspended_from, nor insert a decision.
--
-- What changes:
--   1. An application no longer needs an identity document. It needs a
--      qualification document for each declared discipline whose evidence is
--      `required` — or whose parent discipline's is (a Vinyasa coach is a yoga
--      coach) — tagged with that discipline or its parent. An untagged
--      qualification no longer satisfies a required discipline.
--   2. No new identity document can be added (IDENTITY_DOCUMENTS_NOT_ACCEPTED,
--      in the function and as a NOT VALID check for any future row). Existing
--      ones, if any, are not deleted by this migration: they stay readable to
--      their owner and admins only, the coach can remove them at any time
--      (whatever the application status), an admin can no longer accept them,
--      approval no longer accepts them, and the NOTICE below counts them so
--      they can be purged deliberately (files from Cloudinary first, then rows).
--   3. The admin checklist is "profile reviewed" + "qualifications reviewed".
--      `coach_application_decisions.profile_reviewed` is new; the old
--      `identity_reviewed` column stays, untouched, for the history it holds,
--      and is false on every new decision.
--   4. Approval no longer records an identity verification. Voinic has no
--      documented identity-verification procedure, so no new `identity`
--      verification can be recorded (admin_set_coach_verification refuses it)
--      and the public page no longer shows an "identity verified" badge, even
--      for rows recorded before. Those rows are kept (history), not shown.
--      Qualification verification is separate and unchanged.
--
-- Decisions already recorded, statuses, review notes and public visibility are
-- not touched: no coach appears or disappears because of this migration.

-- ============================================================================
-- 1. schema: no new identity document; the new checklist column
-- ============================================================================

-- NOT VALID: enforced for every new or updated row, without failing on (or
-- touching) a row that already exists.
alter table public.coach_verification_documents
  add constraint coach_verification_documents_no_identity check (kind <> 'identity') not valid;

alter table public.coach_application_decisions
  add column profile_reviewed boolean not null default false;
comment on column public.coach_application_decisions.identity_reviewed is
  'Historical (20261118100000): the identity-document checkbox. Always false since 20261119100000; Voinic no longer reviews identity documents.';
comment on column public.coach_application_decisions.profile_reviewed is
  'The admin confirmed the public profile was reviewed for accuracy and appropriateness (20261119100000).';

-- ============================================================================
-- 2. what an application needs: qualifications, per declared discipline
-- ============================================================================

-- The declared disciplines that need a qualification document and have none
-- on file (not rejected, tagged with the discipline or its parent).
create or replace function public.coach_application_missing_disciplines(p_profile uuid)
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(s.slug order by s.sort_order, s.slug), '{}')
  from public.coach_specializations cs
  join public.specializations s on s.id = cs.specialization_id
  left join public.specializations p on p.id = s.parent_id
  where cs.coach_profile_id = p_profile
    and (s.qualification_evidence = 'required' or p.qualification_evidence = 'required')
    and not exists (
      select 1 from public.coach_verification_documents d
      where d.coach_profile_id = p_profile and d.kind = 'qualification' and d.status <> 'rejected'
        and d.specialization_id in (s.id, s.parent_id));
$$;
revoke execute on function public.coach_application_missing_disciplines(uuid) from public, anon, authenticated;

create or replace function public.coach_application_missing(p_profile uuid)
returns text[] language sql stable security definer set search_path = public as $$
  select case when cardinality(public.coach_application_missing_disciplines(p_profile)) > 0
              then array['QUALIFICATION_DOCUMENT'] else '{}'::text[] end;
$$;
revoke execute on function public.coach_application_missing(uuid) from public, anon, authenticated;

-- ============================================================================
-- 3. documents: qualifications and other evidence only
-- ============================================================================

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
    select s.id into v_spec from public.coach_specializations cs join public.specializations s on s.id = cs.specialization_id
     where cs.coach_profile_id = v_cp.id and s.slug = p_specialization;
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
revoke execute on function public.coach_add_verification_document(text, text, text, int, text, text) from public, anon;
grant execute on function public.coach_add_verification_document(text, text, text, int, text, text) to authenticated;

-- Returns the public_id so the server can destroy the asset too.
create or replace function public.coach_remove_verification_document(p_document uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_public text;
  v_status text;
  v_doc_status text;
  v_kind text;
begin
  select d.storage_public_id, cp.status, d.status, d.kind into v_public, v_status, v_doc_status, v_kind
    from public.coach_verification_documents d join public.coach_profiles cp on cp.id = d.coach_profile_id
   where d.id = p_document and cp.user_id = auth.uid();
  if v_public is null then
    raise exception 'DOCUMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  -- an identity document is no longer part of any review: its owner may delete it whenever they like
  if v_kind <> 'identity' then
    -- the evidence a live profile was approved on stays until the profile is a draft again
    -- (or the account is deleted, which purges the folder)
    if v_status not in ('draft', 'published', 'hidden') or (v_status <> 'draft' and v_doc_status = 'accepted') then
      raise exception 'DOCUMENTS_LOCKED' using errcode = '55000';
    end if;
  end if;
  delete from public.coach_verification_documents where id = p_document;
  return v_public;
end;
$$;
revoke execute on function public.coach_remove_verification_document(uuid) from public, anon;
grant execute on function public.coach_remove_verification_document(uuid) to authenticated;

create or replace function public.admin_set_verification_document_status(p_document uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 1000);
  v_profile uuid;
  v_user uuid;
  v_kind text;
begin
  perform public.admin_assert();
  if p_status not in ('submitted', 'accepted', 'rejected') then
    raise exception 'BAD_TRANSITION' using errcode = '22023';
  end if;
  if p_status = 'rejected' and v_note is null then
    raise exception 'REASON_REQUIRED' using errcode = '22023';
  end if;
  select kind into v_kind from public.coach_verification_documents where id = p_document;
  if v_kind is null then
    raise exception 'DOCUMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  -- an identity document left from before 20261119100000 is not reviewed, only removed
  if v_kind = 'identity' then
    raise exception 'IDENTITY_DOCUMENTS_NOT_ACCEPTED' using errcode = '22023';
  end if;
  update public.coach_verification_documents d
     set status = p_status, review_note = case when p_status = 'submitted' then null else v_note end,
         reviewed_at = case when p_status = 'submitted' then null else now() end,
         reviewed_by = case when p_status = 'submitted' then null else auth.uid() end
   where d.id = p_document
  returning d.coach_profile_id into v_profile;
  select user_id into v_user from public.coach_profiles where id = v_profile;
  -- the kind and the decision, never a file name or the document's content
  perform public.audit_log('ADMIN_ACTION', 'coach_verification_document', p_document::text, v_user,
    jsonb_build_object('op', 'verification_document', 'status', p_status));
end;
$$;
revoke execute on function public.admin_set_verification_document_status(uuid, text, text) from public, anon;
grant execute on function public.admin_set_verification_document_status(uuid, text, text) to authenticated;

-- ============================================================================
-- 4. the decision: profile reviewed + qualifications reviewed, no identity claim
-- ============================================================================

-- The fourth argument changes meaning (identity reviewed -> profile reviewed),
-- so it changes name too, which `create or replace` cannot do.
drop function public.admin_decide_coach_application(uuid, text, text, boolean, boolean);

create function public.admin_decide_coach_application(
  p_profile uuid, p_decision text, p_note text default null,
  p_profile_reviewed boolean default false, p_qualifications_reviewed boolean default false
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_cp public.coach_profiles;
  v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 1000);
  v_missing text[];
  v_to text;
begin
  perform public.admin_assert();
  select * into v_cp from public.coach_profiles where id = p_profile for update;
  if not found then
    raise exception 'NO_COACH_PROFILE' using errcode = 'P0002';
  end if;

  if p_decision = 'approved' then
    -- a live profile can be re-reviewed (a legacy approval getting its evidence) without going offline
    if v_cp.status not in ('pending_review', 'published', 'hidden') then
      raise exception 'BAD_TRANSITION' using errcode = '22023';
    end if;
    if not (coalesce(p_profile_reviewed, false) and coalesce(p_qualifications_reviewed, false)) then
      raise exception 'REVIEW_CHECKLIST_INCOMPLETE' using errcode = '22023';
    end if;
    v_missing := public.coach_application_missing(p_profile);
    if cardinality(v_missing) > 0 then
      raise exception 'APPLICATION_INCOMPLETE: %', array_to_string(v_missing, ',') using errcode = '22023';
    end if;
    v_to := case when v_cp.status = 'pending_review' then 'published' else v_cp.status end;
    update public.coach_profiles set
      status = v_to, reviewed_at = now(), reviewed_by = auth.uid(),
      published_at = case when v_to = 'published' then coalesce(published_at, now()) else published_at end,
      review_note = null, review_decision = null
    where id = p_profile;
    -- the qualification evidence on file is what was reviewed (an identity document never is)
    update public.coach_verification_documents
       set status = 'accepted', reviewed_at = now(), reviewed_by = auth.uid()
     where coach_profile_id = p_profile and status = 'submitted' and kind <> 'identity';
    -- qualification verification, recorded only when a qualification was actually accepted;
    -- shown publicly only under the separate Voinic Verified decision. No identity claim.
    if exists (select 1 from public.coach_verification_documents
               where coach_profile_id = p_profile and kind = 'qualification' and status = 'accepted') then
      insert into public.coach_verifications (coach_profile_id, kind, status, verified_at, verified_by)
      values (p_profile, 'certification', 'verified', now(), auth.uid())
      on conflict (coach_profile_id, kind) do update set status = 'verified', verified_at = now(), verified_by = auth.uid();
    end if;
    if v_cp.status = 'pending_review' then
      perform public.marketplace_notify(v_cp.user_id, 'profile_published', jsonb_build_object('coach_profile_id', p_profile));
    end if;

  elsif p_decision in ('changes_requested', 'rejected') then
    if v_cp.status <> 'pending_review' then
      raise exception 'BAD_TRANSITION' using errcode = '22023';
    end if;
    if v_note is null then
      raise exception 'REASON_REQUIRED' using errcode = '22023';
    end if;
    v_to := 'draft';
    update public.coach_profiles set
      status = 'draft', reviewed_at = now(), reviewed_by = auth.uid(), review_note = v_note, review_decision = p_decision
    where id = p_profile;
    perform public.social_reports_close_for('coach', p_profile, 'profile draft');
    perform public.marketplace_notify(v_cp.user_id,
      case p_decision when 'changes_requested' then 'application_changes_requested' else 'application_rejected' end,
      jsonb_build_object('coach_profile_id', p_profile));

  elsif p_decision = 'revoked' then
    if v_cp.status not in ('published', 'hidden') then
      raise exception 'BAD_TRANSITION' using errcode = '22023';
    end if;
    if v_note is null then
      raise exception 'REASON_REQUIRED' using errcode = '22023';
    end if;
    v_to := 'draft';
    update public.coach_profiles set
      status = 'draft', reviewed_at = now(), reviewed_by = auth.uid(), review_note = v_note, review_decision = 'revoked'
    where id = p_profile;
    perform public.social_reports_close_for('coach', p_profile, 'profile draft');
    perform public.marketplace_notify(v_cp.user_id, 'profile_unpublished', jsonb_build_object('coach_profile_id', p_profile));

  else
    raise exception 'BAD_DECISION' using errcode = '22023';
  end if;

  insert into public.coach_application_decisions
    (coach_profile_id, actor_id, decision, identity_reviewed, profile_reviewed, qualifications_reviewed, note)
  values (p_profile, auth.uid(), p_decision, false,
          p_decision = 'approved' and p_profile_reviewed, p_decision = 'approved' and p_qualifications_reviewed, v_note);
  perform public.audit_log('ADMIN_ACTION', 'coach_profile', p_profile::text, v_cp.user_id,
    jsonb_build_object('op', 'coach_application', 'decision', p_decision, 'from', v_cp.status, 'to', v_to,
                       'profile_reviewed', p_decision = 'approved' and p_profile_reviewed,
                       'qualifications_reviewed', p_decision = 'approved' and p_qualifications_reviewed, 'note', v_note));
end;
$$;
revoke execute on function public.admin_decide_coach_application(uuid, text, text, boolean, boolean) from public, anon;
grant execute on function public.admin_decide_coach_application(uuid, text, text, boolean, boolean) to authenticated;

-- ============================================================================
-- 5. reads: which disciplines still need evidence; the new checklist column
-- ============================================================================

create or replace function public.coach_my_application()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'status', cp.status,
    'review_decision', cp.review_decision,
    'review_note', cp.review_note,
    'submitted_at', cp.submitted_at,
    'reviewed_at', cp.reviewed_at,
    'missing', to_jsonb(public.coach_application_missing(cp.id)),
    'documents_editable', cp.status in ('draft', 'published', 'hidden'),
    -- the declared disciplines that need a qualification (their own rule or their parent's) …
    'required_specializations', coalesce((select jsonb_agg(jsonb_build_object('slug', s.slug, 'name_en', s.name_en, 'name_ro', s.name_ro) order by s.sort_order)
        from public.coach_specializations cs join public.specializations s on s.id = cs.specialization_id
        left join public.specializations p on p.id = s.parent_id
        where cs.coach_profile_id = cp.id and (s.qualification_evidence = 'required' or p.qualification_evidence = 'required')), '[]'::jsonb),
    -- … and the ones of those still without one
    'missing_specializations', to_jsonb(public.coach_application_missing_disciplines(cp.id)),
    'documents', coalesce((select jsonb_agg(jsonb_build_object(
        'id', d.id, 'kind', d.kind, 'label', d.label, 'specialization', s.slug, 'format', d.format, 'bytes', d.bytes,
        'status', d.status, 'review_note', d.review_note, 'created_at', d.created_at) order by d.created_at)
        from public.coach_verification_documents d left join public.specializations s on s.id = d.specialization_id
        where d.coach_profile_id = cp.id), '[]'::jsonb),
    -- the coach sees what was decided and why, not who decided it
    'history', coalesce((select jsonb_agg(jsonb_build_object('decision', h.decision, 'note', h.note, 'created_at', h.created_at) order by h.created_at desc)
        from public.coach_application_decisions h where h.coach_profile_id = cp.id), '[]'::jsonb)
  )
  from public.coach_profiles cp where cp.user_id = auth.uid();
$$;
revoke execute on function public.coach_my_application() from public, anon;
grant execute on function public.coach_my_application() to authenticated;

create or replace function public.admin_coach_application(p_profile uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb;
begin
  perform public.admin_assert();
  select jsonb_build_object(
    'id', cp.id, 'status', cp.status, 'review_decision', cp.review_decision, 'review_note', cp.review_note,
    'submitted_at', cp.submitted_at, 'reviewed_at', cp.reviewed_at, 'published_at', cp.published_at,
    'missing', to_jsonb(public.coach_application_missing(cp.id)),
    'missing_specializations', to_jsonb(public.coach_application_missing_disciplines(cp.id)),
    'legacy', cp.published_at is not null and not exists (
        select 1 from public.coach_application_decisions h where h.coach_profile_id = cp.id and h.decision = 'approved'),
    'specializations', coalesce((select jsonb_agg(jsonb_build_object('slug', s.slug, 'name_en', s.name_en, 'name_ro', s.name_ro,
        'is_primary', cs.is_primary,
        -- the rule that applies: the discipline's own, or 'required' inherited from its parent
        'qualification_evidence', case when p.qualification_evidence = 'required' then 'required' else s.qualification_evidence end)
        order by cs.is_primary desc, s.sort_order)
        from public.coach_specializations cs join public.specializations s on s.id = cs.specialization_id
        left join public.specializations p on p.id = s.parent_id
        where cs.coach_profile_id = cp.id), '[]'::jsonb),
    'documents', coalesce((select jsonb_agg(jsonb_build_object(
        'id', d.id, 'kind', d.kind, 'label', d.label, 'specialization', s.slug, 'format', d.format, 'bytes', d.bytes,
        'status', d.status, 'review_note', d.review_note, 'created_at', d.created_at, 'reviewed_at', d.reviewed_at) order by d.created_at)
        from public.coach_verification_documents d left join public.specializations s on s.id = d.specialization_id
        where d.coach_profile_id = cp.id), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object('decision', h.decision, 'note', h.note, 'created_at', h.created_at,
        'identity_reviewed', h.identity_reviewed, 'profile_reviewed', h.profile_reviewed,
        'qualifications_reviewed', h.qualifications_reviewed,
        'actor', coalesce(au.username, au.full_name)) order by h.created_at desc)
        from public.coach_application_decisions h left join public.users au on au.id = h.actor_id
        where h.coach_profile_id = cp.id), '[]'::jsonb)
  ) into v
  from public.coach_profiles cp where cp.id = p_profile;
  return v;
end;
$$;
revoke execute on function public.admin_coach_application(uuid) from public, anon;
grant execute on function public.admin_coach_application(uuid) to authenticated;

-- ============================================================================
-- 6. no identity verification claim
-- ============================================================================

-- 20261020100000's admin RPC, unchanged except that it no longer records a new
-- identity verification: there is no documented procedure behind one. A
-- recorded one can still be withdrawn (pending / rejected / revoked).
create or replace function public.admin_set_coach_verification(
  p_profile uuid, p_kind text, p_status text, p_note text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_user uuid;
begin
  perform public.admin_assert();
  if p_kind not in ('identity', 'certification', 'business')
     or p_status not in ('pending', 'verified', 'rejected', 'revoked') then
    raise exception 'BAD_VERIFICATION' using errcode = '22023';
  end if;
  if p_kind = 'identity' and p_status = 'verified' then
    raise exception 'IDENTITY_VERIFICATION_NOT_OFFERED' using errcode = '22023';
  end if;
  select user_id into v_user from public.coach_profiles where id = p_profile;
  if v_user is null then
    raise exception 'NO_COACH_PROFILE' using errcode = 'P0002';
  end if;
  insert into public.coach_verifications (coach_profile_id, kind, status, admin_note, verified_at, verified_by)
  values (p_profile, p_kind, p_status, left(nullif(btrim(coalesce(p_note, '')), ''), 1000),
          case when p_status = 'verified' then now() end,
          case when p_status = 'verified' then auth.uid() end)
  on conflict (coach_profile_id, kind) do update set
    status = excluded.status,
    admin_note = coalesce(excluded.admin_note, coach_verifications.admin_note),
    verified_at = excluded.verified_at,
    verified_by = excluded.verified_by;
  perform public.audit_log('ADMIN_ACTION', 'coach_profile', p_profile::text, v_user,
    jsonb_build_object('op', 'coach_verification', 'kind', p_kind, 'status', p_status));
end;
$$;

-- The public page (20261111100000's layer over the base): the same document,
-- minus an "identity verified" badge. Rows recorded before stay in
-- coach_verifications (history, admin view); they are just not a public claim.
create or replace function public.coach_public_profile(p_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select (b - 'badges')
           || jsonb_build_object('badges', coalesce((select jsonb_agg(x) from jsonb_array_elements(b -> 'badges') x
                                                     where x <> to_jsonb('identity_verified'::text)), '[]'::jsonb))
           || public.coach_profile_content((b ->> 'id')::uuid)
           || jsonb_build_object('availability', public.coach_public_availability((b ->> 'id')::uuid))
  from (select public.coach_public_profile_base(p_slug) as b) x
  where x.b is not null;
$$;
revoke execute on function public.coach_public_profile(text) from public;
grant execute on function public.coach_public_profile(text) to anon, authenticated;

-- ============================================================================
-- 7. what is on file from before: counted, not changed
-- ============================================================================

do $$
declare
  v_docs int;
  v_verifications int;
  v_waiting int;
begin
  select count(*) into v_docs from public.coach_verification_documents where kind = 'identity';
  select count(*) into v_verifications from public.coach_verifications where kind = 'identity' and status = 'verified';
  select count(*) into v_waiting from public.coach_profiles cp
   where cp.status = 'pending_review' and cardinality(public.coach_application_missing(cp.id)) > 0;
  raise notice 'coach applications without identity documents: % identity document row(s) on file (not deleted; purge the Cloudinary files, then the rows, deliberately); % recorded identity verification(s) kept but no longer shown publicly; % pending application(s) still missing required qualification evidence',
    v_docs, v_verifications, v_waiting;
end;
$$;
