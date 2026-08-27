// One-off dev seeding: creates the three role accounts (admin / coach / client)
// on the Supabase project in apps/web/.env.local and links the coach to the
// client with an active relationship.
//
// Needs the SERVICE ROLE key — role and relationship rows are service-role
// writes by design (see 20260823001100_subscriptions.sql: `users` has no
// self-update policy for `role`, and engine/admin tables have no write
// policies at all). Put it in the environment, never in a committed file:
//
//   $env:SUPABASE_SERVICE_ROLE_KEY = "sb_secret_..."   # PowerShell
//   node scripts/seed-accounts.mjs
//
// Safe to re-run: existing accounts get their password and role reset rather
// than duplicated. Tiers are left alone — handle_new_profile() stamps a 30-day
// trial and effective_tier() grants coach_pro / premium for its duration.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

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
const PASSWORD = process.env.SEED_PASSWORD ?? "HealthApp!Dev2026";
const DOMAIN = process.env.SEED_DOMAIN ?? "healthapp.test";

if (!URL_) fail("NEXT_PUBLIC_SUPABASE_URL is not set (apps/web/.env.local or the environment).");
if (!KEY) fail("SUPABASE_SERVICE_ROLE_KEY is not set. Supabase dashboard → Project Settings → API keys → service_role.");
if (KEY.startsWith("sb_publishable_") || KEY.includes("anon"))
  fail("That looks like the publishable/anon key. This script needs the service_role (secret) key.");
if (KEY.endsWith("...") || KEY.length < 30)
  fail(`SUPABASE_SERVICE_ROLE_KEY is still the placeholder ("${KEY}"). Paste the real service_role key over it.`);

const ACCOUNTS = [
  { key: "admin",  email: `admin@${DOMAIN}`,   role: "admin",  full_name: "Admin HealthApp" },
  { key: "coach",  email: `trainer@${DOMAIN}`, role: "coach",  full_name: "Andrei Trainer" },
  { key: "client", email: `client@${DOMAIN}`,  role: "client", full_name: "Maria Client" },
];

function fail(msg) {
  console.error(`\n  ${msg}\n`);
  process.exit(1);
}

async function api(path, { method = "GET", body, headers = {} } = {}) {
  const res = await fetch(`${URL_}${path}`, {
    method,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const detail = data?.msg ?? data?.message ?? data?.error_description ?? text;
    throw new Error(`${method} ${path} → ${res.status}: ${detail}`);
  }
  return data;
}

/** GoTrue has no email filter on the admin list, so page until we find it. */
async function findAuthUser(email) {
  for (let page = 1; page <= 20; page++) {
    const { users = [] } = await api(`/auth/v1/admin/users?page=${page}&per_page=200`);
    const hit = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit;
    if (users.length < 200) return null;
  }
  return null;
}

async function upsertAuthUser({ email, full_name }) {
  try {
    const created = await api("/auth/v1/admin/users", {
      method: "POST",
      body: { email, password: PASSWORD, email_confirm: true, user_metadata: { full_name } },
    });
    return { id: created.id, existed: false };
  } catch (err) {
    if (!/already been registered|email_exists|422/i.test(err.message)) throw err;
    const existing = await findAuthUser(email);
    if (!existing) throw err;
    await api(`/auth/v1/admin/users/${existing.id}`, {
      method: "PUT",
      body: { password: PASSWORD, email_confirm: true, user_metadata: { full_name } },
    });
    return { id: existing.id, existed: true };
  }
}

async function setProfile(id, { role, full_name }) {
  // handle_new_user() already inserted the row; correct the role it can't know.
  const rows = await api(`/rest/v1/users?id=eq.${id}`, {
    method: "PATCH",
    body: { role, full_name },
    headers: { Prefer: "return=representation" },
  });
  if (!rows?.length) throw new Error(`public.users row missing for ${id} — is the on_auth_user_created trigger installed?`);
}

async function linkCoachToClient(coachId, clientId) {
  const active = await api(
    `/rest/v1/trainer_clients?client_id=eq.${clientId}&status=eq.active&select=id,coach_id`,
  );
  if (active.length) {
    if (active[0].coach_id === coachId) return "already linked";
    // one_active_coach_per_client is a partial unique index — retire the old one.
    await api(`/rest/v1/trainer_clients?id=eq.${active[0].id}`, {
      method: "PATCH",
      body: { status: "ended", ended_at: new Date().toISOString() },
    });
  }
  await api("/rest/v1/trainer_clients", {
    method: "POST",
    body: {
      coach_id: coachId,
      client_id: clientId,
      status: "active",
      started_at: new Date().toISOString(),
    },
  });
  return "linked";
}

const ids = {};
console.log(`\n  Seeding accounts on ${URL_}\n`);

for (const account of ACCOUNTS) {
  const { id, existed } = await upsertAuthUser(account);
  await setProfile(id, account);
  ids[account.key] = id;
  console.log(`  ${existed ? "updated" : "created"}  ${account.role.padEnd(6)}  ${account.email}`);
}

console.log(`  ${await linkCoachToClient(ids.coach, ids.client)}  coach → client\n`);

console.log("  Sign in at http://localhost:3000/login with password:", PASSWORD);
for (const a of ACCOUNTS) console.log(`    ${a.role.padEnd(6)}  ${a.email}`);
console.log("");
