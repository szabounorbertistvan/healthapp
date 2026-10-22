#!/usr/bin/env node
// npm run e2e:soak — the soak trio (a coach, their client, a solo trainee)
// play the app against each other round after round, on a throwaway LOCAL
// stack, until stopped. See e2e-local/soak/README.md.
//
//   npm run e2e:soak                       until Ctrl+C
//   npm run e2e:soak -- --rounds 3         three rounds, then stop
//   npm run e2e:soak -- --hours 8          for eight hours
//   npm run e2e:soak -- --pause 120        two minutes between rounds (default 30 s)
//   npm run e2e:soak -- --grep messages    only the journeys whose title matches
//   npm run e2e:soak -- --no-build         reuse the last build (apps/web/.next-soak)
//   npm run e2e:soak -- --serve            start the stack and the app, run no rounds (to look around
//                                          by hand as the trio; Ctrl+C stops it)
//
// Once: the Docker-less Supabase (scripts/pgtest/stack.mjs, fresh database and
// seed), then a production build of the app wired to it — built into
// apps/web/.next-soak, so a dev server on the same tree is never clobbered —
// served on http://localhost:3211. Then rounds of playwright.soak.config.ts.
// Every round is one line in e2e-local/.soak/log.md; a failed round keeps its
// traces and screenshots in e2e-local/.soak/round-<n>/, and summary.md counts
// how often each failure came back.
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ANON_KEY, SERVICE_KEY, STACK, SUPABASE_URL } from "./pgtest/stack-env.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_PORT = 3211;
const APP_URL = `http://localhost:${APP_PORT}`;
const OUT = path.join(root, "e2e-local", ".soak");
const win = process.platform === "win32";

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const rounds = opt("rounds") ? Number(opt("rounds")) : Infinity;
const until = opt("hours") ? Date.now() + Number(opt("hours")) * 3_600_000 : Infinity;
const pauseMs = (opt("pause") ? Number(opt("pause")) : 30) * 1000;
const grep = opt("grep");
const build = !args.includes("--no-build");
const serveOnly = args.includes("--serve");

// The Windows builds of GoTrue / PostgREST live in .tools/ (e2e-local/README.md, "Windows").
const env = { ...process.env };
if (win) {
  const tool = (p) => path.join(root, ".tools", p);
  if (!env.PGRST_BIN && existsSync(tool("postgrest/postgrest.exe"))) env.PGRST_BIN = tool("postgrest/postgrest.exe");
  if (!env.GOTRUE_BIN && existsSync(tool("gotrue/auth.exe"))) env.GOTRUE_BIN = tool("gotrue/auth.exe");
  const libpq = path.join(root, "scripts/pgtest/node_modules/@embedded-postgres/windows-x64/native/bin");
  if (existsSync(libpq)) env.PATH = `${libpq}${path.delimiter}${env.PATH ?? env.Path ?? ""}`;
}

// The app sees the local stack and nothing else: the live services a developer
// keeps in apps/web/.env.local are blanked, as in playwright.local.config.ts.
const appEnv = {
  ...env,
  NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY,
  NEXT_PUBLIC_SITE_URL: APP_URL,
  SUPABASE_URL: "",
  SUPABASE_SERVICE_ROLE_KEY: "",
  STRIPE_SECRET_KEY: "",
  CLOUDINARY_CLOUD_NAME: "", CLOUDINARY_API_KEY: "", CLOUDINARY_API_SECRET: "",
  GOOGLE_PLACES_API_KEY: "",
  NEXT_PUBLIC_GA_ID: "",
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: "",
  NEXT_DIST_DIR: ".next-soak",
};

const children = [];
function start(name, cmd, argv, opts) {
  const child = spawn(cmd, argv, { cwd: root, shell: win, stdio: ["ignore", "pipe", "pipe"], ...opts });
  const log = path.join(OUT, `${name}.log`);
  child.stdout.on("data", (d) => appendFileSync(log, d));
  child.stderr.on("data", (d) => appendFileSync(log, d));
  child.on("exit", (code) => { if (!stopping) fail(`${name} exited (${code}) — see ${path.relative(root, log)}`); });
  children.push(child);
  return child;
}

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children) {
    if (c.exitCode !== null) continue;
    // a shell-spawned child on Windows is a tree: kill all of it
    if (win) spawnSync("taskkill", ["/pid", String(c.pid), "/T", "/F"], { stdio: "ignore" });
    else c.kill("SIGTERM");
  }
  // taskkill /T misses the embedded Postgres's workers, which keep port 54430
  // and make the next run refuse to start: stop whatever still listens on ours
  if (win) {
    const ports = [STACK.dbPort, STACK.gotruePort, STACK.restPort, STACK.gatewayPort, APP_PORT].join(",");
    spawnSync("powershell", ["-NoProfile", "-Command",
      `foreach ($p in ${ports}) { Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | ForEach-Object { $o = $_.OwningProcess; Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -eq $o -or $_.ParentProcessId -eq $o } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } } }`],
      { stdio: "ignore" });
  }
  process.exit(code);
}
function fail(message) { console.error(`[soak] ${message}`); stop(1); }
process.on("SIGINT", () => { console.log("\n[soak] stopping"); stop(0); });
process.on("SIGTERM", () => stop(0));

