"use client";
import { useEffect } from "react";
import { REST_EXTEND_SECONDS, formatRestClock } from "@healthapp/shared";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { useRestTimer } from "@/lib/rest-timer/client";
import { NavIcon } from "./client-nav";

/** How long the "rest finished" banner stays before it clears itself. */
const FINISHED_BANNER_MS = 8000;

/**
 * The rest countdown, pinned to the bottom of the page above the phone tab
 * bar. Rendered by the (client) layout so it follows the person from the set
 * logger to Today and back; hidden entirely when no rest is running.
 *
 * It sits in the page flow as `position: sticky`, so the content above it is
 * never covered — the last card scrolls to rest on top of it, not under it.
 *
 * Big digits, three controls, and the set that comes next. No animation
 * beyond the progress bar's width, which the reduced-motion preference turns
 * into a plain jump.
 */
export function RestTimerBar() {
  const { t } = useI18n();
  const m = t.clientWidgets.restTimer;
  const { timer, remaining, pause, resume, extend, skip, dismiss, finished } = useRestTimer();

  useEffect(() => {
    if (!finished) return;
    const id = window.setTimeout(dismiss, FINISHED_BANNER_MS);
    return () => window.clearTimeout(id);
  }, [finished, dismiss]);

  if (!timer) return null;

  if (finished) {
    return (
      <div className="pointer-events-none sticky bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+4.75rem)] z-30 mt-4 sm:bottom-6">
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-auto glass glass--strong mx-auto flex max-w-md items-center gap-3 rounded-3xl bg-accent-soft/80 px-4 py-3.5"
        >
          <NavIcon d="M20 6 9 17l-5-5" className="h-5 w-5 shrink-0 text-accent-ink" />
          <div className="min-w-0 flex-1">
            <p className="font-display text-[15px] font-bold leading-tight text-accent-ink">{m.finishedTitle}</p>
            <p className="mt-0.5 text-[12.5px] text-ink-soft">
              {m.finishedBody}
              {timer.context.next ? ` ${timer.context.next.exerciseName} · ${fill(m.setN, { n: timer.context.next.setIndex })}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label={m.dismiss}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-ink-faint hover:text-ink"
          >
            <NavIcon d="M6 6l12 12M18 6 6 18" className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  if (timer.status !== "running" && timer.status !== "paused") return null;

  const paused = timer.status === "paused";
  const total = timer.durationSeconds * 1000;
  const fraction = total > 0 ? Math.min(1, Math.max(0, remaining / total)) : 0;
  const startedAt = new Date(timer.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <div className="pointer-events-none sticky bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+4.75rem)] z-30 mt-4 sm:bottom-6">
      <section
        aria-label={m.title}
        className="pointer-events-auto glass glass--strong mx-auto max-w-md overflow-hidden rounded-3xl"
      >
        <div className="h-1 w-full bg-line/60">
          <div
            className="h-full bg-accent transition-[width] duration-300 ease-linear motion-reduce:transition-none"
            style={{ width: `${fraction * 100}%` }}
          />
        </div>
        <div className="flex items-center gap-3 px-4 pb-3 pt-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-[10.5px] font-bold uppercase tracking-wider text-accent-ink">
              {m.rest}{paused ? ` · ${m.pause}` : ""}
            </p>
            <p
              aria-live="off"
              className="font-display text-[40px] font-extrabold leading-none tabular-nums tracking-tight"
            >
              {formatRestClock(remaining)}
            </p>
            {timer.context.next ? (
              <p className="mt-1 truncate text-[12.5px] text-ink-soft">
                <span className="text-ink-faint">{m.next}:</span>{" "}
                <b className="text-ink">{timer.context.next.exerciseName}</b>
                {" · "}{fill(m.setN, { n: timer.context.next.setIndex })}
              </p>
            ) : null}
            <p className="mt-0.5 text-[11px] tabular-nums text-ink-faint">{fill(m.started, { time: startedAt })}</p>
          </div>
          <div className="flex shrink-0 flex-col gap-1.5">
            <button
              type="button"
              onClick={extend}
              aria-label={m.add15Label}
              className="inline-flex h-10 min-w-[4.5rem] items-center justify-center rounded-xl glass glass--subtle glass--interactive px-3 text-[13px] font-bold tabular-nums text-ink"
            >
              +{REST_EXTEND_SECONDS}s
            </button>
            <button
              type="button"
              onClick={paused ? resume : pause}
              className="inline-flex h-10 min-w-[4.5rem] items-center justify-center rounded-xl glass glass--subtle glass--interactive px-3 text-[13px] font-bold text-ink"
            >
              {paused ? m.resume : m.pause}
            </button>
            <button
              type="button"
              onClick={skip}
              className="inline-flex h-10 min-w-[4.5rem] items-center justify-center rounded-xl bg-accent px-3 font-display text-[13px] font-bold text-accent-fg"
            >
              {m.skip}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
