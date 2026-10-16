"use client";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/lib/i18n/client";
import { fill } from "@/lib/i18n";
import { SMALL_BUTTON } from "@/lib/form-classes";
import {
  placePopover, shouldAutoOpenTour, tourEndMark, tourKey, type Placement, type TourId,
} from "@/lib/onboarding-model";
import { useOnboarding } from "./provider";

/** Long enough for the page to settle (fonts, a streamed card) before measuring. */
const AUTO_DELAY_MS = 700;
/** The phone tab bar and its margin: a popover never sits under it. */
const PHONE_TAB_BAR = 96;
const ICON_HELP = "M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7M12 17h.01";

type Step = { title: string; body: string };

/** The element a step points at: `data-tour="<tour>-<step>"`, the first one actually on screen. */
function findTarget(tour: TourId, step: string): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>(`[data-tour="${tour}-${step}"]`);
  for (const el of all) {
    // display:none (a desktop-only control on a phone) or an empty wrapper is not a target
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

/**
 * A page's guided tour: the "Guided tour" button, placed where the page puts
 * it, and — once per person, when it has never been finished or closed — the
 * tour opening by itself shortly after the page loads.
 *
 * One small card next to one element at a time; no backdrop, nothing made
 * inert: the page stays usable, a link still navigates, the tour simply ends
 * with the page. Escape or × closes it; closing is remembered like finishing
 * (lib/onboarding-model.ts tourEndMark). Steps whose element is not on the
 * page (a card that is not shown, a control only on desktop) are left out.
 *
 * Focus: opened from the button, the card takes focus and gives it back on
 * close. Opened by itself it does not steal focus from whatever the person is
 * doing; it is announced politely instead.
 */
export function PageTour({ id, steps, className = "" }: { id: TourId; steps: readonly string[]; className?: string }) {
  const { t } = useI18n();
  const o = t.onboarding.tour;
  const copy = o.tours[id] as Record<string, Step | undefined>;
  const { state, deviceOff, mark } = useOnboarding();
  const [run, setRun] = useState<{ steps: string[]; index: number; manual: boolean } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const autoStarted = useRef(false);

  const start = useCallback((manual: boolean) => {
    const available = steps.filter((s) => copy[s] && findTarget(id, s));
    if (available.length === 0) return false;
    setRun({ steps: available, index: 0, manual });
    return true;
  }, [copy, id, steps]);

  useEffect(() => {
    if (autoStarted.current || run) return;
    if (!shouldAutoOpenTour(state, id, deviceOff)) return;
    const timer = window.setTimeout(() => {
      if (autoStarted.current) return;
      autoStarted.current = true;
      start(false);
    }, AUTO_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [state, deviceOff, id, run, start]);

  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  }, [run]);

  const end = useCallback((finished: boolean, opts: { stopAll?: boolean } = {}) => {
    const current = runRef.current;
    if (!current) return;
    runRef.current = null;
    void mark(tourKey(id), finished ? "done" : tourEndMark(current.index, current.steps.length));
    if (opts.stopAll) void mark("tips", "dismissed");
    // a card that held focus hands it back; one that never took it leaves focus where it is
    const hadFocus = current.manual || Boolean(document.activeElement?.closest("[data-tour-popover]"));
    setRun(null);
    if (hadFocus) window.setTimeout(() => buttonRef.current?.focus(), 0);
  }, [id, mark]);

  const step = run ? run.steps[run.index] : null;
  const target = step ? findTarget(id, step) : null;
  const content = step ? copy[step] : undefined;

  // the element went away under the tour (a card collapsed): close it, remembered
  useEffect(() => {
    if (run && !target) end(false);
  }, [run, target, end]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={run !== null}
        onClick={() => (run ? end(false) : start(true))}
        className={`inline-flex h-9 items-center gap-1.5 rounded-full bg-surface px-3.5 text-xs font-semibold text-ink-soft outline-none ring-accent/50 hover:text-ink focus-visible:ring-2 sm:h-10 sm:px-4 sm:text-[13px] ${className}`}
      >
        <svg viewBox="0 0 24 24" aria-hidden className="h-[17px] w-[17px]" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d={ICON_HELP} />
        </svg>
        {o.button}
      </button>
      {run && target && content ? (
        <TourCard
          key={`${run.index}`}
          target={target}
          step={content}
          index={run.index}
          total={run.steps.length}
          takeFocus={run.manual}
          // once the person works the card it keeps focus from step to step
          onBack={() => setRun((r) => (r ? { ...r, index: Math.max(0, r.index - 1), manual: true } : r))}
          onNext={() =>
            run.index >= run.steps.length - 1
              ? end(true)
              : setRun((r) => (r ? { ...r, index: r.index + 1, manual: true } : r))
          }
          onClose={() => end(false)}
          onStopAll={() => end(false, { stopAll: true })}
        />
      ) : null}
    </>
  );
}

function TourCard({
  target, step, index, total, takeFocus, onBack, onNext, onClose, onStopAll,
}: {
  target: HTMLElement;
  step: Step;
  index: number;
  total: number;
  takeFocus: boolean;
  onBack: () => void;
  onNext: () => void;
  onClose: () => void;
  onStopAll: () => void;
}) {
  const { t } = useI18n();
  const o = t.onboarding.tour;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Placement | null>(null);
  const titleId = useId();
  const bodyId = useId();
  const last = index >= total - 1;

  // ring the target and bring it into view
  useLayoutEffect(() => {
    target.setAttribute("data-tour-active", "");
    const rect = target.getBoundingClientRect();
    const bottom = window.innerHeight - (window.innerWidth < 640 ? PHONE_TAB_BAR : 0);
    if (rect.top < 0 || rect.bottom > bottom) {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      target.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
    }
    return () => target.removeAttribute("data-tour-active");
  }, [target]);

  // follow the target through scrolling, resizing and its own changes
  useLayoutEffect(() => {
    let frame = 0;
    const measure = () => {
      const card = ref.current;
      if (!card) return;
      const r = target.getBoundingClientRect();
      const phone = window.innerWidth < 640;
      setPos(placePopover(
        { top: r.top, left: r.left, width: r.width, height: r.height },
        { width: card.offsetWidth, height: card.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
        { bottomInset: phone ? PHONE_TAB_BAR : 0 },
      ));
    };
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(target);
    if (ref.current) observer?.observe(ref.current);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
      observer?.disconnect();
    };
  }, [target]);

  // Only once placed: the first render is `visibility: hidden` until the layout
  // effect has measured it, and focus() on a hidden element does nothing — the
  // card opened from its button then never had focus (e2e-local onboarding, 2026-10-16).
  const placed = pos !== null;
  useEffect(() => {
    if (takeFocus && placed) ref.current?.focus({ preventScroll: true });
  }, [takeFocus, placed]);

  // Escape closes — unless a modal dialog is open, whose own Escape that is
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector("dialog[open], [role=dialog][aria-modal=true]")) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      data-tour-popover
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      tabIndex={-1}
      style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: "hidden" }}
      className="fixed z-[60] w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-4 text-ink shadow-2xl outline-none ring-accent/50 focus-visible:ring-2"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          <span className="sr-only">{o.region} · </span>
          {fill(o.stepOf, { n: index + 1, total })}
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label={o.close}
          className="-m-1.5 grid h-8 w-8 place-items-center rounded-full text-ink-faint outline-none ring-accent/50 hover:bg-bg hover:text-ink focus-visible:ring-2"
        >
          <svg viewBox="0 0 24 24" aria-hidden className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
      {/* polite: an auto-opened card is announced without taking focus */}
      <div aria-live="polite">
        <h2 id={titleId} className="mt-1 font-display text-[15px] font-bold tracking-tight">{step.title}</h2>
        <p id={bodyId} className="mt-1 text-[13px] leading-relaxed text-ink-soft">{step.body}</p>
      </div>
      <div className="mt-3.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <button
          type="button"
          onClick={onStopAll}
          className="text-[12px] font-medium text-ink-faint underline-offset-2 outline-none hover:text-ink hover:underline focus-visible:underline"
        >
          {o.stopAll}
        </button>
        <div className="ml-auto flex gap-2">
          {index > 0 ? (
            <button type="button" onClick={onBack} className={SMALL_BUTTON}>{o.back}</button>
          ) : null}
          <button
            type="button"
            onClick={onNext}
            className="inline-flex h-9 items-center justify-center rounded-xl bg-accent px-3.5 text-[13px] font-semibold text-accent-fg outline-none ring-accent/50 hover:opacity-90 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            {last ? o.done : o.next}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
