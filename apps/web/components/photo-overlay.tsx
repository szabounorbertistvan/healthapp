"use client";
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  OVERLAY_SCALE, OVERLAY_SIZES, OVERLAY_STAT_KEYS, OVERLAY_TEXT_MAX,
  type OverlaySize, type OverlayStatKey, type PhotoOverlay,
} from "@healthapp/shared";
import {
  OVERLAY_METRICS as M, clampCentre, defaultStatsPlacement, defaultTextPlacement,
  overlayColumns, overlayStatRows, overlayStatsBox, type OverlayStatValues,
} from "@/lib/photo-overlay";
import { useI18n } from "@/lib/i18n/client";

/**
 * A post photo with whatever the author put on it.
 *
 * The frame is a CSS container: every size on the overlay is in `cqw`, so the
 * block that sits at 6 % from the left edge on a 360px phone card sits at 6 %
 * on the 680px desktop card and on the 1080px story — the same fractions the
 * canvas painter in lib/photo-story.ts multiplies out. The box is reserved
 * from photo_w / photo_h before the picture arrives, so the card never jumps
 * and the overlay is already in place.
 */
export function PhotoFrame({
  src, width, height, overlay, stats, className = "", children, priority = false, alt,
}: {
  src: string;
  width: number | null;
  height: number | null;
  overlay: PhotoOverlay | null;
  stats: OverlayStatValues;
  className?: string;
  children?: React.ReactNode;
  priority?: boolean;
  /** A description of the picture. Without one it is decorative (the card says what it is). */
  alt?: string;
}) {
  const sized = width !== null && height !== null;
  return (
    <div
      className={`@container relative w-full overflow-hidden bg-bg ${className}`}
      style={sized ? { aspectRatio: `${width} / ${height}` } : undefined}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt ?? ""}
        aria-hidden={alt ? undefined : true}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        draggable={false}
        className={`block w-full select-none object-cover ${sized ? "h-full" : "max-h-[28rem]"}`}
      />
      {overlay?.stats ? <StatsBlock item={overlay.stats} stats={stats} /> : null}
      {overlay?.text ? <TextLine item={overlay.text} /> : null}
      {children}
    </div>
  );
}

const SHADOW = "0 1px 2px rgba(0,0,0,.6), 0 2px 12px rgba(0,0,0,.45)";

function centred(x: number, y: number): CSSProperties {
  return { position: "absolute", left: `${x * 100}%`, top: `${y * 100}%`, transform: "translate(-50%, -50%)" };
}

function cqw(fraction: number, k = 1): string {
  return `${fraction * k * 100}cqw`;
}

type DragProps = {
  onPointerDown?: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onKeyDown?: (e: ReactKeyboardEvent<HTMLDivElement>) => void;
  tabIndex?: number;
  role?: string;
  "aria-label"?: string;
  "data-dragging"?: boolean;
};

/** The workout's figures: a small grid, white on the picture, label over number. */
function StatsBlock({ item, stats, drag }: { item: NonNullable<PhotoOverlay["stats"]>; stats: OverlayStatValues; drag?: DragProps }) {
  const rows = overlayStatRows(item, stats);
  if (rows.length === 0) return null;
  const k = OVERLAY_SCALE[item.size];
  const cols = overlayColumns(rows.length);
  return (
    <div
      {...drag}
      style={{
        ...centred(item.x, item.y),
        display: "grid",
        gridTemplateColumns: `repeat(${cols}, ${cqw(M.statColW, k)})`,
        columnGap: cqw(M.statGapX, k),
        rowGap: cqw(M.statGapY, k),
        color: "#fff",
        textShadow: SHADOW,
      }}
      className={drag ? "cursor-grab touch-none select-none rounded-lg outline-none ring-white/70 focus-visible:ring-2 data-[dragging=true]:cursor-grabbing" : "pointer-events-none"}
    >
      {rows.map(({ key, stat }) => (
        <div key={key} className="min-w-0">
          <p
            className="truncate font-semibold uppercase"
            style={{ fontSize: cqw(M.statLabel, k), lineHeight: 1.2, letterSpacing: "0.08em", opacity: 0.85 }}
          >
            {stat.label}
          </p>
          <p
            className="truncate font-display font-extrabold tabular-nums"
            style={{ fontSize: cqw(M.statValue, k), lineHeight: 1, marginTop: cqw(M.statLabelGap, k) }}
          >
            {stat.value}
            {stat.unit ? (
              <span className="font-sans font-semibold" style={{ fontSize: cqw(M.statUnit, k), marginLeft: cqw(0.01, k), opacity: 0.85 }}>
                {stat.unit}
              </span>
            ) : null}
          </p>
        </div>
      ))}
    </div>
  );
}

