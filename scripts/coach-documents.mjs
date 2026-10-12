#!/usr/bin/env node
// Coach verification documents: cleanup for an authorized operator.
// Dry run by default; see docs/COACH_DOCUMENTS_CLEANUP.md before running it
// against any real project, and take a backup first (npm run db:backup).
//
//   node scripts/coach-documents.mjs identity                      # dry run
//   node scripts/coach-documents.mjs identity --check-files        # + how many files still exist
//   node scripts/coach-documents.mjs identity --execute --confirm=<N> --project-ref=<ref>
//   node scripts/coach-documents.mjs retention [--days=365] [...]  # evidence past the retention rule
//   node scripts/coach-documents.mjs orphans [--min-age-hours=48]  # files with no row
//
// Environment (never printed): SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL),
// SUPABASE_SERVICE_ROLE_KEY, CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY,
// CLOUDINARY_API_SECRET; optional COACH_DOCUMENT_RETENTION_DAYS.
// Talks to the Supabase REST API (service role, the coach_document_* functions
// of 20261120100000) and the Cloudinary Admin API over HTTPS; no SDK.
import { parseArgs, projectRefOf, run, safeMessage } from "./lib/coach-documents-core.mjs";

function need(name, value) {
  if (!value) throw new Error(`missing environment variable ${name}`);
  return value.trim();
}

function supabaseDeps(env) {
  const url = need("SUPABASE_URL", env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL).replace(/\/$/, "");
  const key = need("SUPABASE_SERVICE_ROLE_KEY", env.SUPABASE_SERVICE_ROLE_KEY);
  async function rpc(fn, args) {
    const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    if (!res.ok) throw Object.assign(new Error(`database call ${fn} failed`), { status: res.status });
    return res.json();
  }
  return {
    url,
    candidates: (mode, days) => rpc("coach_document_purge_candidates", { p_mode: mode, p_retention_days: days }),
    purgeRow: (id, publicId, mode, days) =>
      rpc("coach_document_purge", { p_document: id, p_storage_public_id: publicId, p_mode: mode, p_retention_days: days }),
    storageIds: async () => (await rpc("coach_document_storage_ids", {})).map((r) => (typeof r === "string" ? r : Object.values(r)[0])),
  };
}

function cloudinaryDeps(env) {
  const cloud = need("CLOUDINARY_CLOUD_NAME", env.CLOUDINARY_CLOUD_NAME);
  const auth = "Basic " + Buffer.from(`${need("CLOUDINARY_API_KEY", env.CLOUDINARY_API_KEY)}:${need("CLOUDINARY_API_SECRET", env.CLOUDINARY_API_SECRET)}`).toString("base64");
  // coach documents are `authenticated` assets uploaded through /image/upload (PDFs included)
  const base = `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloud)}/resources/image/authenticated`;
  const path = (publicId) => publicId.split("/").map(encodeURIComponent).join("/");
  return {
    async fileExists(publicId) {
      const res = await fetch(`${base}/${path(publicId)}`, { headers: { Authorization: auth } });
      if (res.status === 404) return false;
      if (!res.ok) throw Object.assign(new Error("storage lookup failed"), { status: res.status });
      await res.body?.cancel(); // the body carries delivery URLs: never read, never printed
      return true;
    },
    async deleteFile(publicId) {
      const q = new URLSearchParams({ "public_ids[]": publicId, invalidate: "true" });
      const res = await fetch(`${base}?${q}`, { method: "DELETE", headers: { Authorization: auth } });
      if (!res.ok) throw Object.assign(new Error("storage delete failed"), { status: res.status });
      const body = await res.json();
      return body?.deleted?.[publicId] ?? null; // "deleted" | "not_found"
    },
    async listFiles(prefix) {
      const out = [];
      let cursor = null;
      do {
        const q = new URLSearchParams({ prefix, max_results: "500" });
        if (cursor) q.set("next_cursor", cursor);
        const res = await fetch(`${base}?${q}`, { headers: { Authorization: auth } });
        if (!res.ok) throw Object.assign(new Error("storage listing failed"), { status: res.status });
        const body = await res.json();
        for (const r of body.resources ?? []) out.push({ public_id: r.public_id, created_at: r.created_at });
        cursor = body.next_cursor ?? null;
      } while (cursor);
      return out;
    },
  };
}

async function main() {
  const env = process.env;
  const opts = parseArgs(process.argv.slice(2), env);
  const cloud = cloudinaryDeps(env);
  const db = supabaseDeps(env);
  const ref = projectRefOf(db.url);
  console.log(`project: ${ref ?? "(not a hosted Supabase URL)"} · job: ${opts.command} · ${opts.execute ? "EXECUTE" : "dry run"}` +
              (opts.command === "retention" ? ` · retention ${opts.days} days` : ""));
  if (opts.execute && opts.projectRef !== ref) {
    throw new Error(`refusing to execute: --project-ref=${opts.projectRef ?? ""} does not match the configured project`);
  }
  const summary = await run({ ...db, ...cloud }, opts, (line) => console.log(line));
  if (summary.failed > 0) process.exitCode = 2;
}

main().catch((error) => {
  console.error(`error: ${safeMessage(error)}`);
  process.exitCode = 1;
});
