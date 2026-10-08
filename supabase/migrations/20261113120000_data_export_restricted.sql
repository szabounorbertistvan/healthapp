-- GDPR export: the rows a person owns but cannot select (launch audit 2026-10-08, §15.6).
--
-- lib/data-export.ts reads every table the account owns under its own RLS. Ten
-- of them carry no select grant for `authenticated` at all — they are written
-- and read through functions — so the export reported them as "permission
-- denied" instead of carrying them. This hands back exactly the caller's rows,
-- minus what is not theirs to receive:
--   * moderation internals: admin_note, the reviewing admin's id
--     (verified_by / decided_by / resolved_by), the resolution note;
--   * document_ref — a storage path, not data (the documents are not uploaded yet);
--   * on a report, who or what was reported: that is someone else's data. The
--     kind of target stays.
-- Calendar OAuth tokens live in calendar_credentials, which is not read here.

create or replace function public.export_my_restricted_data()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_profile uuid;
begin
  if v_me is null then
    raise exception 'NOT_SIGNED_IN' using errcode = '42501';
  end if;
  select id into v_profile from public.coach_profiles where user_id = v_me;

  return jsonb_build_object(
    'barcode_scans', coalesce((select jsonb_agg(to_jsonb(b) order by b.day) from public.barcode_scans b where b.user_id = v_me), '[]'),
    'marketplace_signups', coalesce((select jsonb_agg(to_jsonb(m)) from public.marketplace_signups m where m.user_id = v_me), '[]'),
    'social_reports', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'reason', r.reason, 'details', r.details, 'status', r.status,
        'created_at', r.created_at, 'resolved_at', r.resolved_at,
        'target', case
          when r.reported_post_id is not null then 'post'
          when r.reported_comment_id is not null then 'comment'
          when r.reported_review_id is not null then 'review'
          when r.reported_coach_profile_id is not null then 'coach_profile'
          else 'user' end
      ) order by r.created_at)
      from public.social_reports r where r.reporter_id = v_me), '[]'),
    'calendar_connections', coalesce((select jsonb_agg(to_jsonb(c)) from public.calendar_connections c where c.coach_id = v_me), '[]'),
    'calendar_sources', coalesce((select jsonb_agg(to_jsonb(s)) from public.calendar_sources s where s.coach_id = v_me), '[]'),
    'calendar_busy_blocks', coalesce((select jsonb_agg(to_jsonb(k)) from public.calendar_busy_blocks k where k.coach_id = v_me), '[]'),
    'coach_certifications', coalesce((
      select jsonb_agg(to_jsonb(c) - 'admin_note' - 'verified_by' - 'document_ref' order by c.sort_order)
      from public.coach_certifications c where c.coach_profile_id = v_profile), '[]'),
    'coach_verifications', coalesce((
      select jsonb_agg(to_jsonb(v) - 'admin_note' - 'verified_by' - 'document_ref' order by v.created_at)
      from public.coach_verifications v where v.coach_profile_id = v_profile), '[]'),
    'coach_profile_revisions', coalesce((
      select jsonb_agg(to_jsonb(r) - 'decided_by' order by r.created_at)
      from public.coach_profile_revisions r where r.coach_profile_id = v_profile), '[]'),
    'coach_slug_redirects', coalesce((
      select jsonb_agg(to_jsonb(d) order by d.created_at)
      from public.coach_slug_redirects d where d.coach_profile_id = v_profile), '[]')
  );
end;
$$;
revoke execute on function public.export_my_restricted_data() from public, anon;
grant execute on function public.export_my_restricted_data() to authenticated;
