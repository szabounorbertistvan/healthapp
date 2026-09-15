// Copy the exercise-library photos into Supabase Storage and repoint the rows
// at our own bucket.
//
// Why: `exercises.images` currently holds raw.githubusercontent.com URLs from
// the Free Exercise DB import (public domain, same source as the exercise
// rows). Hotlinking GitHub is fine for development and wrong for production —
// no CDN guarantee, no rate-limit guarantee, and the repository could move. The
// pictures are ~1 750 JPEGs, roughly 100 MB.
//
// Needs the SERVICE ROLE key: `exercises` is written by service role only
// (20260823000300_training.sql), and creating a bucket is an admin call.
//
//   $env:SUPABASE_SERVICE_ROLE_KEY = "sb_secret_..."   # PowerShell
//   node scripts/mirror-exercise-images.mjs --dry-run       # what it would do
//   node scripts/mirror-exercise-images.mjs                 # do it
//   node scripts/mirror-exercise-images.mjs --limit 20      # a small slice first
//
// Safe to re-run: an object that is already in the bucket is not downloaded
// again, and a row whose images already point at the bucket is skipped. Stop it
// at any time and run it again — it resumes.

import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUCKET = process.env.EXERCISE_IMAGE_BUCKET ?? "exercise-images";
const PAGE = 200;
const CONCURRENCY = 6;

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const LIMIT = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) || 0 : 0;
// --download-only needs no credentials at all: the URLs are in the seed file,
// so the 1 746 photos can be pulled down now and uploaded later, when whoever
// holds the service-role key runs the script without this flag.
const DOWNLOAD_ONLY = args.includes("--download-only");
const OUT_DIR = args.includes("--out") ? args[args.indexOf("--out") + 1] : join(root, ".exercise-images");

function fromEnvFile(key) {
  try {
    const line = readFileSync(join(root, "apps/web/.env.local"), "utf8")
      .split(/\r?\n/)
      .find((l) => l.trim().startsWith(`${key}=`));
    return line ? line.slice(line.indexOf("=") + 1).trim() : undefined;
  } catch {
    return undefined;
  }
}

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? fromEnvFile("NEXT_PUBLIC_SUPABASE_URL");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? fromEnvFile("SUPABASE_SERVICE_ROLE_KEY");

if (!DOWNLOAD_ONLY) {
  if (!URL_) fail("NEXT_PUBLIC_SUPABASE_URL is not set (apps/web/.env.local or the environment).");
  if (!KEY) fail("SUPABASE_SERVICE_ROLE_KEY is not set. Supabase dashboard → Project Settings → API keys → service_role.");
}

const supabase = DOWNLOAD_ONLY ? null : createClient(URL_, KEY, { auth: { persistSession: false } });
const publicBase = URL_ ? `${URL_.replace(/\/$/, "")}/storage/v1/object/public/${BUCKET}/` : "";

/** `.../exercises/3_4_Sit-Up/0.jpg` → `3_4_Sit-Up/0.jpg`, so the bucket mirrors the source tree. */
function objectPath(externalId, url, index) {
  const tail = url.split("/").slice(-2).join("/");
  const looksRight = /^[\w.-]+\/\d+\.(jpg|jpeg|png|webp)$/i.test(tail);
  if (looksRight) return tail;
  const ext = (url.split(".").pop() ?? "jpg").split(/[?#]/)[0];
  return `${externalId}/${index}.${ext}`;
}

const contentTypeOf = (path) =>
  path.endsWith(".png") ? "image/png" : path.endsWith(".webp") ? "image/webp" : "image/jpeg";

async function ensureBucket() {
  const { data: buckets, error } = await supabase.storage.listBuckets();
  if (error) fail(`Could not list buckets: ${error.message}`);
  if (buckets.some((b) => b.name === BUCKET)) return false;
  if (DRY) return true;
  const { error: createError } = await supabase.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: "5MB",
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
  });
  if (createError) fail(`Could not create the bucket: ${createError.message}`);
  return true;
}

/** Every object already in the bucket, so a re-run costs one listing instead of 1 750 HEADs. */
async function existingObjects() {
  const seen = new Set();
  const { data: folders, error } = await supabase.storage.from(BUCKET).list("", { limit: 2000 });
  if (error) {
    // A bucket that does not exist yet simply has nothing in it.
    return seen;
  }
  for (const folder of folders ?? []) {
    if (folder.id) continue; // a file at the root, not a folder
    const { data: files } = await supabase.storage.from(BUCKET).list(folder.name, { limit: 100 });
    for (const file of files ?? []) seen.add(`${folder.name}/${file.name}`);
  }
  return seen;
}

