// The coach-document cleanup, minus I/O (scripts/coach-documents.mjs wires the
// real Supabase and Cloudinary calls; scripts/lib/coach-documents-core.test.mjs
// wires fakes). Three jobs, each a dry run unless --execute:
//
//   identity   every row classified as an identity document (Voinic keeps none
//              since 20261119100000) — the file, then the row
//   retention  qualification / other evidence nobody needs any more
//              (coach_document_purge_candidates, 20261120100000) — file, then row
//   orphans    files under voinic/coach-docs/ with no row at all (an upload that
//              was never recorded), older than --min-age-hours — the file only
//
// Safety, in order: the database decides what is a candidate (identity rows
// only, or evidence past the retention rule); every file name must be a
// coach-document path inside the owner's own folder; a candidate is checked
// again right before its file is deleted; the row goes only after its file is
// gone (deleted, or already missing), so a failure leaves the row for the next
// run; --execute needs --confirm=<the number the dry run printed> and
// --project-ref matching the configured project. Output carries
// counts, row ids and an opaque hash of a file name — never a file name, a
// URL, a user id or a credential.
import { createHash } from "node:crypto";

export const DOC_FOLDER = "voinic/coach-docs/";
export const DOC_PATH = /^voinic\/coach-docs\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/([A-Za-z0-9_-]{8,64})$/;
export const COMMANDS = ["identity", "retention", "orphans"];
export const REASONS = {
  identity: ["identity_document"],
  retention: ["not_accepted", "application_closed"],
};
export const DEFAULT_RETENTION_DAYS = 365;
export const MIN_RETENTION_DAYS = 30;
export const DEFAULT_ORPHAN_MIN_AGE_HOURS = 48;

/** A short, stable, non-reversible handle for a file name, for correlating runs. */
export function fileHandle(publicId) {
  return createHash("sha256").update(String(publicId)).digest("hex").slice(0, 12);
}

/** The project ref of a Supabase URL (https://<ref>.supabase.co), or null. */
export function projectRefOf(url) {
  const m = /^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/.exec(String(url ?? "").trim());
  return m ? m[1] : null;
}

export function parseArgs(argv, env = {}) {
  const [command, ...rest] = argv;
  const opts = {
    command, execute: false, confirm: null, projectRef: null,
    days: env.COACH_DOCUMENT_RETENTION_DAYS ? Number(env.COACH_DOCUMENT_RETENTION_DAYS) : DEFAULT_RETENTION_DAYS,
    minAgeHours: DEFAULT_ORPHAN_MIN_AGE_HOURS, checkFiles: false,
  };
  for (const arg of rest) {
    const [k, v] = arg.split(/=(.*)/s);
    if (k === "--execute") opts.execute = true;
    else if (k === "--check-files") opts.checkFiles = true;
    else if (k === "--confirm") opts.confirm = Number(v);
    else if (k === "--project-ref") opts.projectRef = v ?? null;
    else if (k === "--days") opts.days = Number(v);
    else if (k === "--min-age-hours") opts.minAgeHours = Number(v);
    else throw new Error(`unknown option: ${k}`);
  }
  if (!COMMANDS.includes(command)) throw new Error(`command must be one of: ${COMMANDS.join(", ")}`);
  if (command === "retention" && !(Number.isInteger(opts.days) && opts.days >= MIN_RETENTION_DAYS)) {
    throw new Error(`--days must be a whole number of at least ${MIN_RETENTION_DAYS}`);
  }
  if (command === "orphans" && !(Number.isFinite(opts.minAgeHours) && opts.minAgeHours >= 24)) {
    throw new Error("--min-age-hours must be at least 24 (an upload is recorded within seconds of finishing)");
  }
  if (opts.execute && !(Number.isInteger(opts.confirm) && opts.confirm >= 0)) {
    throw new Error("--execute needs --confirm=<number of items the dry run listed>");
  }
  return opts;
}

/**
 * Whether a database candidate may be acted on: the reason belongs to the job,
 * and the file is a coach-document path inside its owner's own folder (so a
 * profile photo, a post picture or another coach's file can never match).
 */
export function checkCandidate(command, row) {
  const reasons = REASONS[command] ?? [];
  if (!reasons.includes(row?.reason)) return "wrong_reason";
  const m = DOC_PATH.exec(String(row?.storage_public_id ?? ""));
  if (!m) return "bad_path";
  if (m[1] !== String(row?.coach_user_id ?? "").toLowerCase()) return "not_owner_folder";
  return null;
}

/** Whether a stored file may be treated as an orphan: a coach-document path, no row, old enough. */
export function checkOrphan(resource, recorded, minAgeHours, now = Date.now()) {
  if (!DOC_PATH.test(String(resource?.public_id ?? ""))) return "bad_path";
  if (recorded.has(resource.public_id)) return "recorded";
  const created = Date.parse(resource?.created_at ?? "");
  if (!Number.isFinite(created)) return "unknown_age";
  if (now - created < minAgeHours * 3600 * 1000) return "too_recent";
  return null;
}

