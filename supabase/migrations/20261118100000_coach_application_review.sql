-- Coach applications: mandatory review with evidence (2026-11-17)
--
-- What already held before this migration, and still does: a coach is public
-- only while coach_profiles.status = 'published' (coach_public_visible(),
-- coach_ranked(), booking_eligibility(), coach_sitemap(), the facets, the gym
-- lists — every public door checks it), and only an admin can publish: the
-- coach's column grant has no `status`, the edit lock refuses content changes
-- outside draft, and the only writer of 'published' from 'pending_review' was
-- admin_set_coach_profile_status(), which asserts is_admin().
--
-- What this adds, on that same lifecycle (no new profile status):
--   1. an outcome on a profile sent back: review_decision = changes_requested
--      | rejected | revoked (status stays 'draft', the note is review_note);
--   2. coach_application_decisions — every submission and decision, with the
--      reviewer, the checklist and the note; admins read it, the coach reads
--      their own history (without reviewer ids) through coach_my_application();
--   3. coach_verification_documents — private evidence: Cloudinary
--      `authenticated` assets (the progress-photo convention, lib/cloudinary.ts),
--      only the public_id stored, never a URL; owner and admins read the rows,
--      nobody writes them except through the functions below; nothing public
--      references them;
--   4. specializations.qualification_evidence (required | recommended | none,
--      default recommended): which disciplines need a qualification document
--      to submit — configuration, not a legal claim; nothing is 'required' yet;
--   5. submission needs an identity document (and a qualification document
--      when a chosen discipline requires one); approval needs both checklist
--      boxes ticked by the admin and the same evidence on file;
--   6. admin_decide_coach_application() is the one way to approve, ask for
--      more information, reject or revoke; admin_set_coach_profile_status()
--      keeps suspend / restore only (a restore to public only for a profile that was public when suspended);
--   7. notifications for submitted / more information / rejected (approved and
--      revoked reuse profile_published / profile_unpublished), in-app and email,
--      saying nothing about the documents.
--
-- Existing coaches: nothing changes visibility. Every profile that has been
-- published gets one 'legacy_approved' history row (an admin did publish it,
-- under the old review, without documents) so the queue can list them for an
-- explicit re-review; a profile waiting in pending_review simply needs an
-- identity document before it can be approved (the admin asks for it).

-- ============================================================================
-- 1. columns
-- ============================================================================

alter table public.specializations
  add column qualification_evidence text not null default 'recommended'
    check (qualification_evidence in ('required', 'recommended', 'none'));

-- not in the coach's column grant (20261020100000): only the review functions write it
alter table public.coach_profiles
  add column review_decision text
    check (review_decision is null or review_decision in ('changes_requested', 'rejected', 'revoked'));

-- the status a profile had when an admin suspended it: a restore goes back to public only from a
-- public one (published_at alone survives a revocation). Not in the coach's column grant either.
alter table public.coach_profiles
  add column suspended_from text
    check (suspended_from is null or suspended_from in ('draft', 'pending_review', 'published', 'hidden'));
-- profiles already suspended keep what the old rule allowed them: public again only if once published
update public.coach_profiles set suspended_from = case when published_at is not null then 'published' else 'draft' end
 where status = 'suspended';

-- ============================================================================
-- 2. decisions and documents
-- ============================================================================

create table public.coach_application_decisions (
  id uuid primary key default gen_random_uuid(),
  coach_profile_id uuid not null references public.coach_profiles (id) on delete cascade,
  -- the coach for a submission, the admin for a decision, null for the legacy backfill
  actor_id uuid references public.users (id) on delete set null,
  decision text not null
    check (decision in ('submitted', 'approved', 'changes_requested', 'rejected', 'revoked', 'legacy_approved')),
  identity_reviewed boolean not null default false,
  qualifications_reviewed boolean not null default false,
  note text check (note is null or char_length(note) <= 1000),
  -- the moment of the statement, not of the transaction: two decisions in one transaction keep their order
  created_at timestamptz not null default clock_timestamp()
);
create index coach_application_decisions_profile_idx on public.coach_application_decisions (coach_profile_id, created_at desc);
alter table public.coach_application_decisions enable row level security;
create policy coach_application_decisions_admin on public.coach_application_decisions for select to authenticated
  using (public.is_admin());
revoke all on table public.coach_application_decisions from anon, authenticated;
grant select on table public.coach_application_decisions to authenticated;

