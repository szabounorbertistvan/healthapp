import { describe, expect, test } from "vitest";
import { SYNC_BATCH_MAX, chunkBatch, itemsToRetry, type OutboxItem, type SyncResult } from "./sync";

// PRODUCT_SPEC §5 (sync-ingest) and §6 (offline rules). The outbox is FIFO,
// batches cap at 200, and only `error` items are retried — a `duplicate` means
// the server already has it, so retrying forever would never terminate.

const item = (id: string): OutboxItem => ({
  entity: "logged_set",
  op: "upsert",
  client_generated_id: id,
  payload: { reps: 8, weight: 80 },
  client_ts: "2026-08-25T10:00:00.000Z",
});

describe("chunkBatch", () => {
  test("caps a batch at the documented maximum", () => {
    const chunks = chunkBatch(Array.from({ length: 450 }, (_, n) => item(`s${n}`)));

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(SYNC_BATCH_MAX);
    expect(chunks[2]).toHaveLength(50);
  });

  test("preserves outbox order so sets replay as they were performed", () => {
    const chunks = chunkBatch([item("a"), item("b"), item("c")], 2);

    expect(chunks[0]?.map((i) => i.client_generated_id)).toEqual(["a", "b"]);
    expect(chunks[1]?.map((i) => i.client_generated_id)).toEqual(["c"]);
  });

  test("produces no batches for an empty outbox", () => {
    expect(chunkBatch([])).toEqual([]);
  });
});

describe("itemsToRetry", () => {
  const sent = [item("a"), item("b"), item("c")];

  test("retries only the items the server rejected", () => {
    const results: SyncResult[] = [
      { client_generated_id: "a", status: "applied", server_id: "1", error: null },
      { client_generated_id: "b", status: "error", server_id: null, error: "constraint" },
      { client_generated_id: "c", status: "applied", server_id: "2", error: null },
    ];

    expect(itemsToRetry(sent, results).map((i) => i.client_generated_id)).toEqual(["b"]);
  });

  test("treats a duplicate as delivered so retries terminate", () => {
    const results: SyncResult[] = [
      { client_generated_id: "a", status: "duplicate", server_id: "1", error: null },
      { client_generated_id: "b", status: "applied", server_id: "2", error: null },
      { client_generated_id: "c", status: "applied", server_id: "3", error: null },
    ];

    expect(itemsToRetry(sent, results)).toEqual([]);
  });

  test("keeps items the server never answered for", () => {
    const results: SyncResult[] = [
      { client_generated_id: "a", status: "applied", server_id: "1", error: null },
    ];

    expect(itemsToRetry(sent, results).map((i) => i.client_generated_id)).toEqual(["b", "c"]);
  });
});
