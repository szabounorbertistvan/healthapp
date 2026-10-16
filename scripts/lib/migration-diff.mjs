// Compare a remote migration ledger (supabase_migrations.schema_migrations
// versions, pasted from the SQL editor or `supabase migration list`) with the
// local supabase/migrations files. Pure; scripts/migration-diff.mjs does the I/O.

/** Every 14-digit version in a text, sorted and unique. */
function versionsIn(text) {
  return [...new Set(String(text).match(/\b\d{14}\b/g) ?? [])].sort();
}

/**
 * The REMOTE versions of a ledger, from any of the three shapes it arrives in:
 *   - `supabase migration list` as JSON: {"migrations":[{"local":…,"remote":…}]} → the `remote` fields;
 *   - `supabase migration list` as a table: `Local | Remote | Time` rows → the Remote column;
 *   - anything else (the SQL editor's comma list) → every 14-digit number.
 * The CLI prints the local column beside the remote one, so reading every
 * number of its output counted a migration that exists only here as applied
 * there — and `pending` came out empty exactly when something was pending.
 */
export function parseVersions(text) {
  const s = String(text);
  const json = s.indexOf('{"migrations"');
  if (json >= 0) {
    try {
      const end = s.lastIndexOf("}");
      const parsed = JSON.parse(s.slice(json, end + 1));
      if (Array.isArray(parsed.migrations)) {
        return [...new Set(parsed.migrations.map((m) => String(m.remote ?? "")).filter((v) => /^\d{14}$/.test(v)))].sort();
      }
    } catch {
      // not the CLI's JSON after all: fall through to the other shapes
    }
  }
  const rows = s.split(/\r?\n/).filter((l) => /^\s*\d{14}\s*\||^\s*\|\s*\d{14}/.test(l));
  if (rows.length > 0) {
    return [...new Set(rows.map((l) => (l.split("|")[1] ?? "").trim()).filter((v) => /^\d{14}$/.test(v)))].sort();
  }
  return versionsIn(s);
}

/** Local file names → versions, refusing duplicates (two files, one version). */
export function localVersions(fileNames) {
  const seen = new Map();
  const duplicates = [];
  for (const name of fileNames) {
    const m = /^(\d{14})_[a-z0-9_]+\.sql$/.exec(name);
    if (!m) continue;
    if (seen.has(m[1])) duplicates.push(m[1]);
    seen.set(m[1], name);
  }
  return { versions: [...seen.keys()].sort(), names: seen, duplicates };
}

/**
 * What a push would do and what it could not explain. `outOfOrder` are local
 * versions not applied remotely but older than the newest remote one: a plain
 * `supabase db push` refuses them and needs `--include-all`.
 */
export function diff(local, remote) {
  const r = new Set(remote);
  const l = new Set(local);
  const pending = local.filter((v) => !r.has(v));
  const remoteOnly = remote.filter((v) => !l.has(v));
  const newestRemote = remote.length ? remote[remote.length - 1] : null;
  const outOfOrder = newestRemote ? pending.filter((v) => v < newestRemote) : [];
  return { pending, remoteOnly, outOfOrder, newestRemote };
}
