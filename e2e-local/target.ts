import { ANON_KEY, APP_URL, SERVICE_KEY, SUPABASE_URL } from "../scripts/pgtest/stack-env.mjs";
import { resolveLocalTarget } from "../scripts/lib/local-target.mjs";

/**
 * Where the local suite runs, and the guard that keeps it there.
 *
 * This suite WRITES: it signs in with its own seeded accounts, creates and
 * deletes programs and plans, sends coaching requests, and changes one
 * account's password. It must never reach the live project. The rules live in
 * scripts/lib/local-target.mjs (unit-tested by `npm test`): every Supabase and
 * app address must be this machine, a key issued for a hosted project is
 * refused, and the app's own Supabase variables may not point elsewhere either.
 * A refusal stops the run at config load, before any server starts.
 *
 *  - nothing set: the Docker-less stack (scripts/pgtest/stack.mjs) with its fixed
 *    local keys, started by the Playwright config, app on APP_URL;
 *  - E2E_SUPABASE_URL / _ANON_KEY / _SERVICE_KEY + E2E_LOCAL_BASE_URL: a stack and
 *    an app already running, e.g. `supabase start` in CI (still checked).
 */
export type Target = {
  supabaseUrl: string; anonKey: string; serviceKey: string; appUrl: string;
  /** true when the stack and the app are already running (CI); false when the config starts them */
  external: boolean;
};

export function target(): Target {
  return resolveLocalTarget(process.env, { supabaseUrl: SUPABASE_URL, anonKey: ANON_KEY, serviceKey: SERVICE_KEY, appUrl: APP_URL });
}
