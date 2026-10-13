// The Supabase service binaries the Docker-less harness runs, at the versions
// the repo's own Supabase CLI starts in Docker (`supabase start`, CLI 2.115.0:
// supabase/gotrue:v2.195.0, postgrest/postgrest:v16.1 — read from the CLI
// binary in node_modules/@supabase/cli-linux-x64). Downloaded once into
// scripts/pgtest/.bin/ (gitignored) and checked against a pinned SHA-256.
//
// Only Linux x64 is fetched automatically; elsewhere set PGRST_BIN /
// GOTRUE_BIN to binaries of the same versions (GOTRUE_BIN's directory must
// hold the release's `migrations/` folder, as the archive lays it out).
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN_DIR = path.join(HERE, ".bin");

const RELEASES = {
  postgrest: {
    env: "PGRST_BIN",
    version: "v16.1",
    url: "https://github.com/PostgREST/postgrest/releases/download/v16.1/postgrest-v16.1-linux-static-x86-64.tar.xz",
    sha256: "b986c926cf16a1c5d97954c57d3a6edd894a5da225c3f3fc0c25dc4105009dd7",
    dir: "postgrest-v16.1",
    exe: "postgrest",
    untar: ["-xJf"],
  },
  gotrue: {
    env: "GOTRUE_BIN",
    version: "v2.195.0",
    url: "https://github.com/supabase/auth/releases/download/v2.195.0/auth-v2.195.0-x86.tar.gz",
    sha256: "26256174b8f30ddcecadd41e392cb73132b837226ec764f8a7b45f7d78a1c8d5",
    dir: "gotrue-v2.195.0",
    exe: "auth",
    untar: ["-xzf"],
  },
};

/** Absolute path of the binary, downloading and verifying it on first use. */
export async function binary(name) {
  const r = RELEASES[name];
  if (process.env[r.env]) return process.env[r.env];
  const dir = path.join(BIN_DIR, r.dir);
  const exe = path.join(dir, r.exe);
  if (existsSync(exe)) return exe;
  if (process.platform !== "linux" || process.arch !== "x64") {
    throw new Error(`No ${name} here. Download ${r.version} for this platform and set ${r.env} (see scripts/pgtest/README.md).`);
  }
  const res = await fetch(r.url);
  if (!res.ok) throw new Error(`${name} download failed: ${res.status} ${r.url}`);
  const archive = Buffer.from(await res.arrayBuffer());
  const sum = createHash("sha256").update(archive).digest("hex");
  if (sum !== r.sha256) throw new Error(`${name} archive checksum mismatch: ${sum}`);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, path.basename(r.url));
  writeFileSync(file, archive);
  execFileSync("tar", [...r.untar, file], { cwd: dir });
  return exe;
}

export const VERSIONS = Object.fromEntries(Object.entries(RELEASES).map(([k, v]) => [k, v.version]));
