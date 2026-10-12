// Compare a remote migration ledger (supabase_migrations.schema_migrations
// versions, pasted from the SQL editor or `supabase migration list`) with the
// local supabase/migrations files. Pure; scripts/migration-diff.mjs does the I/O.

/** 14-digit versions found anywhere in a text (a comma list, a table, CLI output). */
export function parseVersions(text) {
  return [...new Set(String(text).match(/\b\d{14}\b/g) ?? [])].sort();
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
