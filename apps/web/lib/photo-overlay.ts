// What sits on a post photo, and where — pure, no DOM, so the feed card, the
// drag editor and the 1080px story export all place the same overlay the
// same way. Every length here is a FRACTION OF THE PHOTO'S WIDTH: the card
// turns it into container-query units (1cqw = 1 % of the photo's width), the
// canvas multiplies by its pixel width.
import { type OverlayStatKey, type OverlayStatStyle, type PhotoOverlay } from "@healthapp/shared";

/** Font sizes and gaps, as fractions of the photo width, at size "m" (the grid style's, and the text's). */
export const OVERLAY_METRICS = {
  /** the small caps label over each figure */
  statLabel: 0.024,
  /** the figure */
  statValue: 0.06,
  /** its unit ("kg"), next to the figure */
  statUnit: 0.026,
  /** gap between label and figure */
  statLabelGap: 0.008,
  /** one column of the grid */
  statColW: 0.25,
  statGapX: 0.05,
  statGapY: 0.035,
  /** free text */
  textSize: 0.056,
  textMaxW: 0.78,
  textLineHeight: 1.15,
  /** the pill style: taller lines so the pills just touch, and the pill's padding, in em */
  pillLineHeight: 1.3,
  pillPadX: 0.35,
  pillPadY: 0.12,
} as const;

const M = OVERLAY_METRICS;

/** The pill text style's background and the gold style's ink — the card and the story painter share them. */
export const PILL_BG = "rgba(11,11,13,0.62)";
export const TEXT_GOLD = "#e6c25a";

/** One figure's box inside the stats block. Every length a fraction of the photo's width, relative to the block's top-left. */
export type StatCell = {
  x: number;
  y: number;
  w: number;
  /** font sizes */
  label: number;
  value: number;
  unit: number;
  /** stack: label over figure; inline: figure, unit, then the label beside it */
  arrangement: "stack" | "inline";
  /** gap between label and figure (stack), or between figure and label (inline) */
  gap: number;
  align: "left" | "center";
};

export type StatsLayout = { w: number; h: number; cells: StatCell[] };

/** How tall one cell is: a label line and the figure, or the figure alone. */
export function statCellHeight(c: Pick<StatCell, "arrangement" | "label" | "value" | "gap">): number {
  return c.arrangement === "stack" ? c.label * 1.2 + c.gap + c.value : c.value;
}

/** No block may be wider than this share of the photo; a wider one is scaled down whole. */
const MAX_BLOCK_W = 0.92;

type CellSpec = Omit<StatCell, "x" | "y">;

function cells(spec: CellSpec, n: number, cols: number, gapX: number, gapY: number, top = 0): StatCell[] {
  const h = statCellHeight(spec);
  return Array.from({ length: n }, (_, i) => ({
    ...spec,
    x: (i % cols) * (spec.w + gapX),
    y: top + Math.floor(i / cols) * (h + gapY),
  }));
}

/**
 * Where each of n figures sits for a style and a size multiplier (`k`, the item's scale). Pure and shared, so
 * the feed card (DOM, in cqw) and the story (canvas, in pixels) put every
 * figure in the same place. The whole block is scaled down if it would be
 * wider than the photo allows.
 */
export function layoutStats(n: number, style: OverlayStatStyle, k: number): StatsLayout {
  let out: StatCell[] = [];
  if (n > 0) {
    if (style === "row") {
      out = cells({ w: 0.16 * k, label: 0.018 * k, value: 0.042 * k, unit: 0.019 * k, gap: 0.006 * k, arrangement: "stack", align: "center" }, n, n, 0.015 * k, 0);
    } else if (style === "column") {
      out = cells({ w: 0.56 * k, label: 0.024 * k, value: 0.066 * k, unit: 0.026 * k, gap: 0.02 * k, arrangement: "inline", align: "left" }, n, 1, 0, 0.014 * k);
    } else if (style === "hero") {
      const hero: CellSpec = { w: 0.62 * k, label: 0.026 * k, value: 0.13 * k, unit: 0.045 * k, gap: 0.01 * k, arrangement: "stack", align: "left" };
      out = [{ ...hero, x: 0, y: 0 }];
      if (n > 1) {
        const top = statCellHeight(hero) + 0.03 * k;
        out.push(...cells({ w: 0.15 * k, label: 0.018 * k, value: 0.042 * k, unit: 0.019 * k, gap: 0.006 * k, arrangement: "stack", align: "left" }, n - 1, n - 1, 0.02 * k, 0, top));
      }
    } else {
      out = cells({ w: 0.25 * k, label: M.statLabel * k, value: M.statValue * k, unit: M.statUnit * k, gap: M.statLabelGap * k, arrangement: "stack", align: "left" }, n, n <= 1 ? 1 : 2, M.statGapX * k, M.statGapY * k);
    }
  }
  const w = Math.max(0, ...out.map((c) => c.x + c.w));
  const h = Math.max(0, ...out.map((c) => c.y + statCellHeight(c)));
  const f = w > MAX_BLOCK_W ? MAX_BLOCK_W / w : 1;
  if (f === 1) return { w, h, cells: out };
  const scale = (c: StatCell): StatCell => ({ ...c, x: c.x * f, y: c.y * f, w: c.w * f, label: c.label * f, value: c.value * f, unit: c.unit * f, gap: c.gap * f });
  return { w: w * f, h: h * f, cells: out.map(scale) };
}

/**
 * Keep an element's centre inside the photo, given the element's own size as
 * fractions of the photo width (w) and height (h).
 */
export function clampCentre(x: number, y: number, halfW: number, halfH: number): { x: number; y: number } {
  const cx = Math.min(1 - halfW, Math.max(halfW, x));
  const cy = Math.min(1 - halfH, Math.max(halfH, y));
  return { x: Math.round(cx * 1000) / 1000, y: Math.round(cy * 1000) / 1000 };
}

/** Where a new stats block lands: the lower left, with a margin — where Strava puts it. */
export function defaultStatsPlacement(n: number, aspect: number, style: OverlayStatStyle = "grid"): { x: number; y: number } {
  const box = layoutStats(n, style, 1);
  return clampCentre(0.06 + box.w / 2, 0.94 - (box.h / aspect) / 2, box.w / 2, (box.h / aspect) / 2);
}

/** Where a new text line lands: upper centre. */
export function defaultTextPlacement(): { x: number; y: number } {
  return { x: 0.5, y: 0.16 };
}

/** One figure on the photo, already formatted for the reader. */
export type OverlayStatValue = { value: string; unit?: string; label: string };
export type OverlayStatValues = Partial<Record<OverlayStatKey, OverlayStatValue>>;

/** The figures the block will show, in canonical order, skipping any the post cannot supply. */
export function overlayStatRows(overlay: PhotoOverlay["stats"], values: OverlayStatValues): { key: OverlayStatKey; stat: OverlayStatValue }[] {
  if (!overlay) return [];
  return overlay.keys.flatMap((key) => (values[key] ? [{ key, stat: values[key]! }] : []));
}

/** Breaks a line of text into lines no wider than max, measuring with `width`. Words never split. */
export function wrapLines(text: string, max: number, width: (s: string) => number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && width(next) > max) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}
