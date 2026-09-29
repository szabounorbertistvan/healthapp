"use client";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  OVERLAY_SCALE, OVERLAY_SIZES, OVERLAY_STAT_KEYS, OVERLAY_STAT_STYLES, OVERLAY_TEXT_MAX, OVERLAY_TEXT_STYLES,
  clampOverlayScale, nextOverlayStyle,
  type OverlayStatKey, type PhotoOverlay,
} from "@healthapp/shared";
import {
  OVERLAY_METRICS as M, PILL_BG, TEXT_GOLD, clampCentre, defaultStatsPlacement, defaultTextPlacement,
  layoutStats, overlayStatRows, type OverlayStatValues,
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
  src, width, height, overlay, stats, className = "", children, priority = false, alt, onError,
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
  /** The picture failed to load — an expired /api/media link, most likely. */
  onError?: () => void;
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
        onError={onError}
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
  ref?: React.Ref<HTMLDivElement>;
  onPointerDown?: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onKeyDown?: (e: ReactKeyboardEvent<HTMLDivElement>) => void;
  tabIndex?: number;
  role?: string;
  "aria-label"?: string;
  "data-dragging"?: boolean;
};

type HandleProps = {
  onPointerDown: (e: ReactPointerEvent<HTMLSpanElement>) => void;
  "aria-label": string;
};

const DRAGGABLE = "cursor-grab touch-none select-none outline-none ring-white/70 focus-visible:ring-2 data-[dragging=true]:cursor-grabbing";

/**
 * The resize handle in an element's lower right corner, in the editor only.
 * A fixed pixel size, not cqw: it is a control, not part of the picture.
 */
function Handle(props: HandleProps) {
  return (
    <span
      {...props}
      role="presentation"
      className="absolute -bottom-3 -right-3 z-10 grid h-6 w-6 cursor-nwse-resize touch-none place-items-center rounded-full border-2 border-white bg-accent shadow-md"
    >
      <svg viewBox="0 0 12 12" className="h-3 w-3 text-accent-fg" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
        <path d="M4 11 11 4M8 11l3-3" />
      </svg>
    </span>
  );
}

/**
 * The workout's figures, placed cell by cell from layoutStats() — the same
 * cells the story painter draws, so the card and the story agree for every
 * style. White on the picture with a soft shadow.
 */
function StatsBlock({ item, stats, drag, handle }: {
  item: NonNullable<PhotoOverlay["stats"]>;
  stats: OverlayStatValues;
  drag?: DragProps;
  handle?: HandleProps;
}) {
  const rows = overlayStatRows(item, stats);
  if (rows.length === 0) return null;
  const box = layoutStats(rows.length, item.style, item.scale);
  return (
    <div
      {...drag}
      style={{ ...centred(item.x, item.y), width: cqw(box.w), height: cqw(box.h), color: "#fff", textShadow: SHADOW }}
      className={drag ? `${DRAGGABLE} rounded-lg outline-1 outline-dashed outline-white/40` : "pointer-events-none"}
    >
      {rows.map(({ key, stat }, i) => {
        const c = box.cells[i]!;
        const cell: CSSProperties = { position: "absolute", left: cqw(c.x), top: cqw(c.y), width: cqw(c.w), textAlign: c.align };
        const value = (
          <>
            {stat.value}
            {stat.unit ? (
              <span className="font-sans font-semibold" style={{ fontSize: cqw(c.unit), marginLeft: cqw(c.unit * 0.35), opacity: 0.85 }}>
                {stat.unit}
              </span>
            ) : null}
          </>
        );
        const label = (
          <span className="font-sans font-semibold uppercase" style={{ fontSize: cqw(c.label), letterSpacing: "0.08em", opacity: 0.85 }}>
            {stat.label}
          </span>
        );
        return c.arrangement === "stack" ? (
          <div key={key} style={cell} className="min-w-0">
            <p className="truncate" style={{ lineHeight: 1.2, fontSize: cqw(c.label) }}>{label}</p>
            <p className="truncate font-display font-extrabold tabular-nums" style={{ fontSize: cqw(c.value), lineHeight: 1, marginTop: cqw(c.gap) }}>
              {value}
            </p>
          </div>
        ) : (
          <p key={key} style={{ ...cell, display: "flex", alignItems: "baseline", gap: cqw(c.gap), lineHeight: 1 }} className="min-w-0 truncate">
            <span className="font-display font-extrabold tabular-nums" style={{ fontSize: cqw(c.value) }}>{value}</span>
            {label}
          </p>
        );
      })}
      {handle ? <Handle {...handle} /> : null}
    </div>
  );
}

