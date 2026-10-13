import { target } from "./target";

/**
 * The backend as the service role sees it — so a spec can check what really
 * landed in the database, not just what the screen shows, and clean up after
 * itself. It talks to the same PostgREST and GoTrue the app does, through the
 * local stack; target() has already refused anything that is not local.
 */
const t = target();
const headers = { apikey: t.serviceKey, Authorization: `Bearer ${t.serviceKey}`, "Content-Type": "application/json" };

async function call(path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${t.supabaseUrl}${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`backend ${init.method ?? "GET"} ${path}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

/** Rows of a table, filtered with PostgREST syntax: rows("programs", "name=eq.X&select=id,status"). */
export async function rows<T = Record<string, unknown>>(table: string, query: string): Promise<T[]> {
  return (await call(`/rest/v1/${table}?${query}`)) as T[];
}

/** Update rows matching a PostgREST filter as the service role (fixture state only — never what a spec is testing). */
export async function patch(table: string, query: string, values: Record<string, unknown>): Promise<number> {
  const changed = (await call(`/rest/v1/${table}?${query}`, { method: "PATCH", body: JSON.stringify(values), headers: { Prefer: "return=representation" } })) as unknown[];
  if (changed.length === 0) throw new Error(`backend patch ${table}?${query}: no row matched`);
  return changed.length;
}

/** Delete rows matching a PostgREST filter; returns how many went. */
export async function remove(table: string, query: string): Promise<number> {
  const gone = (await call(`/rest/v1/${table}?${query}`, { method: "DELETE", headers: { Prefer: "return=representation" } })) as unknown[];
  return gone.length;
}

/** A user's id from public.users by username (the seed's accounts all have one). */
export async function userId(username: string): Promise<string> {
  const [u] = await rows<{ id: string }>("users", `username=eq.${username}&select=id`);
  if (!u) throw new Error(`no user ${username}`);
  return u.id;
}

/** A one-time recovery link's token, minted by GoTrue's admin API — what the reset email would carry. */
export async function recoveryTokenHash(email: string): Promise<string> {
  const res = (await call("/auth/v1/admin/generate_link", { method: "POST", body: JSON.stringify({ type: "recovery", email }) })) as {
    hashed_token?: string; properties?: { hashed_token?: string };
  };
  const hash = res.properties?.hashed_token ?? res.hashed_token;
  if (!hash) throw new Error("GoTrue returned no hashed_token");
  return hash;
}

/** Set a user's password through GoTrue's admin API (to restore what a spec changed). */
export async function setPassword(email: string, password: string): Promise<void> {
  await call(`/auth/v1/admin/users/${await authId(email)}`, { method: "PUT", body: JSON.stringify({ password }) });
}

async function authId(email: string): Promise<string> {
  const res = (await call(`/auth/v1/admin/users?per_page=200`)) as { users: { id: string; email: string }[] };
  const u = res.users.find((x) => x.email === email);
  if (!u) throw new Error(`no auth user ${email}`);
  return u.id;
}
