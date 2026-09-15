"use client";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { loadWorkoutShareCard } from "@/app/share-card-actions";
import { APP_NAME } from "@/lib/brand";
import { useI18n } from "@/lib/i18n/client";
import {
  DEFAULT_SHARE_OPTIONS,
  SHARE_FORMATS,
  SHARE_FORMAT_SIZE,
  SHARE_STAT_KEYS,
  layoutShareCard,
  type ShareCardLabels,
  type ShareCardOptions,
  type ShareFormat,
  type ShareStatKey,
  type WorkoutShareCard,
} from "@/lib/share-card";
import {
  canShareFile,
  deliverShareImage,
  downloadBlob,
  loadShareFonts,
  loadShareImage,
  renderShareCard,
  shareFileName,
  type ShareAssets,
} from "@/lib/share-card-render";

/**
 * "Share Workout" — opens the card preview for one completed session.
 * Either the page already holds the card (done page, history: the session is
 * on screen and scored) or only its id (Today's last workout), in which case
 * the server action builds it on tap. The dialog is the same from any entry.
 */
export function ShareWorkoutButton({
  card,
  sessionId,
  className = "rounded-lg border border-line px-4 py-2.5 text-sm font-semibold hover:border-accent disabled:opacity-50",
}: {
  card?: WorkoutShareCard;
  sessionId?: string;
  className?: string;
}) {
  const { t } = useI18n();
  const s = t.common.shareCard;
  const [open, setOpen] = useState<WorkoutShareCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function tap() {
    setError(null);
    if (card) {
      setOpen(card);
      return;
    }
    if (!sessionId) return;
    startTransition(async () => {
      const r = await loadWorkoutShareCard(sessionId);
      if (r.ok && r.card) setOpen(r.card);
      else setError(r.message ?? s.notFound);
    });
  }

  return (
    <>
      <button type="button" onClick={tap} disabled={pending} aria-busy={pending} className={className}>
        {pending ? t.common.actions.loading : s.shareWorkout}
      </button>
      {error ? <p className="text-xs text-risk">{error}</p> : null}
      {open ? <ShareWorkoutDialog card={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function useShareLabels(): ShareCardLabels {
  const { t } = useI18n();
  const s = t.common.shareCard;
  return useMemo(
    () => ({
      workoutComplete: s.workoutComplete,
      duration: s.duration,
      exercises: s.exercises,
      sets: s.sets,
      volume: s.volume,
      volumeUnit: s.volumeUnit,
      trainingLoad: s.trainingLoad,
      loadCategory: t.common.trainingLoad.category,
      newPr: s.newPr,
      prsCount: s.prsCount,
      morePrs: s.morePrs,
      brand: APP_NAME,
    }),
    [s, t.common.trainingLoad.category],
  );
}

/**
 * The preview and its controls. The card is painted at full size on every
 * option change (a 1080×1920 canvas paints in a few ms) and shown scaled;
 * Share hands that same PNG to the native sheet when the browser has one for
 * files, Save downloads it — desktop's path, and the fallback everywhere.
 */
export function ShareWorkoutDialog({ card, onClose }: { card: WorkoutShareCard; onClose: () => void }) {
  const { t, locale } = useI18n();
  const s = t.common.shareCard;
  const labels = useShareLabels();
  const [options, setOptions] = useState<ShareCardOptions>(DEFAULT_SHARE_OPTIONS);
  const [editing, setEditing] = useState(false);
  const [assets, setAssets] = useState<ShareAssets | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "ready" | "error">("idle");
  const [busy, setBusy] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Fonts and images once per open; the card's author avatar is cross-origin
  // (Google, Supabase storage) and only usable when the host allows it —
  // otherwise the initial is drawn instead.
  useEffect(() => {
    let live = true;
    Promise.all([
      loadShareFonts(),
      loadShareImage("/brand/voinic-mark.png"),
      loadShareImage("/brand/voinic-wordmark.png"),
      loadShareImage(card.profile?.avatar_url ?? null, true),
    ]).then(([fonts, mark, wordmark, avatar]) => {
      if (live) setAssets({ fonts, mark, wordmark, avatar });
    });
    return () => { live = false; };
  }, [card.profile?.avatar_url]);

  const layout = useMemo(() => layoutShareCard({ card, options, locale, labels }), [card, options, locale, labels]);

  useEffect(() => {
    if (!assets) return;
    let live = true;
    renderShareCard(layout, { assets })
      .then((png) => {
        if (!live) return;
        setBlob(png);
        setUrl(URL.createObjectURL(png));
        setStatus("idle");
      })
      .catch(() => { if (live) setStatus("error"); });
    return () => { live = false; };
  }, [layout, assets]);

  // Each preview URL is released when the next one replaces it, or on close.
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const fileName = shareFileName(card.workout.date, options.format);
  const shareable = useMemo(
    () => (blob ? canShareFile(new File([blob], fileName, { type: "image/png" })) : false),
    [blob, fileName],
  );

  const deliver = useCallback(async (mode: "share" | "save") => {
    if (!blob || busy) return;
    setBusy(true);
    try {
      const how = mode === "save"
        ? (downloadBlob(blob, fileName), "saved" as const)
        : await deliverShareImage(blob, fileName, card.workout.name);
      if (how !== "cancelled") setStatus("ready");
    } finally {
      setBusy(false);
    }
  }, [blob, busy, fileName, card.workout.name]);

  const size = SHARE_FORMAT_SIZE[options.format];
  const toggleStat = (k: ShareStatKey) =>
    setOptions((o) => ({ ...o, stats: { ...o.stats, [k]: !o.stats[k] } }));
  const setFormat = (format: ShareFormat) => setOptions((o) => ({ ...o, format }));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={s.dialogTitle}
      className="fixed inset-0 z-50 flex items-end justify-center bg-bg/80 backdrop-blur-sm p-0 sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-[100dvh] w-full max-w-lg flex-col overflow-y-auto rounded-t-2xl border border-line bg-surface p-4 sm:max-h-[92vh] sm:rounded-2xl sm:p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-bold">{s.dialogTitle}</h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={s.close}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-line text-ink-soft hover:border-accent hover:text-ink"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 flex items-center justify-center">
          <div
            className="relative w-full overflow-hidden rounded-xl bg-bg"
            // Capped by the viewport height too, so on a phone the Story
            // preview leaves the buttons on screen without scrolling.
            style={{
              maxWidth: options.format === "story" ? "min(100%, 300px, calc(52dvh * 0.5625))" : "min(100%, 420px, 52dvh)",
              aspectRatio: `${size.width} / ${size.height}`,
            }}
          >
            {url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url} alt={s.previewAlt} width={size.width} height={size.height} className="block h-full w-full" data-testid="share-card-preview" />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-ink-faint">
                {status === "error" ? (
                  <span className="px-4 text-center text-sm text-risk">{s.renderError}</span>
                ) : (
                  <span role="status" aria-label={s.preparing} className="inline-block h-8 w-8 animate-spin rounded-full border-[3px] border-current border-r-transparent text-accent-ink" />
                )}
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 flex items-center justify-center gap-2" role="radiogroup" aria-label={s.format}>
          {SHARE_FORMATS.map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={options.format === f}
              onClick={() => setFormat(f)}
              className={`min-h-10 rounded-lg px-4 text-sm font-semibold ${
                options.format === f ? "bg-accent text-accent-fg" : "border border-line text-ink-soft hover:border-accent hover:text-ink"
              }`}
            >
              {f === "story" ? s.story : s.square}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          aria-expanded={editing}
          className="mt-3 min-h-10 w-full rounded-lg border border-line px-4 text-sm font-semibold hover:border-accent"
        >
          {s.editStats}
        </button>
        {editing ? (
          <div className="mt-2 rounded-lg border border-line bg-bg p-3">
            <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
              {SHARE_STAT_KEYS.map((k) => (
                <li key={k}>
                  <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm">
                    <input type="checkbox" checked={options.stats[k]} onChange={() => toggleStat(k)} className="h-4 w-4 accent-accent" />
                    {s[k === "load" ? "trainingLoad" : k]}
                  </label>
                </li>
              ))}
            </ul>
            {card.profile ? (
              <div className="mt-2 flex gap-2 border-t border-line pt-2" role="radiogroup" aria-label={s.showProfile}>
                {([true, false] as const).map((show) => (
                  <button
                    key={String(show)}
                    type="button"
                    role="radio"
                    aria-checked={options.showProfile === show}
                    onClick={() => setOptions((o) => ({ ...o, showProfile: show }))}
                    className={`min-h-9 flex-1 rounded-lg px-3 text-xs font-semibold ${
                      options.showProfile === show ? "bg-accent text-accent-fg" : "border border-line text-ink-soft hover:border-accent hover:text-ink"
                    }`}
                  >
                    {show ? s.showProfile : s.hideProfile}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          {shareable ? (
            <button
              type="button"
              onClick={() => deliver("share")}
              disabled={!blob || busy}
              className="min-h-11 flex-1 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-fg disabled:opacity-50"
            >
              {s.share}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => deliver("save")}
            disabled={!blob || busy}
            className={`min-h-11 flex-1 rounded-lg px-4 text-sm font-semibold disabled:opacity-50 ${
              shareable ? "border border-line hover:border-accent" : "bg-accent text-accent-fg"
            }`}
          >
            {s.saveImage}
          </button>
          <button type="button" onClick={onClose} className="min-h-11 rounded-lg border border-line px-4 text-sm font-semibold hover:border-accent">
            {s.close}
          </button>
        </div>
        {status === "ready" ? <p className="mt-3 text-center text-sm font-semibold text-accent-ink" role="status">{s.ready}</p> : null}
      </div>
    </div>
  );
}