/** The text's font, colour and shadow for a style — shared by the line and its inline editor. */
function textLook(item: Pick<NonNullable<PhotoOverlay["text"]>, "scale" | "style">): CSSProperties {
  const pill = item.style === "pill";
  return {
    fontSize: cqw(M.textSize, item.scale),
    lineHeight: pill ? M.pillLineHeight : M.textLineHeight,
    color: item.style === "gold" ? TEXT_GOLD : "#fff",
    textShadow: pill ? "none" : SHADOW,
  };
}

/**
 * The line the author wrote on the picture: plain white, gold, or white on a
 * dark pill per line — the pill as Instagram draws it, one background per
 * wrapped line (box-decoration-break), which the story painter mirrors. The
 * box hugs the text (up to the wrap width), so the handle sits at its corner.
 */
function TextLine({ item, drag, handle }: { item: NonNullable<PhotoOverlay["text"]>; drag?: DragProps; handle?: HandleProps }) {
  const pill = item.style === "pill";
  return (
    <div
      {...drag}
      style={{ ...centred(item.x, item.y), width: "max-content", maxWidth: cqw(M.textMaxW), ...textLook(item) }}
      className={`break-words text-center font-display font-extrabold ${
        drag ? `${DRAGGABLE} rounded-lg outline-1 outline-dashed outline-white/40` : "pointer-events-none"
      }`}
    >
      {pill ? (
        <span
          style={{
            background: PILL_BG,
            padding: `${M.pillPadY}em ${M.pillPadX}em`,
            borderRadius: "0.28em",
            boxDecorationBreak: "clone",
            WebkitBoxDecorationBreak: "clone",
          }}
        >
          {item.body}
        </span>
      ) : (
        item.body
      )}
      {handle ? <Handle {...handle} /> : null}
    </div>
  );
}

// ---------- the editor ----------

type Placed = { x: number; y: number; scale: number };

/** Movement under this many pixels between press and release is a tap, not a drag. */
const TAP_SLOP = 6;

/**
 * Drag an element around the frame, tap it, and resize it by its corner
 * handle — the Instagram sticker gestures. Pointer events with capture, so a
 * drag that leaves the picture still ends cleanly; the element's own box
 * (measured at press) keeps its centre from leaving the photo. The handle
 * scales by how far the pointer is from the element's centre compared with
 * where it started. For the keyboard: arrows nudge by 1 %, + and − resize,
 * Enter or Space is the tap.
 */
function useSticker(
  frame: React.RefObject<HTMLDivElement | null>,
  at: Placed,
  on: { move: (p: { x: number; y: number }) => void; scale: (scale: number) => void; tap: () => void },
  labels: { element: string; resize: string },
): { drag: DragProps; handle: HandleProps } {
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ px: number; py: number; x: number; y: number; halfW: number; halfH: number; moved: boolean } | null>(null);
  const el = useRef<HTMLDivElement | null>(null);

  function bounds(node: HTMLElement) {
    const f = frame.current?.getBoundingClientRect();
    if (!f || f.width === 0 || f.height === 0) return { halfW: 0, halfH: 0 };
    const r = node.getBoundingClientRect();
    return { halfW: r.width / f.width / 2, halfH: r.height / f.height / 2 };
  }

  // Whatever changed its box — a new look, a new size, longer words — the
  // element is measured after the render and pushed back inside the photo
  // if it now reaches past an edge. Not during a drag: that clamps as it goes.
  useLayoutEffect(() => {
    const node = el.current;
    if (!node || start.current) return;
    const { halfW, halfH } = bounds(node);
    const c = clampCentre(at.x, at.y, halfW, halfH);
    if (Math.abs(c.x - at.x) > 0.0015 || Math.abs(c.y - at.y) > 0.0015) on.move(c);
  });

  const drag: DragProps = {
    ref: el,
    "data-dragging": dragging,
    "aria-label": labels.element,
    tabIndex: 0,
    role: "button",
    onPointerDown(e) {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      e.preventDefault();
      const el = e.currentTarget;
      el.setPointerCapture(e.pointerId);
      start.current = { px: e.clientX, py: e.clientY, x: at.x, y: at.y, ...bounds(el), moved: false };
      setDragging(true);
      const move = (ev: PointerEvent) => {
        const s = start.current;
        const f = frame.current?.getBoundingClientRect();
        if (!s || !f || f.width === 0 || f.height === 0) return;
        if (!s.moved && Math.hypot(ev.clientX - s.px, ev.clientY - s.py) < TAP_SLOP) return;
        s.moved = true;
        on.move(clampCentre(s.x + (ev.clientX - s.px) / f.width, s.y + (ev.clientY - s.py) / f.height, s.halfW, s.halfH));
      };
      const up = (ev: PointerEvent) => {
        const tapped = ev.type === "pointerup" && start.current !== null && !start.current.moved;
        start.current = null;
        setDragging(false);
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", up);
        el.removeEventListener("pointercancel", up);
        if (tapped) on.tap();
      };
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
    },
    onKeyDown(e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        on.tap();
        return;
      }
      if (e.key === "+" || e.key === "=" || e.key === "-" || e.key === "_") {
        e.preventDefault();
        on.scale(clampOverlayScale(at.scale + (e.key === "-" || e.key === "_" ? -0.05 : 0.05)));
        return;
      }
      const step = e.shiftKey ? 0.05 : 0.01;
      const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      const delta = d[e.key];
      if (!delta) return;
      e.preventDefault();
      const { halfW, halfH } = bounds(e.currentTarget);
      on.move(clampCentre(at.x + delta[0], at.y + delta[1], halfW, halfH));
    },
  };

  const handle: HandleProps = {
    "aria-label": labels.resize,
    onPointerDown(e) {
      e.preventDefault();
      e.stopPropagation(); // the element's own press would start a move
      const knob = e.currentTarget;
      const box = knob.parentElement?.getBoundingClientRect();
      if (!box) return;
      knob.setPointerCapture(e.pointerId);
      const cx = box.left + box.width / 2;
      const cy = box.top + box.height / 2;
      const d0 = Math.max(8, Math.hypot(e.clientX - cx, e.clientY - cy));
      const s0 = at.scale;
      const move = (ev: PointerEvent) => on.scale(clampOverlayScale(s0 * (Math.hypot(ev.clientX - cx, ev.clientY - cy) / d0)));
      const up = () => {
        knob.removeEventListener("pointermove", move);
        knob.removeEventListener("pointerup", up);
        knob.removeEventListener("pointercancel", up);
      };
      knob.addEventListener("pointermove", move);
      knob.addEventListener("pointerup", up);
      knob.addEventListener("pointercancel", up);
    },
  };

  return { drag, handle };
}