/** What a run would act on. Pure over what the deps return. */
export async function makePlan(deps, opts) {
  if (opts.command === "orphans") {
    const recorded = new Set(await deps.storageIds());
    const files = await deps.listFiles(DOC_FOLDER);
    const items = [];
    const skipped = {};
    for (const f of files) {
      const why = checkOrphan(f, recorded, opts.minAgeHours, deps.now?.() ?? Date.now());
      if (why) { skipped[why] = (skipped[why] ?? 0) + 1; continue; }
      items.push({ handle: fileHandle(f.public_id), publicId: f.public_id });
    }
    return { items, skipped };
  }
  const rows = await deps.candidates(opts.command, opts.command === "retention" ? opts.days : null);
  const items = [];
  const skipped = {};
  for (const r of rows) {
    const why = checkCandidate(opts.command, r);
    if (why) { skipped[why] = (skipped[why] ?? 0) + 1; continue; }
    items.push({ documentId: r.document_id, handle: fileHandle(r.storage_public_id), publicId: r.storage_public_id, reason: r.reason });
  }
  return { items, skipped };
}

function label(item) {
  return item.documentId ? `document ${item.documentId} (file #${item.handle})` : `file #${item.handle}`;
}

/**
 * Dry run or execution. `log` gets one line per event; nothing it is given
 * names a file, a user or a URL. Returns the counts; `failed > 0` means run it
 * again later — every failure leaves the row (and, if the file delete failed,
 * the file) for the next run.
 */
export async function run(deps, opts, log) {
  const plan = await makePlan(deps, opts);
  const summary = { planned: plan.items.length, skipped: plan.skipped, filesPresent: null, filesDeleted: 0, filesAlreadyGone: 0,
                    rowsDeleted: 0, changedSincePlan: 0, failed: 0, executed: false };
  log(`${opts.command}: ${plan.items.length} item(s) planned` +
      (Object.keys(plan.skipped).length ? `; not eligible: ${JSON.stringify(plan.skipped)}` : ""));
  for (const item of plan.items) log(`  would remove ${label(item)}${item.reason ? ` — ${item.reason}` : ""}`);

  if (opts.checkFiles && opts.command !== "orphans") {
    let present = 0;
    for (const item of plan.items) if (await deps.fileExists(item.publicId)) present += 1;
    summary.filesPresent = present;
    log(`  ${present} of ${plan.items.length} file(s) still in storage`);
  }

  if (!opts.execute) {
    log(`dry run: nothing was changed. To execute: --execute --confirm=${plan.items.length} --project-ref=<ref>`);
    return summary;
  }
  if (opts.confirm !== plan.items.length) {
    throw new Error(`refusing to execute: --confirm=${opts.confirm} but ${plan.items.length} item(s) are planned now; run the dry run again`);
  }
  summary.executed = true;

  for (const item of plan.items) {
    try {
      if (opts.command !== "orphans") {
        // still a candidate, still the same file? (the state can move between the plan and now)
        const fresh = await deps.candidates(opts.command, opts.command === "retention" ? opts.days : null);
        if (!fresh.some((r) => r.document_id === item.documentId && r.storage_public_id === item.publicId && !checkCandidate(opts.command, r))) {
          summary.changedSincePlan += 1;
          log(`  skipped ${label(item)}: no longer a candidate`);
          continue;
        }
      } else if ((await deps.storageIds()).includes(item.publicId)) {
        summary.changedSincePlan += 1;
        log(`  skipped ${label(item)}: now recorded`);
        continue;
      }
      const outcome = await deps.deleteFile(item.publicId);
      if (outcome === "deleted") summary.filesDeleted += 1;
      else if (outcome === "not_found") summary.filesAlreadyGone += 1;
      else throw new Error("storage did not confirm the delete");
      if (opts.command === "orphans") { log(`  removed ${label(item)}`); continue; }
      const removed = await deps.purgeRow(item.documentId, item.publicId, opts.command, opts.command === "retention" ? opts.days : null);
      if (removed) { summary.rowsDeleted += 1; log(`  removed ${label(item)}`); }
      else { summary.changedSincePlan += 1; log(`  file removed, row kept for ${label(item)}: it changed since the plan`); }
    } catch (error) {
      summary.failed += 1;
      log(`  FAILED ${label(item)}: ${safeMessage(error)} — left in place for the next run`);
    }
  }
  log(`done: ${summary.rowsDeleted} row(s), ${summary.filesDeleted} file(s) deleted, ${summary.filesAlreadyGone} already gone, ` +
      `${summary.changedSincePlan} changed since the plan, ${summary.failed} failed`);
  return summary;
}

/** An error message without anything that could be a URL, a file name or a key. */
export function safeMessage(error) {
  const status = error?.status ? `HTTP ${error.status}` : null;
  const text = String(error?.message ?? error ?? "error")
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/voinic\/coach-docs\/\S+/g, "<file>")
    .replace(/[A-Za-z0-9_-]{24,}/g, "<redacted>")
    .slice(0, 160);
  return status ? `${status}: ${text}` : text;
}