/** The line the author wrote on the picture. */
function TextLine({ item, drag }: { item: NonNullable<PhotoOverlay["text"]>; drag?: DragProps }) {
  const k = OVERLAY_SCALE[item.size];
  return (
    <div
      {...drag}
      style={{
        ...centred(item.x, item.y),
        width: cqw(M.textMaxW),
        fontSize: cqw(M.textSize, k),
        lineHeight: M.textLineHeight,
        color: "#fff",
        textShadow: SHADOW,
      }}
      className={`break-words text-center font-display font-extrabold ${
        drag ? "cursor-grab touch-none select-none rounded-lg outline-none ring-white/70 focus-visible:ring-2 data-[dragging=true]:cursor-grabbing" : "pointer-events-none"
      }`}
    >
      {item.body}
    </div>
  );
}

// ---------- the editor ----------

type Placed = { x: number; y: number };

/**
 * Drag one element around the frame. Pointer events with capture, so a drag
 * that leaves the picture still ends cleanly; the element's own box (measured
 * at the first move) keeps its centre from leaving the photo. Arrow keys nudge
 * by 1 % for anyone not using a pointer.
 */
function useDrag(frame: React.RefObject<HTMLDivElement | null>, at: Placed, onMove: (next: Placed) => void): DragProps & { dragging: boolean } {
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ px: number; py: number; x: number; y: number; halfW: number; halfH: number } | null>(null);

  function bounds(el: HTMLElement) {
    const f = frame.current?.getBoundingClientRect();
    if (!f || f.width === 0 || f.height === 0) return { halfW: 0, halfH: 0 };
    const r = el.getBoundingClientRect();
    return { halfW: r.width / f.width / 2, halfH: r.height / f.height / 2 };
  }

  return {
    dragging,
    "data-dragging": dragging,
    tabIndex: 0,
    role: "button",
    onPointerDown(e) {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      e.preventDefault();
      const el = e.currentTarget;
      el.setPointerCapture(e.pointerId);
      start.current = { px: e.clientX, py: e.clientY, x: at.x, y: at.y, ...bounds(el) };
      setDragging(true);
      const move = (ev: PointerEvent) => {
        const s = start.current;
        const f = frame.current?.getBoundingClientRect();
        if (!s || !f || f.width === 0 || f.height === 0) return;
        onMove(clampCentre(s.x + (ev.clientX - s.px) / f.width, s.y + (ev.clientY - s.py) / f.height, s.halfW, s.halfH));
      };
      const up = () => {
        start.current = null;
        setDragging(false);
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", up);
        el.removeEventListener("pointercancel", up);
      };
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
    },
    onKeyDown(e) {
      const step = e.shiftKey ? 0.05 : 0.01;
      const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      const delta = d[e.key];
      if (!delta) return;
      e.preventDefault();
      const { halfW, halfH } = bounds(e.currentTarget);
      onMove(clampCentre(at.x + delta[0], at.y + delta[1], halfW, halfH));
    },
  };
}

function DraggableStats({ frame, item, stats, onChange }: {
  frame: React.RefObject<HTMLDivElement | null>;
  item: NonNullable<PhotoOverlay["stats"]>;
  stats: OverlayStatValues;
  onChange: (next: NonNullable<PhotoOverlay["stats"]>) => void;
}) {
  const { t } = useI18n();
  const { dragging: _d, ...drag } = useDrag(frame, item, (p) => onChange({ ...item, ...p }));
  return <StatsBlock item={item} stats={stats} drag={{ ...drag, "aria-label": t.common.social.overlayStats }} />;
}

function DraggableText({ frame, item, onChange }: {
  frame: React.RefObject<HTMLDivElement | null>;
  item: NonNullable<PhotoOverlay["text"]>;
  onChange: (next: NonNullable<PhotoOverlay["text"]>) => void;
}) {
  const { t } = useI18n();
  const { dragging: _d, ...drag } = useDrag(frame, item, (p) => onChange({ ...item, ...p }));
  return <TextLine item={item} drag={{ ...drag, "aria-label": t.common.social.overlayText }} />;
}

/**
 * Place things on the photo before posting: the workout's figures (when the
 * post is a workout) and a line of text. Both drag; both come in three sizes.
 * `value` is the overlay exactly as it will be stored (normalizePhotoOverlay
 * on the server is the last word), `stats` the figures this post can show,
 * already formatted — null for a post that is not a workout.
 */