function DraggableStats({ frame, item, stats, onChange }: {
  frame: React.RefObject<HTMLDivElement | null>;
  item: NonNullable<PhotoOverlay["stats"]>;
  stats: OverlayStatValues;
  onChange: (next: NonNullable<PhotoOverlay["stats"]>) => void;
}) {
  const { t } = useI18n();
  const s = t.common.social;
  const { drag, handle } = useSticker(
    frame,
    item,
    {
      move: (p) => onChange({ ...item, ...p }),
      scale: (scale) => onChange({ ...item, scale }),
      // A tap changes the look, the way an Instagram sticker does.
      tap: () => onChange({ ...item, style: nextOverlayStyle(OVERLAY_STAT_STYLES, item.style) }),
    },
    { element: s.overlayStats, resize: s.overlayResize },
  );
  return <StatsBlock item={item} stats={stats} drag={drag} handle={handle} />;
}

function DraggableText({ frame, item, onChange, onEdit }: {
  frame: React.RefObject<HTMLDivElement | null>;
  item: NonNullable<PhotoOverlay["text"]>;
  onChange: (next: NonNullable<PhotoOverlay["text"]>) => void;
  onEdit: () => void;
}) {
  const { t } = useI18n();
  const s = t.common.social;
  const { drag, handle } = useSticker(
    frame,
    item,
    {
      move: (p) => onChange({ ...item, ...p }),
      scale: (scale) => onChange({ ...item, scale }),
      // A tap opens the words for editing, the way Instagram text does.
      tap: onEdit,
    },
    { element: s.overlayText, resize: s.overlayResize },
  );
  return <TextLine item={item} drag={drag} handle={handle} />;
}

/**
 * The text being edited in place: an input with the line's own font, colour
 * and size, where the line sits. Enter, Escape or leaving it closes it; the
 * words are the editor's, so the panel's field shows the same.
 */
function InlineTextEditor({ at, value, onChange, onDone }: {
  at: Pick<NonNullable<PhotoOverlay["text"]>, "x" | "y" | "scale" | "style">;
  value: string;
  onChange: (value: string) => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  return (
    <input
      ref={ref}
      value={value}
      maxLength={OVERLAY_TEXT_MAX}
      onChange={(e) => onChange(e.target.value.slice(0, OVERLAY_TEXT_MAX))}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); onDone(); } }}
      onBlur={onDone}
      placeholder={t.common.social.overlayTextPlaceholder}
      aria-label={t.common.social.overlayText}
      style={{
        ...centred(at.x, at.y),
        width: cqw(M.textMaxW),
        ...textLook(at),
        background: at.style === "pill" ? PILL_BG : "rgba(0,0,0,0.25)",
      }}
      className="z-20 rounded-lg border-0 px-2 text-center font-display font-extrabold outline-2 outline-dashed outline-white/70 placeholder:text-white/50"
    />
  );
}

