-- pg_cron's run history is kept for a week (2026-10-26)
--
-- cron.job_run_details gets a row for every run of every job and nothing ever
-- removed one. rest-push-tick alone runs every 5 seconds (17,280 rows a day),
-- so by 2026-10-26 the live table held ~629,000 rows (103 MB) back to
-- 2026-09-06. admin_system_health() reads it twice — the last run per job, and
-- the last 24 h's counts — and has no index to use beyond the primary key, so
-- /admin/system started failing on the statement timeout.
--
-- The fix Supabase itself recommends: a daily job deleting history older than
-- seven days, which keeps the 24 h numbers the admin page shows and a week of
-- failures to look back on. It runs as the migration's role (postgres), which
-- owns the job and may delete from cron.job_run_details. The backlog is cleared
-- once here so the page works straight after the deploy.

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('cron-history-purge', '23 3 * * *',
      $cron$ delete from cron.job_run_details where start_time < now() - interval '7 days'; $cron$);
    execute $q$ delete from cron.job_run_details where start_time < now() - interval '7 days' $q$;
  end if;
end;
$$;