export function PhotoOverlayEditor({
  src, width, height, stats, value, onChange, disabled = false,
}: {
  src: string;
  width: number;
  height: number;
  stats: OverlayStatValues | null;
  value: PhotoOverlay | null;
  onChange: (next: PhotoOverlay | null) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const s = t.common.social;
  const frame = useRef<HTMLDivElement>(null);
  const [text, setText] = useState(value?.text?.body ?? "");
  const available = OVERLAY_STAT_KEYS.filter((k) => stats?.[k]);
  const aspect = height / width;

  function set(next: Partial<PhotoOverlay>) {
    const merged: PhotoOverlay = { stats: value?.stats ?? null, text: value?.text ?? null, ...next };
    onChange(merged.stats || merged.text ? merged : null);
  }

  function toggleStats(on: boolean) {
    if (!on) return set({ stats: null });
    set({ stats: { ...defaultStatsPlacement(available.length, aspect), keys: [...available], size: "m" } });
  }

  function toggleKey(key: OverlayStatKey) {
    const cur = value?.stats;
    if (!cur) return;
    const keys = cur.keys.includes(key) ? cur.keys.filter((k) => k !== key) : OVERLAY_STAT_KEYS.filter((k) => k === key || cur.keys.includes(k));
    set({ stats: keys.length === 0 ? null : { ...cur, keys } });
  }

  // The text on the picture follows the box with a short delay, so a keystroke
  // does not re-place the line mid-word.
  useEffect(() => {
    const body = text.replace(/\s+/g, " ").trim().slice(0, OVERLAY_TEXT_MAX);
    const timer = setTimeout(() => {
      const cur = value?.text;
      if (!body) {
        if (cur) set({ text: null });
        return;
      }
      if (cur?.body === body) return;
      set({ text: cur ? { ...cur, body } : { ...defaultTextPlacement(), body, size: "m" } });
    }, 120);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const chip = (on: boolean) =>
    `inline-flex h-8 items-center rounded-full px-3 text-[12px] font-semibold transition-colors disabled:opacity-50 ${
      on ? "bg-accent text-accent-fg" : "bg-bg text-ink-soft hover:text-ink"
    }`;

  const sizePicker = (current: OverlaySize, onPick: (size: OverlaySize) => void) => (
    <span className="ml-auto inline-flex gap-0.5 rounded-full bg-bg p-0.5" role="group" aria-label={s.overlaySize}>
      {OVERLAY_SIZES.map((size) => (
        <button
          key={size}
          type="button"
          disabled={disabled}
          onClick={() => onPick(size)}
          aria-pressed={current === size}
          className={`h-7 w-8 rounded-full text-[11.5px] font-bold uppercase ${current === size ? "bg-surface text-ink shadow-sm" : "text-ink-faint hover:text-ink"}`}
        >
          {size}
        </button>
      ))}
    </span>
  );

  return (
    <div className="space-y-3">
      <div ref={frame} className="overflow-hidden rounded-2xl">
        <PhotoFrame src={src} width={width} height={height} overlay={null} stats={stats ?? {}} priority>
          {value?.stats && stats ? (
            <DraggableStats frame={frame} item={value.stats} stats={stats} onChange={(next) => set({ stats: next })} />
          ) : null}
          {value?.text ? <DraggableText frame={frame} item={value.text} onChange={(next) => set({ text: next })} /> : null}
        </PhotoFrame>
      </div>
      <p className="text-[12px] leading-relaxed text-ink-faint">{s.overlayDragHint}</p>

      {stats && available.length > 0 ? (
        <div className="rounded-2xl bg-bg/60 p-3">
          <div className="flex items-center gap-2">
            <label className="inline-flex min-h-9 items-center gap-2 text-[13px] font-semibold text-ink-soft">
              <input
                type="checkbox"
                disabled={disabled}
                checked={Boolean(value?.stats)}
                onChange={(e) => toggleStats(e.target.checked)}
                className="h-4 w-4 accent-[var(--color-accent)]"
              />
              {s.overlayStats}
            </label>
            {value?.stats ? sizePicker(value.stats.size, (size) => set({ stats: { ...value.stats!, size } })) : null}
          </div>
          {value?.stats ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {available.map((key) => (
                <button key={key} type="button" disabled={disabled} onClick={() => toggleKey(key)} aria-pressed={value.stats!.keys.includes(key)} className={chip(value.stats!.keys.includes(key))}>
                  {stats[key]!.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="rounded-2xl bg-bg/60 p-3">
        <div className="flex items-center gap-2">
          <label htmlFor="overlay-text" className="text-[13px] font-semibold text-ink-soft">{s.overlayText}</label>
          {value?.text ? sizePicker(value.text.size, (size) => set({ text: { ...value.text!, size } })) : null}
        </div>
        <input
          id="overlay-text"
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value.slice(0, OVERLAY_TEXT_MAX))}
          maxLength={OVERLAY_TEXT_MAX}
          placeholder={s.overlayTextPlaceholder}
          className="mt-2 h-10 w-full rounded-xl border border-line bg-bg px-3 text-sm outline-none focus:border-accent"
        />
      </div>
    </div>
  );
}
