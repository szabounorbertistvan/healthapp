// BuddyGym · sync-ingest edge function
// Flushes the mobile outbox (PRODUCT_SPEC §5, offline rules §6).
// POST /functions/v1/sync-ingest  — user JWT, max 200 items per batch.
//
// Idempotency is the whole point: every row carries a client_generated_id with a
// unique index, so a device that retries forever can never create a duplicate
// set. A second arrival is reported as `duplicate`, not an error, which is what
// lets the client stop retrying it.
//
// The client is never trusted for user_id: the row is written through the
// caller's own JWT, so RLS decides what may land.
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

const BATCH_MAX = 200; // mirrored in packages/shared/src/sync.ts

type Entity = "logged_session" | "logged_set" | "food_log" | "habit_log";

type OutboxItem = {
  entity: Entity;
  op: "upsert";
  client_generated_id: string;
  payload: Record<string, unknown>;
  client_ts?: string;
};

type Result = {
  client_generated_id: string;
  status: "applied" | "duplicate" | "error";
  server_id: string | null;
  error: string | null;
};

// Only these columns may come from a device. Anything else is dropped rather
// than rejected — an older app version sending an unknown field still syncs.
const TABLES: Record<Entity, { table: string; columns: string[] }> = {
  logged_session: {
    table: "logged_sessions",
    columns: ["program_day_id", "started_at", "completed_at", "notes"],
  },
  logged_set: {
    table: "logged_sets",
    columns: [
      "session_id", "program_exercise_id", "exercise_id", "set_index",
      "reps", "weight_kg", "rpe", "effort", "is_pr", "notes", "client_ts",
    ],
  },
  food_log: {
    table: "food_logs",
    columns: [
      "date", "slot", "food_id", "food_name", "grams", "kcal",
      "protein_g", "carbs_g", "fat_g", "method", "client_ts",
    ],
  },
  habit_log: { table: "habit_logs", columns: ["habit_id", "date"] },
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace("Bearer ", "");
  if (!jwt) return json({ error: "unauthorized" }, 401);

  // Acting as the caller, not as service role: RLS stays in force.
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
  );

  const { data: userData, error: authError } = await supabase.auth.getUser(jwt);
  if (authError || !userData.user) return json({ error: "unauthorized" }, 401);
  const userId = userData.user.id;

  let body: { device_id?: string; batch?: OutboxItem[] };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const batch = body.batch ?? [];
  if (!Array.isArray(batch)) return json({ error: "invalid_batch" }, 400);
  if (batch.length > BATCH_MAX) return json({ error: "batch_too_large", max: BATCH_MAX }, 400);

  // Sessions before sets, so a set can resolve the session it belongs to even
  // when both were created offline in the same flush.
  const ordered = [...batch].sort((a, b) => weight(a.entity) - weight(b.entity));

  const results: Result[] = [];
  for (const item of ordered) {
    // One malformed item must never cost the other 199 their flush: every
    // failure is reported per item, not as a 500 for the whole batch.
    try {
      results.push(await applyItem(supabase, userId, item));
    } catch (e) {
      results.push(fail(item, e instanceof Error ? e.message : "unexpected_error"));
    }
  }

  return json({ results });
});

async function applyItem(
  supabase: SupabaseClient,
  userId: string,
  item: OutboxItem,
): Promise<Result> {
  // hasOwnProperty, not a bare index: "constructor" and friends resolve on
  // Object.prototype and would sail past a truthiness check.
  const spec = Object.prototype.hasOwnProperty.call(TABLES, item.entity)
    ? TABLES[item.entity]
    : undefined;
  if (!spec || item.op !== "upsert") {
    return fail(item, "unsupported_entity");
  }
  if (!item.client_generated_id) {
    return fail(item, "missing_client_generated_id");
  }

  const row: Record<string, unknown> = {
    user_id: userId,
    client_generated_id: item.client_generated_id,
  };
  for (const column of spec.columns) {
    if (item.payload?.[column] !== undefined) row[column] = item.payload[column];
  }

  // A set logged offline references its session by client id — the server id
  // did not exist yet on the device.
  if (item.entity === "logged_set" && !row.session_id) {
    const sessionClientId = item.payload?.session_client_id;
    if (typeof sessionClientId !== "string") return fail(item, "missing_session_reference");
    const { data: session } = await supabase
      .from("logged_sessions")
      .select("id")
      .eq("client_generated_id", sessionClientId)
      .maybeSingle();
    if (!session) return fail(item, "unknown_session");
    row.session_id = session.id;
  }

  const { data, error } = await supabase
    .from(spec.table)
    .insert(row)
    .select("id")
    .single();

  if (!error) {
    return { client_generated_id: item.client_generated_id, status: "applied", server_id: data.id, error: null };
  }

  // 23505 = unique_violation on client_generated_id: we already have this row.
  if (error.code === "23505") {
    const { data: existing } = await supabase
      .from(spec.table)
      .select("id")
      .eq("client_generated_id", item.client_generated_id)
      .maybeSingle();
    return {
      client_generated_id: item.client_generated_id,
      status: "duplicate",
      server_id: existing?.id ?? null,
      error: null,
    };
  }

  return fail(item, error.message);
}

function weight(entity: Entity): number {
  return entity === "logged_session" ? 0 : 1;
}

function fail(item: OutboxItem, message: string): Result {
  return {
    client_generated_id: item.client_generated_id ?? "",
    status: "error",
    server_id: null,
    error: message,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
