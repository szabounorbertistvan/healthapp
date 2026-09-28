// What sits on a post photo, and where — pure, no DOM, so the feed card, the
// drag editor and the 1080px story export all place the same overlay the
// same way. Every length here is a FRACTION OF THE PHOTO'S WIDTH: the card
// turns it into container-query units (1cqw = 1 % of the photo's width), the
// canvas multiplies by its pixel width.
import { OVERLAY_SCALE, type OverlaySize, type OverlayStatKey, type PhotoOverlay } from "@healthapp/shared";

/** Font sizes and gaps, as fractions of the photo width, at size "m". */
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
} as const;

/** How many columns the stats grid uses for n figures. */
export function overlayColumns(n: number): number {
  return n <= 1 ? 1 : 2;
}

/** The grid's outer size, as fractions of the photo width, for n figures at a size. */
export function overlayStatsBox(n: number, size: OverlaySize): { w: number; h: number; cols: number; rows: number; cell: number } {
  const k = OVERLAY_SCALE[size];
  const cols = overlayColumns(n);
  const rows = Math.ceil(n / cols);
  const cell = (OVERLAY_METRICS.statLabel * 1.2 + OVERLAY_METRICS.statLabelGap + OVERLAY_METRICS.statValue) * k;
  const w = cols * OVERLAY_METRICS.statColW * k + (cols - 1) * OVERLAY_METRICS.statGapX * k;
  const h = rows * cell + (rows - 1) * OVERLAY_METRICS.statGapY * k;
  return { w, h, cols, rows, cell };
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
export function defaultStatsPlacement(n: number, aspect: number): { x: number; y: number } {
  const box = overlayStatsBox(n, "m");
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
