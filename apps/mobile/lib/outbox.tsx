import type { LogSetV1 } from "@healthapp/api/v1";
import NetInfo from "@react-native-community/netinfo";
import { useQueryClient } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { sendSet } from "./api";
import { useAuth } from "./auth";
import { dismissRefused, enqueue, flushOutbox, type FlushResult, type OutboxStore, type QueuedSet } from "./outbox-core";
import { OUTBOX_KEY, readJson, writeJson } from "./storage";

// Wires lib/outbox-core.ts to the phone: SQLite storage, the network, and the
// moments a flush makes sense — a set just logged, the signal coming back, the
// app coming to the front, and every 20 s while something waits (the web's rhythm).

const store: OutboxStore = {
  load: async () => (await readJson<QueuedSet[]>(OUTBOX_KEY)) ?? [],
  save: (items) => writeJson(OUTBOX_KEY, items),
};

type Outbox = {
  /** Everything on the phone for the signed-in person, waiting or refused. */
  items: QueuedSet[];
  /** Save a set on the phone, then try to send it. Resolves once it is saved locally. */
  log: (input: LogSetV1) => Promise<QueuedSet>;
  flush: () => Promise<FlushResult | null>;
  dismissRefused: () => Promise<void>;
  /** Called with each set the server took, for the PR moment. */
  onSynced: (listener: (synced: FlushResult["synced"]) => void) => () => void;
};

const OutboxContext = createContext<Outbox | null>(null);

export function OutboxProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const queryClient = useQueryClient();
  const [items, setItems] = useState<QueuedSet[]>([]);
  const running = useRef<Promise<FlushResult | null> | null>(null);
  const listeners = useRef(new Set<(synced: FlushResult["synced"]) => void>());

  const reload = useCallback(async () => {
    const all = await store.load();
    setItems(userId ? all.filter((i) => i.userId === userId) : []);
  }, [userId]);

  const flush = useCallback(() => {
    if (!userId) return Promise.resolve(null);
    if (running.current) return running.current;
    running.current = (async () => {
      const result = await flushOutbox(store, userId, sendSet);
      await reload();
      if (result.synced.length > 0 || result.refused.length > 0) {
        // The days that changed, Today and the list: re-read from the server.
        const days = new Set([...result.synced.map((s) => s.item.input.dayId), ...result.refused.map((r) => r.input.dayId)]);
        for (const dayId of days) void queryClient.invalidateQueries({ queryKey: ["workout", dayId] });
        void queryClient.invalidateQueries({ queryKey: ["workouts"] });
        void queryClient.invalidateQueries({ queryKey: ["today"] });
        for (const listener of listeners.current) listener(result.synced);
      }
      return result;
    })().finally(() => {
      running.current = null;
    });
    return running.current;
  }, [userId, reload, queryClient]);

  const log = useCallback(
    async (input: LogSetV1) => {
      if (!userId) throw new Error("not signed in");
      const item: QueuedSet = { id: randomUUID(), userId, input, queuedAt: new Date().toISOString() };
      await enqueue(store, item);
      await reload();
      void flush();
      return item;
    },
    [userId, reload, flush],
  );

  const dismiss = useCallback(async () => {
    if (userId) await dismissRefused(store, userId);
    await reload();
  }, [userId, reload]);

  const onSynced = useCallback((listener: (synced: FlushResult["synced"]) => void) => {
    listeners.current.add(listener);
    return () => void listeners.current.delete(listener);
  }, []);

  useEffect(() => {
    void reload().then(() => flush());
    const net = NetInfo.addEventListener((state) => {
      if (state.isConnected) void flush();
    });
    const app = AppState.addEventListener("change", (state) => {
      if (state === "active") void flush();
    });
    return () => {
      net();
      app.remove();
    };
  }, [reload, flush]);

  const waiting = items.some((i) => !i.error);
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => void flush(), 20_000);
    return () => clearInterval(timer);
  }, [waiting, flush]);

  const value = useMemo(() => ({ items, log, flush, dismissRefused: dismiss, onSynced }), [items, log, flush, dismiss, onSynced]);
  return <OutboxContext.Provider value={value}>{children}</OutboxContext.Provider>;
}

export function useOutbox(): Outbox {
  const ctx = useContext(OutboxContext);
  if (!ctx) throw new Error("useOutbox must be used inside <OutboxProvider>");
  return ctx;
}
