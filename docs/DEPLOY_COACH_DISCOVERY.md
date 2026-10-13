# Coach Discovery launch: deployment plan

The database side of Coach Discovery's launch work: disciplines, mandatory application review, no identity documents, document operations, and private plan functions. Nothing here has been applied to production from this repository. **Remote state is whatever a read-only check against the confirmed project says.** The existence of a migration file is no evidence either way.

## Pending migrations (local order = application order)

| Version | File | Depends on | Notes |
|---|---|---|---|
| 20261116100000 | coach_disciplines | — | reported applied (SQL editor query, 2026-10-12) on an unconfirmed project |
| 20261117100000 / 110000 / 120000 | gym_map_and_stats / gym_records / gym_record_lifts_own | — | unknown remotely; no overlap with the coach migrations |
| 20261121100000 / 110000 / 120000 | gym_import / gym_import_grid / gym_photo_cache | 20261117100000 | **applied on caiaretlxiljiiuoirtp 2026-10-13**, together with 20261116 and 20261117* (2026-10-12) — so the remote is *newer* than 20261118–20261120: step 3 will flag them out of order and steps 4–5 need `--include-all` |
| 20261118100000 | coach_application_review | 20261116 (specializations) | redefines submit / status / notify / email rules; legacy backfill + NOTICE |
| 20261119100000 | coach_applications_without_identity_documents | 20261116 (`parent_id`), 20261118 | drops + recreates `admin_decide_coach_application` (new argument name); NOTICE |
| 20261120100000 | coach_documents_operations | 20261118, 20261119, 20261108 (revisions) | revision evidence check, notices, cleanup functions |
| 20261120110000 | plan_functions_private | 20260923 (paywall) | `my_plan` via `my_plan_row()`; tier functions no longer callable by anon / authenticated |

**Checked locally:**
- **Versions and names:** no duplicate versions, and every filename follows the pattern.
- **Edits after commit:** `20261118100000` was edited after its first commit (`ec7b3ca`). That is safe only because it was not applied anywhere at the time.
- **One old rename:** `20261002100000` became `20261002110000` (advanced achievements). If the remote ledger holds `20261002100000`, the diff below reports it as remote-only. That is expected: the same SQL, applied under the old name. Do not re-apply it, and do not `migration repair` without looking first.

**Project ref:** the only one in the repo or its history is `caiaretlxiljiiuoirtp`, the default in `scripts/db-backup.mjs`, labelled "the live one" (`ff1de72`). That is not proof. Confirm it against the host of production's `NEXT_PUBLIC_SUPABASE_URL` in Vercel → Settings → Environment Variables.

## Order of operations

1. **Confirm the project.** In Vercel, check the production `NEXT_PUBLIC_SUPABASE_URL` host. Then `npx supabase login` and `npx supabase projects list`. Expected: the ref is listed under the right organisation.
2. **Back up.** `npm run db:backup`. Expected: a new `backups/<timestamp>/` holding `db.dump`. It needs PostgreSQL 17 `pg_dump` locally.
3. **Compare the histories (read-only):**
   ```
   npx supabase link --project-ref <ref>            # writes only the gitignored supabase/.temp/
   npx supabase migration list --linked > remote.txt
   node scripts/migration-diff.mjs remote.txt
   ```
   - **Expected pending:** the rows of the table above not yet applied, in that order.
   - **Remote-only:** nothing, or only `20261002100000`.
   - **Out of order:** if the diff marks a pending version "older than the newest remote", step 4 and step 5 need `--include-all`.
4. **Dry run:** `npx supabase db push --linked --dry-run`, plus `--include-all` if step 3 said so. Expected: "Would push these migrations:" followed by exactly the pending files from step 3, in version order. Stop if the list differs.
5. **Apply:** `npx supabase db push --linked`, with `--include-all` if needed. Keep the NOTICE lines:
   - `coach applications: N previously published profile(s) recorded as legacy_approved (visibility unchanged); M pending review …; K suspended profile(s) may still be restored to public`
   - `coach applications without identity documents: X identity document row(s) on file …; Y recorded identity verification(s) kept but no longer shown publicly; Z pending application(s) still missing required qualification evidence`
   - `coach_disciplines` skipped-slug notices, if it was not applied before.
6. **Deploy the app**: commit `1393859` or later. It tolerates either database state. Missing functions answer PGRST202 and the related screens hide themselves. With the migrations in place, approvals work again. With app `1393859` and a database without `20261118` / `20261119`, approvals are frozen, so steps 5 and 6 belong close together.
7. **Configure evidence.** Mark the disciplines that require proof, for example:
   ```sql
   update public.specializations set qualification_evidence = 'required' where slug in ('…');
   ```
   A style inherits its parent's `required`.
8. **Smoke tests:**
   - Read-only SQL:
     ```sql
     select count(*) from public.coach_application_decisions where decision = 'legacy_approved';   -- = N from the NOTICE
     select status, count(*) from public.coach_profiles group by 1;                                -- same as the backup
     select has_function_privilege('anon', 'public.own_tier(uuid)', 'execute');                    -- false
     select has_function_privilege('authenticated', 'public.my_plan_row()', 'execute');            -- true
     select kind, count(*) from public.coach_verification_documents group by 1;                    -- no new identity rows
     ```
   - App, as an admin: `/admin/coach-applications` loads, and a pending coach's page shows the *Application review* panel.
   - App, as a coach and as a client: the billing / plan screen still shows the right plan. `my_plan` changed in `20261120110000`.
   - With a test coach: submit in a "recommended" discipline with no document, then approve. In a "required" discipline, submitting without a tagged qualification is refused; with one, it is accepted. The admin gets an in-app notice of the submission. The public page appears after approval and disappears after revocation.
9. **Clean up stored documents:** `node scripts/coach-documents.mjs identity --check-files`, then `orphans`, as dry runs. Execute only per `docs/COACH_DOCUMENTS_CLEANUP.md`.

## Rollback / fix forward

There are no down migrations. Every change is additive or a function redefinition, and none rewrites data except:
- the legacy history rows (`20261118`),
- the `suspended_from` backfill for already-suspended profiles (`20261118`).

| Symptom | Fix (forward) |
|---|---|
| Plan or paywall screens fail after `20261120110000` | `grant execute on function public.own_tier(uuid), public.effective_tier(uuid), public.paywall_on(uuid), public.user_plan_limit(uuid, text) to authenticated;` restores the old access at once (and the old leak). Then investigate. |
| Approvals fail with "function not found" | The app and database are out of step (`20261119` changes the decision function's arguments). Apply the missing migration, or deploy the app version that matches it. |
| A revision cannot be approved: APPLICATION_INCOMPLETE | Working as intended. The coach must upload the qualification for the discipline they are adding (it can be tagged with a discipline in the open revision). |
| Something must be undone | Write a new migration that restores the previous function definition from the earlier migration file. Do not edit an applied migration. Restore from the step 2 backup only for data loss. |

Rolling the app back on Vercel to before `9ab9c6e` against the new database does not expose anyone. The old approve button is refused with USE_APPLICATION_REVIEW, so approvals pause.
