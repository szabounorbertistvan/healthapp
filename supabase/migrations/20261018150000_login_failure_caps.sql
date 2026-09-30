-- HealthApp schema · record_login_failure() caps per email and per source
--
-- The RPC is granted to anon on purpose (a failed sign-in has no session), and
-- the IP / user agent are parameters because the only honest caller is our
-- Next server, which reads them from the request. QA (2026-09-29, SEC-2) found
-- the two consequences of that:
--   (a) anyone with the public anon key can forge LOGIN_FAILED rows for any
--       address, with any IP and user agent, polluting /admin/auth;
--   (b) the only cap was platform-wide (120 a minute), so one script could
--       spend it and hide a real attack behind "cap reached".
--
-- This keeps the anonymous grant and closes the cheap part of both:
--   · at most 10 rows per address per 15 minutes — a forger cannot bury one
--     account's history, and one account cannot eat the global budget;
--   · at most 30 rows a minute per reported IP;
--   · the address the database itself saw (PostgREST's request headers) is
--     stored beside the reported one, so a row whose reported IP was forged
--     directly against the API is visibly different from one our server sent.
-- The global 120/minute ceiling stays as the disk guard.

create or replace function public.record_login_failure(p_email text, p_ip text default null, p_user_agent text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(left(trim(coalesce(p_email, '')), 254));
  v_ip text := nullif(left(trim(coalesce(p_ip, '')), 64), '');
  v_headers json;
  v_seen text;
begin
  if v_email = '' or position('@' in v_email) = 0 then
    return;
  end if;
  if (select count(*) from public.admin_audit_events
      where action = 'LOGIN_FAILED' and created_at > now() - interval '1 minute') >= 120 then
    return;
  end if;
  if (select count(*) from public.admin_audit_events
      where entity_type = 'email' and entity_id = v_email
        and action = 'LOGIN_FAILED' and created_at > now() - interval '15 minutes') >= 10 then
    return;
  end if;
  if v_ip is not null and (select count(*) from public.admin_audit_events
      where action = 'LOGIN_FAILED' and created_at > now() - interval '1 minute' and ip = v_ip) >= 30 then
    return;
  end if;

  begin
    v_headers := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    v_headers := null;
  end;
  v_seen := left(split_part(coalesce(v_headers ->> 'cf-connecting-ip', v_headers ->> 'x-forwarded-for', ''), ',', 1), 64);

  perform public.audit_log('LOGIN_FAILED', 'email', v_email,
    (select u.id from auth.users u where lower(u.email) = v_email),
    jsonb_build_object('email', v_email, 'seen_ip', nullif(trim(v_seen), '')), null, v_ip, p_user_agent);
end;
$$;
grant execute on function public.record_login_failure(text, text, text) to anon, authenticated;
