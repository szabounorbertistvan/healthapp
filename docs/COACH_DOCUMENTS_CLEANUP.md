# Coach documents: cleanup and retention

Operator guide for `scripts/coach-documents.mjs`. It removes coach verification
files and their database rows **only** in three well-defined cases. It is a dry
run unless told otherwise, and it has never been run against production from
this repository.

## What it can remove

| Job | Rows it considers | What it deletes |
|---|---|---|
| `identity` | every `coach_verification_documents` row with `kind = 'identity'` (Voinic keeps no identity documents since `20261119100000`) | the file, then the row |
| `retention` | qualification / other evidence nobody needs any more (below) | the file, then the row |
| `orphans` | files under `voinic/coach-docs/` with **no** row, older than `--min-age-hours` (default 48) — uploads that were never recorded | the file only |

The candidate lists come from the database (`coach_document_purge_candidates()`,
`coach_document_storage_ids()`, migration `20261120100000`, service role only),
not from the script.

### Retention policy

The default is **365 days**. Set it with `--days=N` or `COACH_DOCUMENT_RETENTION_DAYS`; the database refuses anything under 30. A row is a retention candidate only when one of these holds:

- **Not accepted:** the document was not accepted (`status = 'rejected'`), its review is older than the window, and the profile is draft, published or hidden. Never while an application is in review or the profile is suspended.
- **Closed application:** the application was rejected or revoked and left that way. The profile is a draft with `review_decision` = rejected / revoked, the decision is older than the window, and the document is older than the window. All of that application's evidence goes.

Never a candidate:

- The accepted evidence of a live profile.
- Anything in a pending review or on a suspended profile.
- Identity documents. They have their own job, `identity`.

The privacy policy (`app/privacy/page.tsx`) promises the 12-month rule, so the retention job has to actually run. `.github/workflows/coach-documents-retention.yml` does the **dry runs** (retention, identity, orphans) on the 1st of every month and goes red when anything is due; it deletes nothing, because `--execute` stays a person's act. It needs five repository secrets in GitHub (Settings → Secrets and variables → Actions): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` — until they are set it fails (red) and checks nothing. When it is red: take a backup, then run the printed jobs by hand as below. Account deletion removes every document separately: `destroyUserPhotos()` deletes the whole folder when deletion is requested, and the purge job removes the rows.

## Safety properties (tested in `scripts/lib/coach-documents-core.test.mjs` and `supabase/tests/coach_documents_operations.test.sql`)

- **Only the coach-documents folder.** A file must match `voinic/coach-docs/<owner's user id>/<name>`. A profile photo, a post picture, another coach's file or any path outside that folder is never planned.
- **File before row.** The file is deleted first and the row second. If storage fails, the row stays, so the next run tries again. A file that is already missing ("not_found") counts as gone, so a crash between the two steps heals on the next run.
- **Re-check before deleting.** Each candidate is checked again right before its file is deleted. A row that stopped being a candidate is skipped.
- **The database re-checks too.** `coach_document_purge()` deletes a row only if it is still a candidate under the same rule and still names the same file. An `identity` run can never delete a qualification row.
- **Explicit confirmation.** `--execute` needs `--confirm=<N>`, where N is the number the dry run printed (re-planned at execution), and `--project-ref=<ref>`, which must match the configured Supabase URL.
- **Nothing sensitive in output.** It prints counts, row ids and a 12-character hash of each file name. Never a file name, a URL, a user id or a key. A Cloudinary lookup body (which holds delivery URLs) is never read, and a listing is reduced in memory to each file's name and creation time.
- **Exit status:** exit code 2 when an item failed; re-running is safe.

## Running it

Run it only after `npm run db:backup`, and only with the project ref confirmed: the host of production's `NEXT_PUBLIC_SUPABASE_URL` on Vercel. Credentials come from the environment and are never printed:

```
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=…            # Supabase → Project settings → API (service role)
CLOUDINARY_CLOUD_NAME=…  CLOUDINARY_API_KEY=…  CLOUDINARY_API_SECRET=…
```

```
node scripts/coach-documents.mjs identity --check-files      # dry run: count, ids, how many files still exist
node scripts/coach-documents.mjs identity --execute --confirm=<N> --project-ref=<ref>
node scripts/coach-documents.mjs orphans                     # dry run
node scripts/coach-documents.mjs retention --days=365        # dry run
```

**Expected dry-run result on a database where `20261118100000` was never live:** `identity: 0 item(s) planned`. No identity document can have been recorded there. A non-zero count means identity documents were recorded, and the run removes them file-first.

**Requirements:**
- It needs migration `20261120100000` on the target. Before that, the database calls fail with HTTP 404 and nothing happens.
- It uses the Cloudinary Admin API: listing, lookup and delete, about one call per item. The free plan allows 500 Admin API calls an hour, which is ample at these volumes.
- No SDK and no new dependency.
