// The story export of a post photo: a 1080×1920 JPEG for Instagram Stories
// and the like. The picture fills the whole frame (cover-fit, centred crop),
// a dark scrim rises from the bottom, and on it sit the workout's name and
// date with its figures, the Voinic mark in the corner. Whatever the author
// placed on the photo (the figures, a line of text) is painted where they put
// it — the same fractions as components/photo-overlay.tsx, mapped through
// the crop and kept inside the visible frame.
import { type PhotoOverlay } from "@healthapp/shared";
import { OVERLAY_METRICS as M, PILL_BG, TEXT_GOLD, layoutStats, overlayStatRows, wrapLines, type OverlayStatValues } from "./photo-overlay";
import { loadShareFonts, loadShareImage, type ShareFonts } from "./share-card-render";

export const STORY_SIZE = { width: 1080, height: 1920 } as const;
const BG = "#0b0b0d";
const GOLD = "#d4a938";
const GOLD_INK = "#e6c25a";
/** Nothing sits closer than this to the frame's edge. */
const EDGE = 56;

export type PhotoStoryInput = {
  photoUrl: string;
  /** The uploaded picture's pixel size; the crop keeps its shape. */
  width: number;
  height: number;
  overlay: PhotoOverlay | null;
  stats: OverlayStatValues;
  /**
   * For a workout post: what the bottom block says. `kicker` is the small
   * caps line ("ANTRENAMENT"), `name` the workout's, `date` already formatted.
   * Null for a text or progress post, which gets the picture and the mark only.
   */
  workout: { kicker: string; name: string; date: string } | null;
  /** Drawn as text when the brand PNGs cannot load. */
  brand: string;
  /** The line under the mark: "Coach. Plan. Progress." */
  tagline: string;
};

type Ctx = CanvasRenderingContext2D;
type Rect = { x: number; y: number; w: number; h: number };

function shadowOn(ctx: Ctx, blur = 14) {
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = blur;
  ctx.shadowOffsetY = 2;
}

