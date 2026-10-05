"use client";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { sharedContext } from "@/lib/shared-context";
import { useRouter } from "next/navigation";
import { logSet, type LogSetInput } from "@/app/client-actions-app";
import { listQueued, outboxAvailable, putQueued, removeQueued, type QueuedSet } from "./outbox";

/**
 * Replays the offline outbox (./outbox.ts) through logSet() whenever there is
 * a chance of a connection: on mount, when the browser says it is back
 * online, when the tab comes back into view, and every 20 s while anything is
 * waiting. Mounted once in (client)/layout.tsx, so a set queued in the logger
 * still syncs after the person has moved on to Today.
 *
 * Items go one at a time, oldest first. A network failure stops the round
 * (the rest would fail the same way); an answer that refuses an item marks it
 * failed — it will not succeed on a retry — and the round carries on.
 */
type OfflineSets = {
  /** Items not yet on the server, failed ones included. */
  queued: QueuedSet[];
  /** Write a set to the outbox. False when this browser cannot hold one. */
  queue: (dayId: string, input: LogSetInput & { loggedAt: string }) => Promise<QueuedSet | null>;
  /** One replay round; resolves with what is still queued afterwards. */
  flush: () => Promise<QueuedSet[]>;
  /** Forget the failed items (after the person has read why). */
  dismissFailed: () => Promise<void>;
};

const Context = sharedContext<OfflineSets | null>("offline-sets", null);

const RETRY_MS = 20_000;

export function OfflineSetsProvider({ userId, children }: { userId: string; children: React.ReactNode }) {
  const router = useRouter();
  const [queued, setQueued] = useState<QueuedSet[]>([]);
  const running = useRef<Promise<QueuedSet[]> | null>(null);

  const reload = useCallback(async () => {
    const items = await listQueued(userId);
    setQueued(items);
    return items;
  }, [userId]);

  const flush = useCallback(() => {
    if (running.current) return running.current;
    running.current = (async () => {
      const items = (await listQueued(userId)).filter((item) => !item.error);
      let synced = 0;
      for (const item of items) {
        let result: Awaited<ReturnType<typeof logSet>>;
        try {
          result = await logSet(item.input);
        } catch {
          break; // still offline, or the request died: try again later
        }
        if (result.ok) {
          await removeQueued(item.id);
          synced++;
        } else {
          await putQueued({ ...item, error: result.message ?? "" });
        }
      }
      const left = await reload();
      // The set logger swaps its outbox rows for the server's on this refresh.
      if (synced > 0) router.refresh();
      return left;
    })().finally(() => {
      running.current = null;
    });
    return running.current;
  }, [userId, reload, router]);

  const queue = useCallback<OfflineSets["queue"]>(
    async (dayId, input) => {
      if (!outboxAvailable()) return null;
      const item: QueuedSet = { id: crypto.randomUUID(), userId, dayId, input, queuedAt: new Date().toISOString() };
      if (!(await putQueued(item))) return null;
      await reload();
      return item;
    },
    [userId, reload],
  );

  const dismissFailed = useCallback(async () => {
    for (const item of await listQueued(userId)) if (item.error) await removeQueued(item.id);
    await reload();
  }, [userId, reload]);

  useEffect(() => {
    void flush();
    const onOnline = () => void flush();
    const onVisible = () => {
      if (document.visibilityState === "visible") void flush();
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [reload, flush]);

  const waiting = queued.some((item) => !item.error);
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => {
      if (navigator.onLine !== false) void flush();
    }, RETRY_MS);
    return () => window.clearInterval(timer);
  }, [waiting, flush]);

  const value = useMemo(() => ({ queued, queue, flush, dismissFailed }), [queued, queue, flush, dismissFailed]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useOfflineSets(): OfflineSets {
  const ctx = useContext(Context);
  if (!ctx) throw new Error("useOfflineSets must be used inside <OfflineSetsProvider>");
  return ctx;
}
