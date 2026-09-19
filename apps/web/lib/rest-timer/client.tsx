"use client";
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from "react";
import {
  extendRest, isRestActive, markRestNotified, pauseRest, remainingMs, resumeRest, settleRest,
  skipRest, startRest,
  type RestPlan, type RestPrefs, type RestTimer,
} from "@healthapp/shared";
import { cancelRestPush, scheduleRestPush } from "@/app/rest-actions";
import { useI18n } from "@/lib/i18n/client";
import { loadRestTimer, saveRestTimer } from "./storage";
import { currentNotificationState, currentPushSubscription, showLocalRestNotification } from "./push";

/**
 * The one rest timer, shared by every screen under (client): the set logger
 * starts it, the bar in the layout shows it, and it survives navigation,
 * remounts and reloads because it lives in localStorage as two instants.
 *
 * What is left is always `endsAt - Date.now()`. The interval below only asks
 * React to look at the clock again; it never adds anything up, so a tab that
 * was throttled, frozen or asleep shows the right number the moment it is
 * looked at again (the `visibilitychange` handler is that moment).
 *
 * Two things are kept apart on purpose:
 *   · the timer — local, works offline, never waits on the network;
 *   · the notification — best effort, in this order: the in-app banner when
 *     the page is visible; a notification from the page itself when it is
 *     hidden but alive; a server push, scheduled from `endsAt`, when the
 *     device is asleep. Any of the three may fail without touching the timer.
 */

type RestTimerContextValue = {
  timer: RestTimer | null;
  /** Milliseconds left, refreshed a few times a second while running. */
  remaining: number;
  prefs: RestPrefs;
  start: (plan: RestPlan, context: { dayId: string; exerciseName: string; setIndex: number }) => void;
  pause: () => void;
  resume: () => void;
  extend: () => void;
  skip: () => void;
  /** Close the "rest finished" banner (or a finished timer) without starting anything. */
  dismiss: () => void;
  /** Drop the timer entirely — the workout was finished. */
  clear: () => void;
  /** True once the completion has been surfaced and until it is dismissed. */
  finished: boolean;
};

const RestTimerContext = createContext<RestTimerContextValue | null>(null);

const TICK_MS = 250;

function newTimerId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  // Plain-http LAN dev has no crypto.randomUUID; a v4-shaped id is enough for a local key.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function RestTimerProvider({ prefs, children }: { prefs: RestPrefs; children: React.ReactNode }) {
  const { t } = useI18n();
  const [timer, setTimerState] = useState<RestTimer | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [finished, setFinished] = useState(false);
  // Whether this browser can be pushed to: permission granted, subscribed,
  // and the person wants it. Checked once; the settings card refreshes the
  // page when it changes.
  const pushReady = useRef(false);
  const timerRef = useRef<RestTimer | null>(null);

  const setTimer = useCallback((next: RestTimer | null) => {
    timerRef.current = next;
    setTimerState(next);
    if (typeof window !== "undefined") saveRestTimer(window.localStorage, next);
  }, []);

  // Restore after mount only, so the server and first client render agree.
  useEffect(() => {
    const restored = loadRestTimer(window.localStorage);
    if (restored) {
      timerRef.current = restored;
      setTimerState(restored);
      setNow(Date.now());
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!prefs.notify || currentNotificationState() !== "granted") {
      pushReady.current = false;
      return;
    }
    currentPushSubscription().then((sub) => {
      if (!cancelled) pushReady.current = Boolean(sub);
    });
    return () => {
      cancelled = true;
    };
  }, [prefs.notify]);

  // ---- completion: settle from the clock, announce once ----
  const settle = useCallback(() => {
    const current = timerRef.current;
    if (!current) return;
    const at = Date.now();
    setNow(at);
    const settled = settleRest(current, at);
    const { timer: marked, shouldNotify } = markRestNotified(settled, at);
    if (marked !== current) setTimer(marked);
    if (!shouldNotify) return;

    setFinished(true);
    // The page announced it, so the server need not — unless it already has,
    // in which case this is a no-op. Either way one notification per rest.
    void cancelRestPush(marked.id).catch(() => undefined);
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      void showLocalRestNotification({
        id: marked.id,
        title: t.clientWidgets.restTimer.finishedTitle,
        body: t.clientWidgets.restTimer.finishedBody,
        url: `/workout/${marked.context.dayId}/log`,
      });
    }
  }, [setTimer, t]);

  // The clock the UI reads. Runs only while a rest is running; each tick is
  // "look at Date.now() again", nothing accumulates.
  useEffect(() => {
    if (timer?.status !== "running") return;
    const id = window.setInterval(settle, TICK_MS);
    return () => window.clearInterval(id);
  }, [timer?.status, timer?.endsAt, settle]);

  // Coming back from another app, a locked screen or a throttled tab: the
  // interval may not have fired for minutes. Re-derive from endsAt now.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") settle();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("pageshow", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("pageshow", onVisible);
    };
  }, [settle]);

  // ---- push scheduling (never awaited by the timer) ----
  const syncPush = useCallback((next: RestTimer) => {
    if (!pushReady.current) return;
    if (next.status === "running") {
      void scheduleRestPush({ id: next.id, endsAt: next.endsAt, dayId: next.context.dayId }).catch(() => undefined);
    } else {
      void cancelRestPush(next.id).catch(() => undefined);
    }
  }, []);

  const start = useCallback<RestTimerContextValue["start"]>((plan, context) => {
    const at = Date.now();
    const next = startRest({
      id: newTimerId(),
      durationSeconds: plan.durationSeconds,
      now: at,
      dayId: context.dayId,
      exerciseName: context.exerciseName,
      setIndex: context.setIndex,
      next: plan.next,
    });
    setFinished(false);
    setNow(at);
    setTimer(next);
    syncPush(next);
  }, [setTimer, syncPush]);

  const update = useCallback((fn: (current: RestTimer, at: number) => RestTimer) => {
    const current = timerRef.current;
    if (!current) return;
    const at = Date.now();
    const next = fn(current, at);
    if (next === current) return;
    setNow(at);
    setTimer(next);
    syncPush(next);
  }, [setTimer, syncPush]);

  const pause = useCallback(() => update(pauseRest), [update]);
  const resume = useCallback(() => update(resumeRest), [update]);
  const extend = useCallback(() => {
    setFinished(false);
    update((current, at) => extendRest(current, at));
  }, [update]);
  const skip = useCallback(() => {
    setFinished(false);
    update((current) => skipRest(current));
  }, [update]);
  const dismiss = useCallback(() => {
    setFinished(false);
    const current = timerRef.current;
    if (current && !isRestActive(current)) setTimer(null);
  }, [setTimer]);

  const clear = useCallback(() => {
    setFinished(false);
    const current = timerRef.current;
    if (current && isRestActive(current)) void cancelRestPush(current.id).catch(() => undefined);
    setTimer(null);
  }, [setTimer]);

  const remaining = timer ? remainingMs(timer, now) : 0;

  const value = useMemo<RestTimerContextValue>(
    () => ({ timer, remaining, prefs, start, pause, resume, extend, skip, dismiss, clear, finished }),
    [timer, remaining, prefs, start, pause, resume, extend, skip, dismiss, clear, finished],
  );

  return <RestTimerContext.Provider value={value}>{children}</RestTimerContext.Provider>;
}

export function useRestTimer(): RestTimerContextValue {
  const ctx = useContext(RestTimerContext);
  if (!ctx) throw new Error("useRestTimer must be used inside <RestTimerProvider>");
  return ctx;
}