/**
 * Place things on the photo before posting: the workout's figures (when the
 * post is a workout) and a line of text. Both drag and resize on the photo;
 * a tap changes the figures' look and opens the text for editing, and the
 * panel under the photo does the same for anyone who prefers buttons.
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
  const [editingText, setEditingText] = useState(false);
  // Where the text was last, so clearing it while editing and typing again
  // brings it back in the same place, size and look.
  const lastText = useRef<Omit<NonNullable<PhotoOverlay["text"]>, "body">>({ ...defaultTextPlacement(), scale: 1, style: "plain" });
  if (value?.text) lastText.current = { x: value.text.x, y: value.text.y, scale: value.text.scale, style: value.text.style };
  const available = OVERLAY_STAT_KEYS.filter((k) => stats?.[k]);
  const aspect = height / width;

  function set(next: Partial<PhotoOverlay>) {
    const merged: PhotoOverlay = { stats: value?.stats ?? null, text: value?.text ?? null, ...next };
    onChange(merged.stats || merged.text ? merged : null);
  }

  function toggleStats(on: boolean) {
    if (!on) return set({ stats: null });
    set({ stats: { ...defaultStatsPlacement(available.length, aspect), keys: [...available], scale: 1, style: "grid" } });
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
      set({ text: cur ? { ...cur, body } : { ...lastText.current, body } });
    }, 120);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const chip = (on: boolean) =>
    `inline-flex h-8 items-center rounded-full px-3 text-[12px] font-semibold transition-colors disabled:opacity-50 ${
      on ? "bg-accent text-accent-fg" : "bg-bg text-ink-soft hover:text-ink"
    }`;

  // The same cycle a tap on the figures does, for anyone who has not found the tap.
  const styleButton = (label: string, onCycle: () => void) => (
    <button
      type="button"
      disabled={disabled}
      onClick={onCycle}
      title={s.overlayStyle}
      className="ml-auto inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full bg-bg px-3 text-[12px] font-semibold text-ink-soft hover:text-ink disabled:opacity-50"
    >
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4" />
      </svg>
      {label}
    </button>
  );

  // Presets next to the handle: a quick S / M / L, lit when the scale is one of them.
  const sizePicker = (current: number, onPick: (scale: number) => void) => (
    <span className="inline-flex gap-0.5 rounded-full bg-bg p-0.5" role="group" aria-label={s.overlaySize}>
      {OVERLAY_SIZES.map((size) => {
        const on = Math.abs(current - OVERLAY_SCALE[size]) < 0.005;
        return (
          <button
            key={size}
            type="button"
            disabled={disabled}
            onClick={() => onPick(OVERLAY_SCALE[size])}
            aria-pressed={on}
            className={`h-7 w-8 cursor-pointer rounded-full text-[11.5px] font-bold uppercase ${on ? "bg-surface text-ink shadow-sm" : "text-ink-faint hover:text-ink"}`}
          >
            {size}
          </button>
        );
      })}
    </span>
  );

  return (
    <div className="space-y-3">
      <div ref={frame} className="overflow-hidden rounded-2xl">
        <PhotoFrame src={src} width={width} height={height} overlay={null} stats={stats ?? {}} priority>
          {value?.stats && stats ? (
            <DraggableStats frame={frame} item={value.stats} stats={stats} onChange={(next) => set({ stats: next })} />
          ) : null}
          {editingText ? (
            <InlineTextEditor at={value?.text ?? lastText.current} value={text} onChange={setText} onDone={() => setEditingText(false)} />
          ) : value?.text ? (
            <DraggableText frame={frame} item={value.text} onChange={(next) => set({ text: next })} onEdit={() => !disabled && setEditingText(true)} />
          ) : null}
        </PhotoFrame>
      </div>
      <p className="text-[12px] leading-relaxed text-ink-faint">{s.overlayDragHint}</p>

      {stats && available.length > 0 ? (
        <div className="rounded-2xl bg-bg/60 p-3">
          <div className="flex flex-wrap items-center gap-2">
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
            {value?.stats ? (
              <>
                {styleButton(s.overlayStatStyles[value.stats.style], () => set({ stats: { ...value.stats!, style: nextOverlayStyle(OVERLAY_STAT_STYLES, value.stats!.style) } }))}
                {sizePicker(value.stats.scale, (scale) => set({ stats: { ...value.stats!, scale } }))}
              </>
            ) : null}
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
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="overlay-text" className="text-[13px] font-semibold text-ink-soft">{s.overlayText}</label>
          {value?.text ? (
            <>
              {styleButton(s.overlayTextStyles[value.text.style], () => set({ text: { ...value.text!, style: nextOverlayStyle(OVERLAY_TEXT_STYLES, value.text!.style) } }))}
              {sizePicker(value.text.scale, (scale) => set({ text: { ...value.text!, scale } }))}
            </>
          ) : null}
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