const portBusy = (port) => new Promise((resolve) => {
  const s = net.connect({ port, host: "127.0.0.1" }, () => { s.destroy(); resolve(true); });
  s.on("error", () => resolve(false));
});
async function waitFor(url, ms, label) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if ((await fetch(url)).status < 500) return; } catch {}
    await new Promise((r) => setTimeout(r, 2000));
  }
  fail(`${label} did not come up at ${url}`);
}
// npx is a .cmd on Windows, which only runs through a shell: quote what cmd.exe would read (| & < > ^ spaces)
const shellArg = (a) => (win && /[s|&<>^()"]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a);
const run = (cmd, argv, opts) => new Promise((resolve) => {
  const child = spawn(cmd, argv.map(shellArg), { cwd: root, shell: win, stdio: "inherit", ...opts });
  children.push(child);
  child.on("exit", (code) => resolve(code ?? 1));
});

// ---------- once: stack + app ----------

mkdirSync(OUT, { recursive: true });
for (const port of [STACK.dbPort, STACK.gotruePort, STACK.restPort, STACK.gatewayPort, APP_PORT]) {
  // never adopt a server someone else started: it could be wired to the live project
  if (await portBusy(port)) fail(`port ${port} is already in use — stop whatever holds it (a stack or app from an earlier run?) and try again`);
}
for (const f of ["stack.log", "app.log"]) rmSync(path.join(OUT, f), { force: true });

console.log("[soak] starting the local stack (fresh database + seed)…");
start("stack", "node", ["scripts/pgtest/stack.mjs"], { env: { ...env, STACK_EXTRA_SEEDS: "usda-foods.sql" } });
await waitFor(`${SUPABASE_URL}/health`, 600_000, "the local stack");

if (build || !existsSync(path.join(root, "apps/web/.next-soak/BUILD_ID"))) {
  console.log("[soak] building the app against it (apps/web/.next-soak)…");
  const code = await run("npx", ["next", "build"], { cwd: path.join(root, "apps/web"), env: appEnv });
  if (code !== 0) fail(`next build failed (${code})`);
}
console.log(`[soak] serving it on ${APP_URL}`);
start("app", "npx", ["next", "start", "-p", String(APP_PORT), "-H", "localhost"], { cwd: path.join(root, "apps/web"), env: appEnv });
await waitFor(APP_URL, 120_000, "the app");
if (serveOnly) {
  console.log(`[soak] serving only: ${APP_URL} — sign in as e2e-soak-coach / e2e-soak-client / e2e-soak-solo @voinic.test, password Voinic-E2E-local-1. Ctrl+C stops.`);
  await new Promise(() => {});
}

// ---------- rounds ----------

const testEnv = {
  ...env,
  E2E_SUPABASE_URL: SUPABASE_URL,
  E2E_SUPABASE_ANON_KEY: ANON_KEY,
  E2E_SUPABASE_SERVICE_KEY: SERVICE_KEY,
  E2E_LOCAL_BASE_URL: APP_URL,
};
const logFile = path.join(OUT, "log.md");
const summaryFile = path.join(OUT, "summary.md");
if (!existsSync(logFile)) writeFileSync(logFile, "# Soak rounds\n\n| round | started | passed | failed | skipped | minutes | failures |\n|---|---|---|---|---|---|---|\n");
const seen = existsSync(path.join(OUT, "failures.json")) ? JSON.parse(readFileSync(path.join(OUT, "failures.json"), "utf8")) : {};
// things a round noticed without failing on (a test annotation of type "finding")
const found = existsSync(path.join(OUT, "findings.json")) ? JSON.parse(readFileSync(path.join(OUT, "findings.json"), "utf8")) : {};
// numbering carries on across runs: a round is a row of log.md
let round = readFileSync(logFile, "utf8").split("\n").filter((l) => /^\| \d+ \|/.test(l)).length;

/** Every failed test of a Playwright JSON report: its title path and the first line of its error. */
function failures(report, findings = []) {
  const out = [];
  const walk = (suite, titles) => {
    for (const s of suite.suites ?? []) walk(s, [...titles, s.title].filter(Boolean));
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        const r = t.results?.at(-1);
        for (const a of t.annotations ?? []) if (a.type === "finding") findings.push(`${a.description} [${t.projectName}]`);
        if (t.status === "unexpected" || t.status === "flaky") {
          const msg = (r?.error?.message ?? r?.errors?.[0]?.message ?? "").replace(/\u001b\[[0-9;]*m/g, "").split("\n").find((l) => l.trim()) ?? "";
          out.push({ title: [...titles, spec.title].filter((x) => !/\.spec\.ts$/.test(x)).join(" › ") + ` [${t.projectName}]`, error: msg.trim().slice(0, 200) });
        }
      }
    }
  };
  walk(report, []);
  return out;
}

for (let i = 0; i < rounds && Date.now() < until; i++) {
  round += 1;
  const dir = path.join(OUT, `round-${round}`);
  rmSync(dir, { recursive: true, force: true });
  const started = new Date();
  console.log(`\n[soak] round ${round} — ${started.toLocaleString()}`);
  const argv = ["playwright", "test", "-c", "playwright.soak.config.ts", ...(grep ? ["--grep", grep] : [])];
  await run("npx", argv, { env: { ...testEnv, SOAK_OUTPUT_DIR: dir, SOAK_JSON: path.join(dir, "results.json") } });
  if (stopping) break;

  let report = null;
  try { report = JSON.parse(readFileSync(path.join(dir, "results.json"), "utf8")); } catch {}
  const st = report?.stats ?? {};
  const roundFindings = [];
  const failed = report ? failures(report, roundFindings) : [{ title: "the round itself", error: "no results.json — Playwright did not finish" }];
  for (const f of new Set(roundFindings)) {
    const s = (found[f] ??= { count: 0, firstRound: round, lastRound: round });
    s.count += 1; s.lastRound = round;
  }
  const minutes = ((Date.now() - started.getTime()) / 60000).toFixed(1);
  const cell = failed.map((f) => f.title).join("<br>").replace(/\|/g, "\\|") || "—";
  appendFileSync(logFile, `| ${round} | ${started.toISOString().slice(0, 16).replace("T", " ")} | ${st.expected ?? 0} | ${failed.length} | ${st.skipped ?? 0} | ${minutes} | ${cell} |\n`);

  for (const f of failed) {
    const s = (seen[f.title] ??= { count: 0, firstRound: round, lastRound: round, error: f.error });
    s.count += 1; s.lastRound = round; s.error = f.error;
  }
  writeFileSync(path.join(OUT, "failures.json"), JSON.stringify(seen, null, 2));
  writeFileSync(path.join(OUT, "findings.json"), JSON.stringify(found, null, 2));
  const findingLines = Object.entries(found).sort((a, b) => b[1].count - a[1].count)
    .map(([what, s]) => `| ${s.count} | ${s.firstRound} | ${s.lastRound} | ${what.replace(/\|/g, "\\|")} |`);
  const lines = Object.entries(seen).sort((a, b) => b[1].count - a[1].count)
    .map(([title, s]) => `| ${s.count} | ${s.firstRound} | ${s.lastRound} | ${title.replace(/\|/g, "\\|")} | ${s.error.replace(/\|/g, "\\|")} |`);
  writeFileSync(summaryFile, `# Soak failures (${round} rounds so far)\n\nTraces of a failed round: \`npx playwright show-trace e2e-local/.soak/round-<n>/<test>/trace.zip\`.\n\n| times | first round | last round | test | error |\n|---|---|---|---|---|\n${lines.join("\n") || "| — | | | nothing has failed | |"}\n\n## Findings (noticed, not failed)\n\nRounds in which each was seen — e.g. a streamed copy of a page left hidden in the DOM (docs/GAPS.md).\n\n| rounds | first | last | finding |\n|---|---|---|---|\n${findingLines.join("\n") || "| — | | | none |"}\n`);

  if (failed.length === 0) rmSync(dir, { recursive: true, force: true }); // a clean round leaves nothing behind
  console.log(`[soak] round ${round}: ${st.expected ?? 0} passed, ${failed.length} failed, ${st.skipped ?? 0} skipped (${minutes} min) — e2e-local/.soak/log.md`);
  if (i + 1 < rounds && Date.now() + pauseMs < until) await new Promise((r) => setTimeout(r, pauseMs));
}
console.log("[soak] done");
stop(0);