create table public.coach_verification_documents (
  id uuid primary key default gen_random_uuid(),
  coach_profile_id uuid not null references public.coach_profiles (id) on delete cascade,
  kind text not null check (kind in ('identity', 'qualification', 'other')),
  -- a discipline-specific qualification names its discipline; identity never does
  specialization_id uuid references public.specializations (id) on delete set null,
  label text check (label is null or char_length(btrim(label)) between 1 and 120),
  -- a Cloudinary `authenticated` public_id under the owner's own folder; reachable only through a signed, expiring URL
  storage_public_id text not null unique
    check (storage_public_id ~ '^voinic/coach-docs/[0-9a-f-]{36}/[A-Za-z0-9_-]{8,64}$'),
  format text not null check (format in ('pdf', 'jpg', 'jpeg', 'png', 'webp', 'heic')),
  bytes int not null check (bytes between 1 and 10485760),
  status text not null default 'submitted' check (status in ('submitted', 'accepted', 'rejected')),
  review_note text check (review_note is null or char_length(review_note) <= 1000),
  reviewed_at timestamptz,
  reviewed_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (kind <> 'identity' or specialization_id is null)
);
create index coach_verification_documents_profile_idx on public.coach_verification_documents (coach_profile_id);
alter table public.coach_verification_documents enable row level security;
create policy coach_verification_documents_read on public.coach_verification_documents for select to authenticated
  using (public.coach_profile_owned(coach_profile_id) or public.is_admin());
revoke all on table public.coach_verification_documents from anon, authenticated;
grant select on table public.coach_verification_documents to authenticated;

-- ============================================================================
-- 3. what an application still needs
-- ============================================================================

create or replace function public.coach_application_missing(p_profile uuid)
returns text[] language sql stable security definer set search_path = public as $$
  select array_remove(array[
    case when not exists (select 1 from public.coach_verification_documents d
                          where d.coach_profile_id = p_profile and d.kind = 'identity' and d.status <> 'rejected')
         then 'IDENTITY_DOCUMENT' end,
    case when exists (select 1 from public.coach_specializations cs join public.specializations s on s.id = cs.specialization_id
                      where cs.coach_profile_id = p_profile and s.qualification_evidence = 'required')
          and not exists (select 1 from public.coach_verification_documents d
                          where d.coach_profile_id = p_profile and d.kind = 'qualification' and d.status <> 'rejected')
         then 'QUALIFICATION_DOCUMENT' end
  ], null);
$$;
revoke execute on function public.coach_application_missing(uuid) from public, anon, authenticated;

-- ============================================================================
-- 4. documents: the coach adds and removes their own, the admin judges them
-- ============================================================================

-- The server action has already read the asset back from Cloudinary (format and
-- size as stored, not as the browser claimed); this re-checks the same limits and
-- the path, so a direct call cannot register someone else's file or a bigger one.
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
  -- not while an admin is reviewing what is on file, not while suspended
  if v_cp.status not in ('draft', 'published', 'hidden') then
    raise exception 'DOCUMENTS_LOCKED' using errcode = '55000';
  end if;
  if p_kind not in ('identity', 'qualification', 'other')
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
begin
  select d.storage_public_id, cp.status, d.status into v_public, v_status, v_doc_status
    from public.coach_verification_documents d join public.coach_profiles cp on cp.id = d.coach_profile_id
   where d.id = p_document and cp.user_id = auth.uid();
  if v_public is null then
    raise exception 'DOCUMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  -- the evidence a live profile was approved on stays until the profile is a draft again
  -- (or the account is deleted, which purges the folder)
  if v_status not in ('draft', 'published', 'hidden') or (v_status <> 'draft' and v_doc_status = 'accepted') then
    raise exception 'DOCUMENTS_LOCKED' using errcode = '55000';
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
begin
  perform public.admin_assert();
  if p_status not in ('submitted', 'accepted', 'rejected') then
    raise exception 'BAD_TRANSITION' using errcode = '22023';
  end if;
  if p_status = 'rejected' and v_note is null then
    raise exception 'REASON_REQUIRED' using errcode = '22023';
  end if;
  update public.coach_verification_documents d
     set status = p_status, review_note = case when p_status = 'submitted' then null else v_note end,
         reviewed_at = case when p_status = 'submitted' then null else now() end,
         reviewed_by = case when p_status = 'submitted' then null else auth.uid() end
   where d.id = p_document
  returning d.coach_profile_id into v_profile;
  if v_profile is null then
    raise exception 'DOCUMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  select user_id into v_user from public.coach_profiles where id = v_profile;
  -- the kind and the decision, never a file name or the document's content
  perform public.audit_log('ADMIN_ACTION', 'coach_verification_document', p_document::text, v_user,
    jsonb_build_object('op', 'verification_document', 'status', p_status));
