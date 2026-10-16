// The migration gate's rules, pure; scripts/migration-gate.mjs does the I/O.
//
// What it can know without a database: the files themselves, and — given the
// commit they are being merged onto — how they changed. What it cannot know is
// whether production has applied them; that is checkRemote(), which needs a
// ledger someone read from the live project (scripts/migration-gate.mjs --remote).
import { diff, localVersions } from "./migration-diff.mjs";

const NAME = /^(\d{14})_[a-z0-9_]+\.sql$/;
const versionOf = (path) => NAME.exec(String(path).split("/").pop() ?? "")?.[1] ?? null;

/** Every .sql file named `<14 digits>_<snake_case>.sql`, and no two sharing a version. */
export function checkNames(fileNames) {
  const errors = [];
  for (const name of fileNames) {
    if (name.endsWith(".sql") && !NAME.test(name)) errors.push(`${name}: not <14-digit version>_<snake_case>.sql — the CLI would skip or misorder it`);
  }
  for (const v of localVersions(fileNames).duplicates) errors.push(`${v}: two files share this version`);
  return errors;
}

/**
 * `git diff --name-status -M <base> HEAD -- supabase/migrations` lines, read.
 * A rename is `R<score>\told\tnew`.
 */
export function parseNameStatus(text) {
  return String(text).split(/\r?\n/).filter(Boolean).map((line) => {
    const [status, a, b] = line.split("\t");
    return { status: status[0], path: a, newPath: b ?? null };
  });
}

/**
 * Against the base the change lands on:
 *   - a migration that already existed there is never modified, deleted or
 *     renamed — production may have run it, and editing the file changes
 *     nothing there while making every fresh database differ from production;
 *   - a new migration is newer than every one already there — an older version
 *     is refused by a plain `supabase db push` (it needs --include-all) and runs
 *     out of order on a fresh database.
 * `allowed` (supabase/migration-gate.json) names the versions a reviewer let
 * through on purpose, e.g. a file renamed before it was ever applied.
 */
export function checkHistory(changes, baseVersions, allowed = {}) {
  const base = new Set(baseVersions);
  const newest = [...base].sort().pop() ?? null;
  const errors = [];
  for (const c of changes) {
    const v = versionOf(c.path);
    if (!v) continue;
    if (c.status === "A") {
      if (newest && v < newest && !(v in allowed)) {
        errors.push(`${c.path}: added with version ${v}, older than ${newest} already on the base — db push would need --include-all`);
      }
      continue;
    }
    if (!base.has(v) || v in allowed) continue;
    const what = c.status === "D" ? "deleted" : c.status === "R" ? `renamed to ${c.newPath}` : "modified";
    errors.push(`${c.path}: ${what}, but it was already on the base — write a new migration instead`);
    if (c.status === "R") {
      const nv = versionOf(c.newPath ?? "");
      if (nv && newest && nv < newest && !(nv in allowed)) errors.push(`${c.newPath}: version ${nv} is older than ${newest}`);
    }
  }
  return errors;
}

/**
 * Against a ledger read from the live project. Before deploying code, both
 * lists must be empty: a remote-only version is schema production has and the
 * repository does not (a fresh database, CI and the offline suites all lack
 * it); a pending one is a migration the code may need and production lacks.
 */
export function checkRemote(localFileVersions, remoteVersions) {
  const d = diff(localFileVersions, remoteVersions);
  const errors = [];
  for (const v of d.remoteOnly) errors.push(`${v}: applied on the remote, no file in supabase/migrations — commit the exact SQL that ran`);
  for (const v of d.pending) {
    errors.push(`${v}: not applied on the remote${d.outOfOrder.includes(v) ? " (older than the newest remote: db push needs --include-all)" : ""} — apply it before deploying code that needs it`);
  }
  return { errors, ...d };
}