function shadowOff(ctx: Ctx) {
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

function spacing(ctx: Ctx, px: number) {
  if ("letterSpacing" in ctx) (ctx as Ctx & { letterSpacing: string }).letterSpacing = `${px}px`;
}

/** Cover-fit: the picture scaled to fill the frame, centred, the overflow cropped. */
export function coverRect(iw: number, ih: number, w = STORY_SIZE.width, h = STORY_SIZE.height): Rect {
  const k = Math.max(w / iw, h / ih);
  const dw = iw * k;
  const dh = ih * k;
  return { x: (w - dw) / 2, y: (h - dh) / 2, w: dw, h: dh };
}

/**
 * Where an element the author centred at (fx, fy) of the photo lands in the
 * frame, kept fully inside it: its centre moves inward by whatever its own
 * half-size needs. `bw`/`bh` are the element's pixel size.
 */
export function placeInFrame(photo: Rect, fx: number, fy: number, bw: number, bh: number, w = STORY_SIZE.width, h = STORY_SIZE.height): { x: number; y: number } {
  const x = photo.x + fx * photo.w;
  const y = photo.y + fy * photo.h;
  const minX = EDGE + bw / 2;
  const maxX = w - EDGE - bw / 2;
  const minY = EDGE + bh / 2;
  const maxY = h - EDGE - bh / 2;
  return {
    x: minX > maxX ? w / 2 : Math.min(maxX, Math.max(minX, x)),
    y: minY > maxY ? h / 2 : Math.min(maxY, Math.max(minY, y)),
  };
}

/** Paints the author's figures; returns the box they cover, or null when there were none. */
function paintStats(ctx: Ctx, item: NonNullable<PhotoOverlay["stats"]>, stats: OverlayStatValues, photo: Rect, fonts: ShareFonts): Rect | null {
  const rows = overlayStatRows(item, stats);
  if (rows.length === 0) return null;
  const box = layoutStats(rows.length, item.style, item.scale);
  // Lengths are fractions of the photo's width, and the crop made the photo
  // wider than the frame; a block that would no longer fit is drawn smaller.
  const pw = photo.w;
  const f = Math.min(1, (STORY_SIZE.width - EDGE * 2) / (box.w * pw));
  const u = pw * f;
  const bw = box.w * u;
  const bh = box.h * u;
  const centre = placeInFrame(photo, item.x, item.y, bw, bh);
  const left = centre.x - bw / 2;
  const top = centre.y - bh / 2;
  shadowOn(ctx, pw * 0.012);
  rows.forEach(({ stat }, i) => {
    const c = box.cells[i]!;
    const x = left + c.x * u;
    const y = top + c.y * u;
    const w = c.w * u;
    const labelPx = c.label * u;
    const valuePx = c.value * u;
    const unitPx = c.unit * u;
    const label = stat.label.toUpperCase();
    const setLabel = () => {
      ctx.font = `600 ${labelPx}px ${fonts.body}`;
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      spacing(ctx, labelPx * 0.08);
    };
    const valueWidth = () => {
      ctx.font = `800 ${valuePx}px ${fonts.display}`;
      const vw = ctx.measureText(stat.value).width;
      if (!stat.unit) return vw;
      ctx.font = `600 ${unitPx}px ${fonts.body}`;
      return vw + unitPx * 0.35 + ctx.measureText(stat.unit).width;
    };
    // The figure and its unit, starting at vx, their tops at vy.
    const drawValue = (vx: number, vy: number) => {
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.font = `800 ${valuePx}px ${fonts.display}`;
      ctx.fillStyle = "#fff";
      ctx.fillText(stat.value, vx, vy, w);
      if (stat.unit) {
        const vw = ctx.measureText(stat.value).width;
        ctx.font = `600 ${unitPx}px ${fonts.body}`;
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.fillText(stat.unit, vx + vw + unitPx * 0.35, vy + (valuePx - unitPx) * 0.82);
      }
    };
    if (c.arrangement === "stack") {
      setLabel();
      ctx.textBaseline = "top";
      ctx.textAlign = c.align;
      ctx.fillText(label, c.align === "center" ? x + w / 2 : x, y, w);
      spacing(ctx, 0);
      const vy = y + labelPx * 1.2 + c.gap * u;
      const vw = Math.min(w, valueWidth());
      drawValue(c.align === "center" ? x + (w - vw) / 2 : x, vy);
    } else {
      // Figure first, the label after it on the same baseline.
      drawValue(x, y);
      const vw = valueWidth();
      setLabel();
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(label, x + vw + c.gap * u, y + valuePx * 0.86, Math.max(0, w - vw - c.gap * u));
      spacing(ctx, 0);
    }
  });
  shadowOff(ctx);
  return { x: left, y: top, w: bw, h: bh };
}

function roundedRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** The author's line: plain white, gold, or white on a dark pill per wrapped line — as the card draws it. */
function paintText(ctx: Ctx, item: NonNullable<PhotoOverlay["text"]>, photo: Rect, fonts: ShareFonts) {
  const k = item.scale;
  const pw = photo.w;
  const size = M.textSize * k * pw;
  const pill = item.style === "pill";
  ctx.font = `800 ${size}px ${fonts.display}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  // The line wraps to the FRAME's width, not the photo's: the crop took the
  // photo's sides away, and a line as wide as the photo would run off screen.
  const padX = pill ? size * M.pillPadX : 0;
  const maxW = Math.min(M.textMaxW * pw, STORY_SIZE.width - EDGE * 2) - padX * 2;
  const lines = wrapLines(item.body, maxW, (s) => ctx.measureText(s).width);
  const lineH = size * (pill ? M.pillLineHeight : M.textLineHeight);
  const blockH = lines.length * lineH;
  const blockW = Math.max(...lines.map((l) => ctx.measureText(l).width), 0) + padX * 2;
  const centre = placeInFrame(photo, item.x, item.y, blockW, blockH);
  const top = centre.y - blockH / 2;
  if (pill) {
    // One pill per line, like box-decoration-break on the card: the content
    // area of the line (1.2 em) plus the padding, centred on the line box.
    const pillH = size * (1.2 + M.pillPadY * 2);
    ctx.fillStyle = PILL_BG;
    lines.forEach((line, i) => {
      const w = ctx.measureText(line).width + padX * 2;
      const cy = top + i * lineH + lineH / 2;
      roundedRect(ctx, centre.x - w / 2, cy - pillH / 2, w, pillH, size * 0.28);
      ctx.fill();
    });
  } else {
    shadowOn(ctx, pw * 0.012);
  }
  ctx.fillStyle = item.style === "gold" ? TEXT_GOLD : "#fff";
  let y = top + (lineH - size) / 2;
  for (const line of lines) {
    ctx.fillText(line, centre.x, y);
    y += lineH;
  }
  shadowOff(ctx);
}

/**
 * The workout's block: kicker, name, date, and — unless the author already
 * put the figures on the photo — a row of them. At the bottom, on the scrim;
 * or at the top when the author's own figures already sit at the bottom, so
 * the two never overlap.
 */
function paintWorkoutBlock(ctx: Ctx, input: PhotoStoryInput, fonts: ShareFonts, withStats: boolean, at: "bottom" | "top") {
  const { width: W, height: H } = STORY_SIZE;
  const w = input.workout!;
  const x = EDGE + 16;
  ctx.textAlign = "left";
  shadowOn(ctx);
  if (at === "top") {
    ctx.textBaseline = "top";
    let ty = EDGE + 24;
    ctx.font = `700 24px ${fonts.display}`;
    ctx.fillStyle = GOLD_INK;
    spacing(ctx, 6);
    ctx.fillText(w.kicker.toUpperCase(), x, ty);
    spacing(ctx, 0);
    ty += 40;
    ctx.font = `800 80px ${fonts.display}`;
    ctx.fillStyle = "#fff";
    ctx.fillText(w.name, x, ty, W - x * 2);
    ty += 98;
    ctx.font = `600 28px ${fonts.body}`;
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillText(w.date, x, ty);
    shadowOff(ctx);
    return;
  }
  let y = H - 130 - (withStats ? 170 : 0);
  ctx.textBaseline = "alphabetic";
  if (withStats) {
    const keys = (["duration", "volume", "sets", "exercises"] as const).filter((key) => input.stats[key]);
    const colW = (W - x * 2) / Math.max(1, keys.length);
    keys.forEach((key, i) => {
      const stat = input.stats[key]!;
      const cx = x + i * colW;
      ctx.font = `600 22px ${fonts.body}`;
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      spacing(ctx, 2);
      ctx.textBaseline = "top";
      ctx.fillText(stat.label.toUpperCase(), cx, y);
      spacing(ctx, 0);
      ctx.font = `800 62px ${fonts.display}`;
      ctx.fillStyle = "#fff";
      ctx.fillText(stat.value, cx, y + 34);
      if (stat.unit) {
        const vw = ctx.measureText(stat.value).width;
        ctx.font = `600 26px ${fonts.body}`;
        ctx.fillStyle = "rgba(255,255,255,0.7)";
        ctx.fillText(stat.unit, cx + vw + 10, y + 34 + 30);
      }
    });
    ctx.textBaseline = "alphabetic";
    y -= 60;
  }
  ctx.font = `600 28px ${fonts.body}`;
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.fillText(w.date, x, y);
  y -= 46;
  ctx.font = `800 80px ${fonts.display}`;
  ctx.fillStyle = "#fff";
  ctx.fillText(w.name, x, y, W - x * 2);
  y -= 96;
  ctx.font = `700 24px ${fonts.display}`;
  ctx.fillStyle = GOLD_INK;
  spacing(ctx, 6);
  ctx.fillText(w.kicker.toUpperCase(), x, y);
  spacing(ctx, 0);
  shadowOff(ctx);
}

/**
 * Paints the story. Exposed apart from the blob step so the size maths can be
 * reasoned about; the DOM entry is renderPhotoStory().
 */
export function paintPhotoStory(
  ctx: Ctx,
  input: PhotoStoryInput,
  assets: { photo: CanvasImageSource; fonts: ShareFonts; mark: CanvasImageSource | null; wordmark: CanvasImageSource | null },
) {
  const { width: W, height: H } = STORY_SIZE;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  // The picture, filling the frame.
  const photo = coverRect(input.width, input.height);
  ctx.drawImage(assets.photo, photo.x, photo.y, photo.w, photo.h);

  // The scrims: a strong one from the bottom, where the block and the mark
  // sit, and a light one at the top so a line of text there stays legible.
  const withBlock = input.workout !== null;
  const bottom = ctx.createLinearGradient(0, H * (withBlock ? 0.45 : 0.72), 0, H);
  bottom.addColorStop(0, "rgba(0,0,0,0)");
  bottom.addColorStop(1, `rgba(0,0,0,${withBlock ? 0.85 : 0.6})`);
  ctx.fillStyle = bottom;
  ctx.fillRect(0, 0, W, H);
  const top = ctx.createLinearGradient(0, 0, 0, H * 0.25);
  top.addColorStop(0, "rgba(0,0,0,0.5)");
  top.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, W, H * 0.25);

  // What the author placed on the photo.
  const placed = input.overlay?.stats ? paintStats(ctx, input.overlay.stats, input.stats, photo, assets.fonts) : null;
  if (input.overlay?.text) paintText(ctx, input.overlay.text, photo, assets.fonts);

  // The workout's block, with the figures unless they are already on the
  // photo; at the top when the author's figures reach into the bottom area.
  if (input.workout) {
    const collides = placed !== null && placed.y + placed.h > H - 440;
    paintWorkoutBlock(ctx, input, assets.fonts, placed === null, collides ? "top" : "bottom");
  }

  // The mark, lower right, with the tagline under it.
  const markH = 64;
  const wordH = 26;
  const gap = 16;
  const taglinePx = 22;
  const wordW = Math.round(wordH * (781 / 141));
  const right = W - EDGE - 16;
  const taglineBase = H - EDGE - 10;
  const base = taglineBase - taglinePx - 2;
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  shadowOn(ctx);
  if (assets.mark && assets.wordmark) {
    ctx.drawImage(assets.wordmark, right - wordW, base - Math.round((markH + wordH) / 2), wordW, wordH);
    ctx.drawImage(assets.mark, right - wordW - gap - markH, base - markH, markH, markH);
  } else if (assets.mark) {
    ctx.drawImage(assets.mark, right - markH, base - markH, markH, markH);
  } else {
    ctx.font = `800 ${wordH * 1.2}px ${assets.fonts.display}`;
    ctx.fillStyle = GOLD;
    ctx.fillText(input.brand.toUpperCase(), right, base);
  }
  // The tagline as the logo sets it: gold small caps, tracked, a rule on each
  // side. The row is exactly as wide as the mark and wordmark above it: the
  // rules run from its edges to the text, and the text shrinks if it would
  // not leave room for them.
  const blockW = assets.mark && assets.wordmark ? markH + gap + wordW : assets.mark ? markH : wordW;
  const left = right - blockW;
  const centre = right - blockW / 2;
  const ruleGap = 12;
  const minRule = 14;
  const label = input.tagline.toUpperCase();
  ctx.fillStyle = GOLD;
  ctx.textAlign = "center";
  let size = taglinePx;
  let textW = 0;
  for (;;) {
    ctx.font = `600 ${size}px ${assets.fonts.display}`;
    spacing(ctx, size * 0.18);
    textW = ctx.measureText(label).width;
    if (textW + 2 * (ruleGap + minRule) <= blockW || size <= 12) break;
    size -= 1;
  }
  ctx.fillText(label, centre, taglineBase);
  spacing(ctx, 0);
  const rule = Math.max(minRule, (blockW - textW) / 2 - ruleGap);
  const ruleY = taglineBase - size * 0.38;
  ctx.fillRect(left, ruleY, rule, 2);
  ctx.fillRect(right - rule, ruleY, rule, 2);
  shadowOff(ctx);
}

export class PhotoStoryError extends Error {}

/** Loads the picture and the brand, paints, and returns a JPEG. Throws PhotoStoryError when the picture cannot be drawn. */
export async function renderPhotoStory(input: PhotoStoryInput): Promise<Blob> {
  const [fonts, photo, mark, wordmark] = await Promise.all([
    loadShareFonts(),
    loadShareImage(input.photoUrl, true),
    loadShareImage("/brand/voinic-mark.png"),
    loadShareImage("/brand/voinic-wordmark.png"),
  ]);
  if (!photo) throw new PhotoStoryError("photo could not be loaded");
  const canvas = document.createElement("canvas");
  canvas.width = STORY_SIZE.width;
  canvas.height = STORY_SIZE.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new PhotoStoryError("canvas 2d context unavailable");
  ctx.imageSmoothingQuality = "high";
  paintPhotoStory(ctx, input, { photo, fonts, mark, wordmark });
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new PhotoStoryError("toBlob failed"))), "image/jpeg", 0.92);
  });
}

/** `voinic-story-2026-09-28-1617.jpg`: the day plus the time of the export, so two stories a day never overwrite each other. */
export function storyFileName(date: string, now: Date = new Date()): string {
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return `voinic-story-${date}-${hh}${mm}.jpg`;
}
