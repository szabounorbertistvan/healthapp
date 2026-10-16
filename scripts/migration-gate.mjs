#!/usr/bin/env node
// The migration gate. Read-only: it reads files and git, never a database.
//
//   node scripts/migration-gate.mjs                     names + duplicates
//   node scripts/migration-gate.mjs --base <git ref>    + no migration already on <ref> was edited,
//                                                         deleted or renamed; new ones are newer (CI)
//   node scripts/migration-gate.mjs --remote <file>     + the ledger in <file> matches the files
//                                                         (before a release; see docs/MIGRATION_GATE.md)
//
// Exit 1 on any finding. Rules: scripts/lib/migration-gate.mjs. Exceptions a
// reviewer accepted: supabase/migration-gate.json {"allow": {"<version>": "<why>"}}.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { localVersions, parseVersions } from "./lib/migration-diff.mjs";
import { checkHistory, checkNames, checkRemote, parseNameStatus } from "./lib/migration-gate.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = "supabase/migrations";
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] ?? "" : null;
};
const git = (...a) => execFileSync("git", a, { cwd: root, encoding: "utf8" });

const files = readdirSync(join(root, dir));
const allowFile = join(root, "supabase", "migration-gate.json");
const allowed = existsSync(allowFile) ? (JSON.parse(readFileSync(allowFile, "utf8")).allow ?? {}) : {};
const errors = [...checkNames(files)];
const notes = [];

const base = opt("--base");
if (base !== null) {
  // A push that creates a branch (or follows a force push) has no usable "before":
  // say so rather than pass silently, and still run the other checks.
  let resolved = null;
  if (base && !/^0+$/.test(base)) {
    try { resolved = git("rev-parse", "--verify", `${base}^{commit}`).trim(); } catch { resolved = null; }
  }
  if (!resolved) {
    notes.push(`history check skipped: base "${base}" is not a commit here (new branch, force push or shallow clone)`);
  } else {
    const baseFiles = git("ls-tree", "--name-only", resolved, `${dir}/`).split(/\r?\n/).map((p) => p.split("/").pop());
    const baseVersions = localVersions(baseFiles).versions;
    const changes = parseNameStatus(git("diff", "--name-status", "-M", resolved, "HEAD", "--", dir));
    errors.push(...checkHistory(changes, baseVersions, allowed));
    notes.push(`history checked against ${resolved.slice(0, 7)}: ${changes.length} change(s) under ${dir}`);
  }
}

const remote = opt("--remote");
if (remote !== null) {
  const r = checkRemote(localVersions(files).versions, parseVersions(readFileSync(remote, "utf8")));
  errors.push(...r.errors);
  notes.push(`remote ledger: newest ${r.newestRemote ?? "-"}, ${r.pending.length} pending, ${r.remoteOnly.length} remote-only`);
}

for (const n of notes) console.log(n);
if (errors.length) {
  console.error(`migration gate: ${errors.length} finding(s)`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}
console.log(`migration gate: ok (${localVersions(files).versions.length} migrations)`);
