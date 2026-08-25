// Offline outbox contract — PRODUCT_SPEC §5 (POST /functions/v1/sync-ingest)
// and §6 (offline rules).
//
// The mobile app owns the outbox; this module holds the rules that the edge
// function and the client must agree on. Idempotency is keyed on
// client_generated_id, which is why a retry storm can never duplicate a set.

export const SYNC_BATCH_MAX = 200;

/** Append-only entities that may be logged offline (§6 tier 1 and 2). */
export type SyncEntity = "logged_session" | "logged_set" | "food_log" | "habit_log";

export type OutboxItem<TPayload = unknown> = {
  entity: SyncEntity;
  op: "upsert";
  /** Client-generated UUID. The idempotency key — never regenerate on retry. */
  client_generated_id: string;
  payload: TPayload;
  /** Orders items within one device only; the server stamps received_at. */
  client_ts: string;
};

export type SyncResultStatus = "applied" | "duplicate" | "error";

export type SyncResult = {
  client_generated_id: string;
  status: SyncResultStatus;
  server_id: string | null;
  error: string | null;
};

export type SyncRequest = { device_id: string; batch: OutboxItem[] };
export type SyncResponse = { results: SyncResult[] };

/** Split the outbox into wire-sized batches, preserving FIFO order. */
export function chunkBatch<T extends OutboxItem>(
  items: readonly T[],
  max: number = SYNC_BATCH_MAX,
): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += max) {
    chunks.push(items.slice(i, i + max));
  }
  return chunks;
}

/**
 * Items still owed to the server: those it rejected, plus any it did not answer
 * for. `duplicate` counts as delivered — the row is already there.
 */
export function itemsToRetry<T extends OutboxItem>(
  sent: readonly T[],
  results: readonly SyncResult[],
): T[] {
  const settled = new Set(
    results.filter((r) => r.status !== "error").map((r) => r.client_generated_id),
  );
  return sent.filter((item) => !settled.has(item.client_generated_id));
}
