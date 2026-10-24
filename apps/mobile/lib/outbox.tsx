import type { LogSetV1 } from "@healthapp/api/v1";
import NetInfo from "@react-native-community/netinfo";
import { useQueryClient } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { sendItem } from "./api";
import { useAuth } from "./auth";
import {
  dismissRefused, enqueue, flushOutbox, loadItems, type FlushResult, type OutboxPayload, type OutboxStore, type QueuedItem,
} from "./outbox-core";
import { OUTBOX_KEY, readJson, writeJson } from "./storage";

// Wires lib/outbox-core.ts to the phone: SQLite storage, the network, and the
// moments a flush makes sense — a set just logged, the signal coming back, the
// app coming to the front, and every 20 s while something waits (the web's rhythm).
// Sets, food logs, habit ticks and check-ins all go through it (outbox-core.ts).

const store: OutboxStore = {
  load: async () => (await readJson<QueuedItem[]>(OUTBOX_KEY)) ?? [],
  save: (items) => writeJson(OUTBOX_KEY, items),
};

type Outbox = {
  /** Everything on the phone for the signed-in person, waiting or refused. */
  items: QueuedItem[];
  /** Save a write on the phone, then try to send it. Resolves once it is saved locally. */
  queue: (payload: OutboxPayload) => Promise<QueuedItem>;
  /** A set — the logger's shorthand for queue({ kind: "set" }). */
  log: (input: LogSetV1) => Promise<QueuedItem>;
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
  const [items, setItems] = useState<QueuedItem[]>([]);
  const running = useRef<Promise<FlushResult | null> | null>(null);
  const listeners = useRef(new Set<(synced: FlushResult["synced"]) => void>());

  const reload = useCallback(async () => {
    const all = await loadItems(store);
    setItems(userId ? all.filter((i) => i.userId === userId) : []);
  }, [userId]);

  const flush = useCallback(() => {
    if (!userId) return Promise.resolve(null);
    if (running.current) return running.current;
    running.current = (async () => {
      const result = await flushOutbox(store, userId, sendItem);
      await reload();
      if (result.synced.length > 0 || result.refused.length > 0) {
        // Whatever the delivered writes touch is re-read from the server.
        const touched = [...result.synced.map((s) => s.item), ...result.refused];
        for (const item of touched) {
          if (item.kind === "set") void queryClient.invalidateQueries({ queryKey: ["workout", item.input.dayId] });
        }
        const kinds = new Set(touched.map((item) => item.kind));
        // Every cached diary day: the one shown first is cached as "today", not by its date.
        if (kinds.has("food")) void queryClient.invalidateQueries({ queryKey: ["food"] });
        if (kinds.has("set")) void queryClient.invalidateQueries({ queryKey: ["workouts"] });
        if (kinds.has("habit")) void queryClient.invalidateQueries({ queryKey: ["habits"] });
        if (kinds.has("checkin")) {
          void queryClient.invalidateQueries({ queryKey: ["check-in"] });
          void queryClient.invalidateQueries({ queryKey: ["progress"] });
        }
        void queryClient.invalidateQueries({ queryKey: ["today"] });
        for (const listener of listeners.current) listener(result.synced);
      }
      return result;
    })().finally(() => {
      running.current = null;
    });
    return running.current;
  }, [userId, reload, queryClient]);

  const queue = useCallback(
    async (payload: OutboxPayload) => {
      if (!userId) throw new Error("not signed in");
      // A food log's id doubles as its clientId on the server: one id, one row.
      const id = payload.kind === "food" ? payload.input.clientId : randomUUID();
      const item = { ...payload, id, userId, queuedAt: new Date().toISOString() } as QueuedItem;
      await enqueue(store, item);
      await reload();
      void flush();
      return item;
    },
    [userId, reload, flush],
  );
  const log = useCallback((input: LogSetV1) => queue({ kind: "set", input }), [queue]);

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

  const value = useMemo(
    () => ({ items, queue, log, flush, dismissRefused: dismiss, onSynced }),
    [items, queue, log, flush, dismiss, onSynced],
  );
  return <OutboxContext.Provider value={value}>{children}</OutboxContext.Provider>;
}

export function useOutbox(): Outbox {
  const ctx = useContext(OutboxContext);
  if (!ctx) throw new Error("useOutbox must be used inside <OutboxProvider>");
  return ctx;
}