async function mirrorOne(externalId, url, index, have) {
  const path = objectPath(externalId, url, index);
  const publicUrl = publicBase + path;
  if (url.startsWith(publicBase)) return { path, publicUrl, skipped: "already-ours" };
  if (have.has(path)) return { path, publicUrl, skipped: "in-bucket" };
  if (DRY) return { path, publicUrl, skipped: "dry-run" };

  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  const body = new Uint8Array(await response.arrayBuffer());
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, body, { contentType: contentTypeOf(path), upsert: true, cacheControl: "31536000" });
  if (error) throw new Error(`upload ${path}: ${error.message}`);
  have.add(path);
  return { path, publicUrl, skipped: null };
}

/** Run `jobs` with a small pool — GitHub raw does not enjoy 1 750 parallel requests. */
async function pool(jobs, size) {
  const results = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, jobs.length) }, async () => {
      while (next < jobs.length) {
        const index = next++;
        results[index] = await jobs[index]();
      }
    }),
  );
  return results;
}

/**
 * Pull every photo listed in the seed into a folder, keeping the source tree
 * (`3_4_Sit-Up/0.jpg`). No database, no keys — just the public-domain files.
 */
async function downloadOnly() {
  const seed = JSON.parse(readFileSync(join(root, "supabase/seed/exercises.json"), "utf8"));
  const jobs = [];
  for (const exercise of seed) {
    (exercise.images ?? []).forEach((url, index) => {
      jobs.push({ path: objectPath(exercise.external_id, url, index), url });
    });
  }
  const wanted = LIMIT ? jobs.slice(0, LIMIT) : jobs;
  console.log(`${wanted.length} files → ${OUT_DIR}`);

  let saved = 0;
  let skipped = 0;
  let failed = 0;
  await pool(
    wanted.map((job) => async () => {
      const target = join(OUT_DIR, job.path);
      if (existsSync(target)) {
        skipped++;
        return;
      }
      if (DRY) return;
      try {
        const response = await fetch(job.url);
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        const body = Buffer.from(await response.arrayBuffer());
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, body);
        saved++;
        if (saved % 100 === 0) console.log(`… ${saved} saved`);
      } catch (e) {
        failed++;
        console.warn(`! ${job.path}: ${e.message}`);
      }
    }),
    CONCURRENCY,
  );

  console.log(
    `${DRY ? "[dry run] " : ""}${saved} downloaded · ${skipped} already there · ${failed} failed`,
  );
  console.log(
    "Upload them later with the service-role key: node scripts/mirror-exercise-images.mjs",
  );
}

async function main() {
  if (DOWNLOAD_ONLY) return downloadOnly();
  const created = await ensureBucket();
  console.log(`bucket ${BUCKET}: ${created ? (DRY ? "would be created" : "created") : "exists"}`);

  const have = await existingObjects();
  if (have.size > 0) console.log(`${have.size} objects already in the bucket`);

  let from = 0;
  let rows = 0;
  let uploaded = 0;
  let repointed = 0;
  let failed = 0;

  for (;;) {
    const { data, error } = await supabase
      .from("exercises")
      .select("id, external_id, images")
      .order("external_id")
      .range(from, from + PAGE - 1);
    if (error) fail(`Could not read exercises: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const row of data) {
      const images = row.images ?? [];
      if (images.length === 0) continue;
      if (images.every((u) => u.startsWith(publicBase))) continue;
      rows++;

      let next;
      try {
        next = await pool(
          images.map((url, i) => () => mirrorOne(row.external_id, url, i, have)),
          CONCURRENCY,
        );
      } catch (e) {
        failed++;
        console.warn(`! ${row.external_id}: ${e.message}`);
        continue;
      }
      uploaded += next.filter((r) => !r.skipped).length;

      const urls = next.map((r) => r.publicUrl);
      if (!DRY) {
        const { error: updateError } = await supabase
          .from("exercises")
          .update({ images: urls })
          .eq("id", row.id);
        if (updateError) {
          failed++;
          console.warn(`! ${row.external_id}: update ${updateError.message}`);
          continue;
        }
      }
      repointed++;
      if (repointed % 50 === 0) console.log(`… ${repointed} exercises repointed, ${uploaded} files uploaded`);
      if (LIMIT && repointed >= LIMIT) {
        report({ rows, uploaded, repointed, failed });
        return;
      }
    }

    from += PAGE;
  }

  report({ rows, uploaded, repointed, failed });
}

function report({ rows, uploaded, repointed, failed }) {
  console.log(
    `${DRY ? "[dry run] " : ""}${rows} exercises needed mirroring · ${uploaded} files uploaded · ` +
      `${repointed} rows repointed · ${failed} failed`,
  );
  if (DRY) console.log("Nothing was written. Drop --dry-run to do it.");
  else console.log(`Images now served from ${publicBase}`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

main().catch((e) => fail(e.stack ?? String(e)));
