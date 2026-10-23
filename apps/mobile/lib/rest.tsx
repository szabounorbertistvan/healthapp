import {
  extendRest, isRestActive, markRestNotified, pauseRest, remainingMs, resumeRest, settleRest, skipRest, startRest,
  type RestPlan, type RestTimer,
} from "@healthapp/shared";
import { randomUUID } from "expo-crypto";
import * as Notifications from "expo-notifications";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState, Platform } from "react-native";
import { useI18n } from "./i18n";
import { readJson, REST_KEY, writeJson } from "./storage";

// The rest timer between sets — the web's rules (packages/shared/src/rest-timer.ts:
// two instants, never a counted tick), kept on the phone, and announced by a
// *local* notification scheduled for the end instant. No server, no signal
// needed, and it fires with the app closed: Android delivers it itself.
//
// Like the web: the app never asks for a sound or a vibration pattern. The
// `alert` preference (users.rest_prefs.alert) picks the channel: "rest" may
// show on the lock screen and as a heads-up; "rest-quiet" stays in the shade.
// The person's own channel settings in Android have the last word.

const CHANNEL_ALERT = "rest";
const CHANNEL_QUIET = "rest-quiet";

Notifications.setNotificationHandler({
  // In the app, the timer bar already says it; the banner would be a second voice.
  handleNotification: async () => ({ shouldShowBanner: false, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

let channelsReady: Promise<void> | null = null;
function ensureChannels(names: { alert: string; quiet: string }): Promise<void> {
  if (Platform.OS !== "android") return Promise.resolve();
  channelsReady ??= (async () => {
    await Notifications.setNotificationChannelAsync(CHANNEL_ALERT, {
      name: names.alert,
      importance: Notifications.AndroidImportance.HIGH,
      sound: null,
      enableVibrate: false,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
    await Notifications.setNotificationChannelAsync(CHANNEL_QUIET, {
      name: names.quiet,
      importance: Notifications.AndroidImportance.LOW,
      sound: null,
      enableVibrate: false,
    });
  })().catch(() => {
    channelsReady = null;
  });
  return channelsReady ?? Promise.resolve();
}

type StoredRest = { timer: RestTimer; notificationId: string | null; alert: boolean };

type Rest = {
  timer: RestTimer | null;
  /** Milliseconds left, re-derived four times a second while a rest runs. */
  remaining: number;
  start: (plan: RestPlan, context: { dayId: string; exerciseName: string; setIndex: number }, alert: boolean) => void;
  pause: () => void;
  resume: () => void;
  extend: () => void;
  skip: () => void;
  /** The workout was finished: drop the timer and its notification. */
  clear: () => void;
};

const RestContext = createContext<Rest | null>(null);

export function RestProvider({ children }: { children: ReactNode }) {
  const { t, fill } = useI18n();
  const [stored, setStored] = useState<StoredRest | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const storedRef = useRef<StoredRest | null>(null);
  const permissionAsked = useRef(false);

  const persist = useCallback((next: StoredRest | null) => {
    storedRef.current = next;
    setStored(next);
    void writeJson(REST_KEY, next);
  }, []);

  useEffect(() => {
    // A timer started before the app was closed comes back with the right remainder.
    void readJson<StoredRest>(REST_KEY).then((saved) => {
      if (saved && !storedRef.current) {
        storedRef.current = saved;
        setStored(saved);
      }
    });
  }, []);

  const cancel = useCallback(async (id: string | null) => {
    if (id) await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
  }, []);

  const schedule = useCallback(
    async (timer: RestTimer, alert: boolean): Promise<string | null> => {
      if (!permissionAsked.current) {
        // Asked in context — the first time a rest starts — never at launch.
        permissionAsked.current = true;
        const current = await Notifications.getPermissionsAsync();
        if (!current.granted && current.canAskAgain) await Notifications.requestPermissionsAsync();
      }
      if (!(await Notifications.getPermissionsAsync()).granted) return null;
      await ensureChannels({ alert: t.clientWidgets.restTimer.title, quiet: `${t.clientWidgets.restTimer.title} · ${t.clientWidgets.restTimer.off}` });
      const next = timer.context.next;
      return Notifications.scheduleNotificationAsync({
        content: {
          title: t.clientWidgets.restTimer.finishedTitle,
          body: next ? `${t.clientWidgets.restTimer.next}: ${next.exerciseName} · ${fill(t.clientWidgets.restTimer.setN, { n: next.setIndex })}` : t.clientWidgets.restTimer.finishedBody,
          data: { dayId: timer.context.dayId },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: timer.endsAt,
          channelId: alert ? CHANNEL_ALERT : CHANNEL_QUIET,
        },
      }).catch(() => null);
    },
    [t, fill],
  );

  const start = useCallback<Rest["start"]>(
    (plan, context, alert) => {
      const previous = storedRef.current;
      const timer = startRest({ id: randomUUID(), durationSeconds: plan.durationSeconds, now: Date.now(), next: plan.next, ...context });
      persist({ timer, notificationId: null, alert });
      void (async () => {
        await cancel(previous?.notificationId ?? null);
        const notificationId = await schedule(timer, alert);
        if (storedRef.current?.timer.id === timer.id) persist({ timer: storedRef.current.timer, notificationId, alert });
      })();
    },
    [persist, cancel, schedule],
  );

  /** Change the running timer and move its notification to the new end. */
  const change = useCallback(
    (update: (timer: RestTimer, at: number) => RestTimer, reschedule: boolean) => {
      const current = storedRef.current;
      if (!current) return;
      const timer = update(current.timer, Date.now());
      persist({ ...current, timer, notificationId: null });
      void (async () => {
        await cancel(current.notificationId);
        const notificationId = reschedule && timer.status === "running" ? await schedule(timer, current.alert) : null;
        if (storedRef.current?.timer.id === timer.id) persist({ ...storedRef.current, notificationId });
      })();
    },
    [persist, cancel, schedule],
  );

  const pause = useCallback(() => change(pauseRest, false), [change]);
  const resume = useCallback(() => change(resumeRest, true), [change]);
  const extend = useCallback(() => change((timer, at) => extendRest(timer, at), true), [change]);
  const skip = useCallback(() => change((timer) => skipRest(timer), false), [change]);
  const clear = useCallback(() => {
    const current = storedRef.current;
    persist(null);
    void cancel(current?.notificationId ?? null);
  }, [persist, cancel]);

  const active = stored ? isRestActive(stored.timer) : false;
  useEffect(() => {
    if (!active) return;
    const tick = setInterval(() => setNow(Date.now()), 250);
    const app = AppState.addEventListener("change", () => setNow(Date.now()));
    return () => {
      clearInterval(tick);
      app.remove();
    };
  }, [active]);

  // Settle a timer whose end passed (in the app, or while the phone was locked).
  useEffect(() => {
    const current = storedRef.current;
    if (!current || current.timer.status !== "running" || remainingMs(current.timer, now) > 0) return;
    const settled = settleRest(current.timer, now);
    persist({ ...current, timer: markRestNotified(settled, now).timer });
  }, [now, persist]);

  const timer = stored?.timer ?? null;
  const value = useMemo<Rest>(
    () => ({ timer, remaining: timer ? remainingMs(timer, now) : 0, start, pause, resume, extend, skip, clear }),
    [timer, now, start, pause, resume, extend, skip, clear],
  );
  return <RestContext.Provider value={value}>{children}</RestContext.Provider>;
}

export function useRest(): Rest {
  const ctx = useContext(RestContext);
  if (!ctx) throw new Error("useRest must be used inside <RestProvider>");
  return ctx;
}
