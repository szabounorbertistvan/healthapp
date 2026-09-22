"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  REST_MAX_SECONDS, REST_MIN_SECONDS, REST_PRESETS, type RestPrefs,
} from "@healthapp/shared";
import { removePushSubscription, savePushSubscription, saveRestPrefs } from "@/app/rest-actions";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import {
  currentNotificationState, subscribeToPush, unsubscribeFromPush, vapidPublicKey, type NotificationState,
} from "@/lib/rest-timer/push";
import { Card } from "./ui";

const FIELD =
  "mt-1.5 h-11 w-full rounded-2xl bg-bg px-3.5 text-[14px] text-ink outline-none ring-accent/50 focus:ring-2";
const BUTTON =
  "inline-flex h-11 items-center justify-center rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90 disabled:opacity-50";

const isPreset = (n: number) => (REST_PRESETS as readonly number[]).includes(n);

/**
 * The rest-timer section of the account screen: the default rest, and
 * whether the person wants a notification when a rest ends in the
 * background. The browser permission is asked for only from the button
 * here — never on page load — and each of its four answers gets its own line.
 */
export function RestTimerCard({ prefs }: { prefs: RestPrefs }) {
  const { t } = useI18n();
  const m = t.clientWidgets.restTimer;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [custom, setCustom] = useState(!isPreset(prefs.default_seconds));
  const [seconds, setSeconds] = useState(String(prefs.default_seconds));
  const [notify, setNotify] = useState(prefs.notify);
  const [alert, setAlert] = useState(prefs.alert);
  const [state, setState] = useState<"idle" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  // "unsupported" until mounted: the server cannot know what this browser can do.
  const [permission, setPermission] = useState<NotificationState>("unsupported");
  const [mounted, setMounted] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    setPermission(currentNotificationState());
    setMounted(true);
    const ua = navigator.userAgent;
    const standalone = window.matchMedia("(display-mode: standalone)").matches;
    setIos(/iPhone|iPad|iPod/.test(ua) && !standalone);
  }, []);

  function save(next: Partial<RestPrefs>) {
    setState("idle");
    setError(null);
    const parsed = parseInt(seconds, 10);
    const defaultSeconds = Number.isFinite(parsed) ? parsed : prefs.default_seconds;
    if (defaultSeconds < REST_MIN_SECONDS || defaultSeconds > REST_MAX_SECONDS) {
      setState("error");
      setError(m.customSeconds);
      return;
    }
    start(async () => {
      const result = await saveRestPrefs({ ...prefs, default_seconds: defaultSeconds, notify, alert, ...next });
      if (!result.ok) {
        setState("error");
        setError(result.message ?? m.couldNotSave);
        return;
      }
      setState("saved");
      router.refresh();
    });
  }

  function enable() {
    setError(null);
    start(async () => {
      // The prompt: a user gesture, this button, nothing else.
      let verdict: NotificationState = permission;
      try {
        verdict = (await Notification.requestPermission()) as NotificationState;
      } catch {
        verdict = "unsupported";
      }
      setPermission(verdict);
      if (verdict !== "granted") return;
      const key = vapidPublicKey();
      if (key) {
        const sub = await subscribeToPush(key);
        if (sub) {
          const saved = await savePushSubscription(sub);
          if (!saved.ok) setError(saved.message ?? m.couldNotSave);
        }
      }
      setNotify(true);
      const result = await saveRestPrefs({ ...prefs, notify: true });
      if (!result.ok) setError(result.message ?? m.couldNotSave);
      router.refresh();
    });
  }

  /**
   * Whether the notification may behave like an alert. Off is what the app
   * used to do to everyone — `silent: true`, which on Android files it in a
   * channel a locked phone never shows. Nothing here ever asks for a sound or
   * a vibration pattern; this only decides which channel the device uses.
   */
  function toggleAlert(on: boolean) {
    setAlert(on);
    start(async () => {
      const result = await saveRestPrefs({ ...prefs, notify, alert: on });
      if (!result.ok) setError(result.message ?? m.couldNotSave);
      router.refresh();
    });
  }

  function toggleNotify(on: boolean) {
    setNotify(on);
    start(async () => {
      if (!on) {
        // Switching off also forgets this browser's endpoint, so the server
        // stops paying for a push nobody wants.
        const endpoint = await unsubscribeFromPush();
        if (endpoint) await removePushSubscription(endpoint);
      }
      const result = await saveRestPrefs({ ...prefs, notify: on });
      if (!result.ok) setError(result.message ?? m.couldNotSave);
      router.refresh();
    });
  }

  const pushConfigured = Boolean(vapidPublicKey());

  return (
    <Card plain>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{m.title}</p>

      <label className="mt-3 block text-[13px] font-semibold text-ink-soft">
        {m.defaultRest}
        <select
          className={FIELD}
          value={custom ? "custom" : String(prefs.default_seconds)}
          onChange={(e) => {
            if (e.target.value === "custom") {
              setCustom(true);
              return;
            }
            setCustom(false);
            setSeconds(e.target.value);
          }}
        >
          {REST_PRESETS.map((n) => (
            <option key={n} value={n}>{fill(m.seconds, { n })}</option>
          ))}
          <option value="custom">{m.custom}</option>
        </select>
      </label>
      {custom ? (
        <label className="mt-3 block text-[13px] font-semibold text-ink-soft">
          {m.customSeconds}
          <input
            className={FIELD}
            inputMode="numeric"
            value={seconds}
            min={REST_MIN_SECONDS}
            max={REST_MAX_SECONDS}
            onChange={(e) => setSeconds(e.target.value.replace(/[^\d]/g, ""))}
          />
        </label>
      ) : null}
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-faint">{m.defaultRestHint}</p>

      <div className="mt-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-[13px] font-semibold text-ink-soft">{m.notifications}</p>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-faint">{m.notificationsHint}</p>
        </div>
        {permission === "granted" ? (
          <button
            type="button"
            role="switch"
            aria-checked={notify}
            disabled={pending}
            onClick={() => toggleNotify(!notify)}
            className={`inline-flex h-9 shrink-0 items-center justify-center rounded-xl px-3.5 text-[13px] font-semibold ${
              notify ? "bg-accent-soft text-accent-ink" : "bg-bg text-ink-faint"
            }`}
          >
            {notify ? m.enabled : m.off}
          </button>
        ) : null}
      </div>

      {permission === "granted" && notify ? (
        <div className="mt-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-[13px] font-semibold text-ink-soft">{m.lockScreen}</p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-faint">{m.lockScreenHint}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={alert}
            disabled={pending}
            onClick={() => toggleAlert(!alert)}
            className={`inline-flex h-9 shrink-0 items-center justify-center rounded-xl px-3.5 text-[13px] font-semibold ${
              alert ? "bg-accent-soft text-accent-ink" : "bg-bg text-ink-faint"
            }`}
          >
            {alert ? m.enabled : m.off}
          </button>
        </div>
      ) : null}

      {mounted ? (
        <div className="mt-3 text-[12.5px] leading-relaxed">
          {permission === "default" ? (
            <button type="button" onClick={enable} disabled={pending} className={BUTTON}>
              {m.enableNotifications}
            </button>
          ) : null}
          {permission === "granted" ? <p className="text-accent-ink">{m.notificationsAllowed}</p> : null}
          {permission === "denied" ? <p className="text-warn">{m.notificationsDenied}</p> : null}
          {permission === "unsupported" ? <p className="text-ink-faint">{m.notificationsUnsupported}</p> : null}
          {permission === "unsupported" && ios ? <p className="mt-1 text-ink-faint">{m.iosHint}</p> : null}
          {permission !== "unsupported" && !pushConfigured ? (
            <p className="mt-1 text-ink-faint">{m.notificationsNotConfigured}</p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => save({})} disabled={pending} className={BUTTON}>
          {m.save}
        </button>
        {state === "saved" && !pending ? <span className="text-[13px] text-accent-ink">{m.saved}</span> : null}
        {error ? <span className="text-[13px] text-risk">{error}</span> : null}
      </div>
    </Card>
  );
}

/**
 * The per-exercise rest, from the set logger: a tap on the exercise's rest
 * line opens this, offering the presets, a custom number, and "back to the
 * default". Saved to the same users.rest_prefs, keyed by the library exercise
 * so it follows the lift across programs.
 */
export function RestDurationPicker({
  exerciseId, exerciseName, prescribedSeconds, prefs, onPick, onClose,
}: {
  exerciseId: string;
  exerciseName: string;
  prescribedSeconds: number | null;
  prefs: RestPrefs;
  /** Called at once with the seconds chosen, so the REST box updates before the save lands. */
  onPick?: (seconds: number) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const m = t.clientWidgets.restTimer;
  const router = useRouter();
  const [pending, start] = useTransition();
  const current = prefs.exercises[exerciseId];
  const [custom, setCustom] = useState(current !== undefined && !isPreset(current));
  const [seconds, setSeconds] = useState(current !== undefined ? String(current) : "");
  const [error, setError] = useState<string | null>(null);

  function commit(value: number | null) {
    setError(null);
    onPick?.(value ?? (prescribedSeconds && prescribedSeconds > 0 ? prescribedSeconds : prefs.default_seconds));
    start(async () => {
      const exercises = { ...prefs.exercises };
      if (value === null) delete exercises[exerciseId];
      else exercises[exerciseId] = value;
      const result = await saveRestPrefs({ ...prefs, exercises });
      if (!result.ok) {
        setError(result.message ?? m.couldNotSave);
        return;
      }
      router.refresh();
      onClose();
    });
  }

  const chip = (active: boolean) =>
    `inline-flex h-9 items-center justify-center rounded-xl px-3 text-[12.5px] font-semibold tabular-nums ${
      active ? "bg-accent text-accent-fg" : "bg-bg text-ink-soft hover:text-ink"
    } disabled:opacity-50`;

  return (
    <div className="mt-3 rounded-2xl bg-bg/60 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
        {fill(m.restForExercise, { name: exerciseName })}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button type="button" disabled={pending} onClick={() => commit(null)} className={chip(current === undefined)}>
          {prescribedSeconds
            ? fill(m.prescribed, { n: prescribedSeconds })
            : fill(m.useDefault, { n: prefs.default_seconds })}
        </button>
        {REST_PRESETS.map((n) => (
          <button key={n} type="button" disabled={pending} onClick={() => commit(n)} className={chip(current === n)}>
            {fill(m.seconds, { n })}
          </button>
        ))}
        <button type="button" disabled={pending} onClick={() => setCustom(true)} className={chip(custom)}>
          {m.custom}
        </button>
      </div>
      {custom ? (
        <form
          className="mt-2 flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const n = parseInt(seconds, 10);
            if (!Number.isFinite(n) || n < REST_MIN_SECONDS || n > REST_MAX_SECONDS) {
              setError(m.customSeconds);
              return;
            }
            commit(n);
          }}
        >
          <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
            {m.customSeconds}
            <input
              inputMode="numeric"
              value={seconds}
              onChange={(e) => setSeconds(e.target.value.replace(/[^\d]/g, ""))}
              className="h-10 w-28 rounded-xl border border-line bg-surface px-2.5 text-sm tabular-nums outline-none focus:border-accent"
            />
          </label>
          <button type="submit" disabled={pending} className="inline-flex h-10 items-center justify-center rounded-xl bg-accent px-4 font-display text-[13px] font-bold text-accent-fg disabled:opacity-50">
            {m.save}
          </button>
        </form>
      ) : null}
      {error ? <p className="mt-2 text-[12.5px] text-risk">{error}</p> : null}
    </div>
  );
}