end;
$$;
revoke execute on function public.admin_set_verification_document_status(uuid, text, text) from public, anon;
grant execute on function public.admin_set_verification_document_status(uuid, text, text) to authenticated;

-- ============================================================================
-- 5. the decision: approve, ask for more, reject, revoke
-- ============================================================================

create or replace function public.admin_decide_coach_application(
  p_profile uuid, p_decision text, p_note text default null,
  p_identity_reviewed boolean default false, p_qualifications_reviewed boolean default false
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
    if not (coalesce(p_identity_reviewed, false) and coalesce(p_qualifications_reviewed, false)) then
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
    -- what was on file is what was reviewed
    update public.coach_verification_documents
       set status = 'accepted', reviewed_at = now(), reviewed_by = auth.uid()
     where coach_profile_id = p_profile and status = 'submitted';
    -- the per-kind checks the public page lists under Voinic Verified (only when that badge is given, separately)
    insert into public.coach_verifications (coach_profile_id, kind, status, verified_at, verified_by)
    values (p_profile, 'identity', 'verified', now(), auth.uid())
    on conflict (coach_profile_id, kind) do update set status = 'verified', verified_at = now(), verified_by = auth.uid();
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

  insert into public.coach_application_decisions (coach_profile_id, actor_id, decision, identity_reviewed, qualifications_reviewed, note)
  values (p_profile, auth.uid(), p_decision,
          p_decision = 'approved' and p_identity_reviewed, p_decision = 'approved' and p_qualifications_reviewed, v_note);
  perform public.audit_log('ADMIN_ACTION', 'coach_profile', p_profile::text, v_cp.user_id,
    jsonb_build_object('op', 'coach_application', 'decision', p_decision, 'from', v_cp.status, 'to', v_to,
                       'identity_reviewed', p_decision = 'approved' and p_identity_reviewed,
                       'qualifications_reviewed', p_decision = 'approved' and p_qualifications_reviewed, 'note', v_note));
end;
$$;
revoke execute on function public.admin_decide_coach_application(uuid, text, text, boolean, boolean) from public, anon;
grant execute on function public.admin_decide_coach_application(uuid, text, text, boolean, boolean) to authenticated;

-- ============================================================================
-- 6. reads: the coach's own application, the admin's queue and detail
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
    'required_specializations', coalesce((select jsonb_agg(jsonb_build_object('slug', s.slug, 'name_en', s.name_en, 'name_ro', s.name_ro) order by s.sort_order)
        from public.coach_specializations cs join public.specializations s on s.id = cs.specialization_id
        where cs.coach_profile_id = cp.id and s.qualification_evidence = 'required'), '[]'::jsonb),
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
    'legacy', cp.published_at is not null and not exists (
        select 1 from public.coach_application_decisions h where h.coach_profile_id = cp.id and h.decision = 'approved'),
    'specializations', coalesce((select jsonb_agg(jsonb_build_object('slug', s.slug, 'name_en', s.name_en, 'name_ro', s.name_ro,
        'is_primary', cs.is_primary, 'qualification_evidence', s.qualification_evidence) order by cs.is_primary desc, s.sort_order)
        from public.coach_specializations cs join public.specializations s on s.id = cs.specialization_id
        where cs.coach_profile_id = cp.id), '[]'::jsonb),
    'documents', coalesce((select jsonb_agg(jsonb_build_object(
        'id', d.id, 'kind', d.kind, 'label', d.label, 'specialization', s.slug, 'format', d.format, 'bytes', d.bytes,
        'status', d.status, 'review_note', d.review_note, 'created_at', d.created_at, 'reviewed_at', d.reviewed_at) order by d.created_at)
        from public.coach_verification_documents d left join public.specializations s on s.id = d.specialization_id
        where d.coach_profile_id = cp.id), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object('decision', h.decision, 'note', h.note, 'created_at', h.created_at,
        'identity_reviewed', h.identity_reviewed, 'qualifications_reviewed', h.qualifications_reviewed,
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

-- The verification queue: pending (oldest first) | more_info | rejected | approved | legacy | all,
-- optionally submitted on or after a date.
create or replace function public.admin_coach_applications(
  p_state text default 'pending', p_since date default null, p_limit int default 50, p_offset int default 0
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb;
begin
  perform public.admin_assert();
  with rows as (
    select cp.id, cp.slug, cp.status, cp.review_decision, cp.submitted_at, cp.reviewed_at,
           coalesce(nullif(btrim(u.full_name), ''), u.username) as name, u.username,
           cp.published_at is not null and not exists (
             select 1 from public.coach_application_decisions h where h.coach_profile_id = cp.id and h.decision = 'approved') as legacy
    from public.coach_profiles cp join public.users u on u.id = cp.user_id
  ), picked as (
    select * from rows r
    where (case coalesce(p_state, 'pending')
             when 'pending' then r.status = 'pending_review'
             when 'more_info' then r.status = 'draft' and r.review_decision = 'changes_requested'
             when 'rejected' then r.status = 'draft' and r.review_decision in ('rejected', 'revoked')
             when 'approved' then r.status in ('published', 'hidden')
             when 'legacy' then r.legacy and r.status in ('published', 'hidden', 'suspended')
             else true end)
      and (p_since is null or r.submitted_at >= p_since)
  )
  select jsonb_build_object(
    'total', (select count(*) from picked),
    'items', coalesce((select jsonb_agg(to_jsonb(x) - 'ord_a' - 'ord_b' order by x.ord_a nulls last, x.ord_b desc nulls last) from (
        select p.id, p.slug, p.status, p.review_decision, p.submitted_at, p.reviewed_at, p.name, p.username, p.legacy,
               (select count(*) from public.coach_verification_documents d where d.coach_profile_id = p.id and d.kind = 'identity') as identity_documents,
               (select count(*) from public.coach_verification_documents d where d.coach_profile_id = p.id and d.kind = 'qualification') as qualification_documents,
               coalesce((select jsonb_agg(s.name_en order by cs.is_primary desc, s.sort_order) from public.coach_specializations cs
                         join public.specializations s on s.id = cs.specialization_id where cs.coach_profile_id = p.id), '[]'::jsonb) as specializations,
               case when coalesce(p_state, 'pending') = 'pending' then p.submitted_at end as ord_a,
               coalesce(p.reviewed_at, p.submitted_at) as ord_b
        from picked p
        order by case when coalesce(p_state, 'pending') = 'pending' then p.submitted_at end nulls last,
                 coalesce(p.reviewed_at, p.submitted_at) desc nulls last
        limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)) x), '[]'::jsonb)
  ) into v;
  return v;
end;
$$;
revoke execute on function public.admin_coach_applications(text, date, int, int) from public, anon;
grant execute on function public.admin_coach_applications(text, date, int, int) to authenticated;

-- ============================================================================
-- 7. the redefined lifecycle functions (marked lines only, see the generator note)
-- ============================================================================

create or replace function public.submit_coach_for_review()
returns text[] language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_status text;
  v_missing text[];
begin
  select id, status into v_id, v_status from public.coach_profiles
  where user_id = auth.uid() for update;
  if v_id is null then
    raise exception 'NO_COACH_PROFILE' using errcode = 'P0002';
  end if;
  if v_status <> 'draft' then
    raise exception 'NOT_DRAFT' using errcode = '55000';
  end if;
  -- the profile's own essentials, then the evidence an application needs (20261118100000)
  v_missing := public.coach_profile_missing(v_id) || public.coach_application_missing(v_id);
  if cardinality(v_missing) > 0 then
    return v_missing;
  end if;
  update public.coach_profiles
     set status = 'pending_review', submitted_at = now(), review_note = null, review_decision = null
   where id = v_id;
  insert into public.coach_application_decisions (coach_profile_id, actor_id, decision) values (v_id, auth.uid(), 'submitted');
  perform public.marketplace_notify(auth.uid(), 'application_submitted', jsonb_build_object('coach_profile_id', v_id));
  return '{}';
end;
$$;

create or replace function public.admin_set_coach_profile_status(
  p_profile uuid, p_status text, p_reason text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_cp public.coach_profiles;
  v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 1000);
begin
  perform public.admin_assert();
  select * into v_cp from public.coach_profiles where id = p_profile for update;
  if not found then
    raise exception 'NO_COACH_PROFILE' using errcode = 'P0002';
  end if;
  -- approving, asking for changes, rejecting and revoking are admin_decide_coach_application()
  -- (checklist, evidence, history) since 20261118100000; this keeps suspend and restore
  if (v_cp.status = 'pending_review' and p_status in ('published', 'draft'))
     or (v_cp.status in ('published', 'hidden') and p_status = 'draft') then
    raise exception 'USE_APPLICATION_REVIEW' using errcode = '22023';
  end if;
  if not (
       (v_cp.status <> 'suspended' and p_status = 'suspended')
    or (v_cp.status = 'suspended' and p_status = 'draft')
    -- back to public only for a profile that was public when it was suspended: published_at
    -- alone is not enough, it survives a revocation and a later resubmission
    or (v_cp.status = 'suspended' and p_status = 'published' and v_cp.suspended_from in ('published', 'hidden'))
  ) then
    raise exception 'BAD_TRANSITION' using errcode = '22023';
  end if;
  if v_reason is null and (p_status = 'suspended' or (p_status = 'draft' and v_cp.status <> 'suspended')) then
    raise exception 'REASON_REQUIRED' using errcode = '22023';
  end if;

  update public.coach_profiles set
    status = p_status,
    reviewed_at = now(),
    reviewed_by = auth.uid(),
    published_at = case when p_status = 'published' then coalesce(published_at, now()) else published_at end,
    review_note = case when p_status = 'draft' then v_reason when p_status = 'published' then null else review_note end,
    suspended_at = case when p_status = 'suspended' then now() end,
    suspended_from = case when p_status = 'suspended' then v_cp.status end,
    suspension_reason = case when p_status = 'suspended' then v_reason end
  where id = p_profile;

  perform public.audit_log('ADMIN_ACTION', 'coach_profile', p_profile::text, v_cp.user_id,
    jsonb_build_object('op', 'coach_profile_status', 'from', v_cp.status, 'to', p_status, 'reason', v_reason));

  -- acting on the profile settles what was reported about it
  if p_status in ('suspended', 'draft') and v_cp.status in ('published', 'hidden', 'pending_review') then
    perform public.social_reports_close_for('coach', p_profile, 'profile ' || p_status);
  end if;
  perform public.marketplace_notify(v_cp.user_id,
    case
      when v_cp.status = 'suspended' then 'profile_restored'
      when p_status = 'published' then 'profile_published'
      when p_status = 'suspended' then 'profile_suspended'
      when v_cp.status = 'pending_review' then 'profile_returned'
      else 'profile_unpublished' end,
    jsonb_build_object('coach_profile_id', p_profile));
end;
$$;

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
            when 'review_hidden' then 'A review on your profile was hidden after moderation.'
            when 'revision_approved' then 'Your public page now shows the changes you submitted.'
            when 'revision_returned' then 'Your public page is unchanged. See the note on your coach profile page.'
            else '' end,
          jsonb_build_object('event', p_event,
                             'screen', case when p_event = 'review_hidden' then 'coach_reviews' else 'coach_profile_settings' end)
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
    ('marketplace', 'application_rejected', 0)
  ) r(category, event, delay)
  where r.category = p_category and (r.event = coalesce(p_event, '*') or r.event = '*')
  limit 1;
$$;

-- ============================================================================
-- 8. existing coaches: recorded, not changed
-- ============================================================================

do $$
declare
  v_legacy int;
  v_pending int;
  v_suspended int;
begin
  insert into public.coach_application_decisions (coach_profile_id, actor_id, decision, note, created_at)
  select cp.id, cp.reviewed_by, 'legacy_approved',
         'Published before document review (20261118100000); no documents on file.',
         coalesce(cp.reviewed_at, cp.published_at, now())
  from public.coach_profiles cp
  where cp.published_at is not null;
  get diagnostics v_legacy = row_count;
  select count(*) into v_pending from public.coach_profiles where status = 'pending_review';
  select count(*) into v_suspended from public.coach_profiles where status = 'suspended' and suspended_from = 'published';
  raise notice 'coach applications: % previously published profile(s) recorded as legacy_approved (visibility unchanged); % pending review need an identity document before approval; % suspended profile(s) may still be restored to public',
    v_legacy, v_pending, v_suspended;
end;
$$;
