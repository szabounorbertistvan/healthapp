// The story export of a post photo: a 1080×1920 JPEG for Instagram Stories
// and the like — the picture full width, its overlay painted exactly where
// the card shows it, on a blurred copy of itself, with the Voinic mark in the
// lower right corner. Same fractions as components/photo-overlay.tsx, here
// multiplied by pixels; same brand assets as the workout card.
import { OVERLAY_SCALE, type PhotoOverlay } from "@healthapp/shared";
import { OVERLAY_METRICS as M, overlayColumns, overlayStatRows, overlayStatsBox, wrapLines, type OverlayStatValues } from "./photo-overlay";
import { loadShareFonts, loadShareImage, type ShareFonts } from "./share-card-render";

export const STORY_SIZE = { width: 1080, height: 1920 } as const;
const BG = "#0b0b0d";

export type PhotoStoryInput = {
  photoUrl: string;
  /** The uploaded picture's pixel size; the story keeps its shape. */
  width: number;
  height: number;
  overlay: PhotoOverlay | null;
  stats: OverlayStatValues;
  /** Drawn as text when the brand PNGs cannot load. */
  brand: string;
};

type Ctx = CanvasRenderingContext2D;

function shadowOn(ctx: Ctx, pw: number) {
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = Math.round(pw * 0.012);
  ctx.shadowOffsetY = Math.round(pw * 0.002);
}

function shadowOff(ctx: Ctx) {
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

/** Cover-fit: the source scaled so it fills w×h, centred, overflow cropped. */
function cover(img: CanvasImageSource, iw: number, ih: number, w: number, h: number, scale = 1) {
  const k = Math.max(w / iw, h / ih) * scale;
  const dw = iw * k;
  const dh = ih * k;
  return { dx: (w - dw) / 2, dy: (h - dh) / 2, dw, dh, img };
}

function paintStats(ctx: Ctx, item: NonNullable<PhotoOverlay["stats"]>, stats: OverlayStatValues, px: number, py: number, pw: number, ph: number, fonts: ShareFonts) {
  const rows = overlayStatRows(item, stats);
  if (rows.length === 0) return;
  const k = OVERLAY_SCALE[item.size];
  const box = overlayStatsBox(rows.length, item.size);
  const cols = overlayColumns(rows.length);
  const left = px + item.x * pw - (box.w * pw) / 2;
  const top = py + item.y * ph - (box.h * pw) / 2;
  const colW = M.statColW * k * pw;
  const gapX = M.statGapX * k * pw;
  const gapY = M.statGapY * k * pw;
  const cellH = box.cell * pw;
  const labelPx = M.statLabel * k * pw;
  const valuePx = M.statValue * k * pw;
  const unitPx = M.statUnit * k * pw;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  shadowOn(ctx, pw);
  rows.forEach(({ stat }, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const x = left + c * (colW + gapX);
    const y = top + r * (cellH + gapY);
    ctx.font = `600 ${labelPx}px ${fonts.body}`;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    if ("letterSpacing" in ctx) (ctx as Ctx & { letterSpacing: string }).letterSpacing = `${labelPx * 0.08}px`;
    ctx.fillText(stat.label.toUpperCase(), x, y, colW);
    if ("letterSpacing" in ctx) (ctx as Ctx & { letterSpacing: string }).letterSpacing = "0px";
    const vy = y + labelPx * 1.2 + M.statLabelGap * k * pw;
    ctx.font = `800 ${valuePx}px ${fonts.display}`;
    ctx.fillStyle = "#fff";
    ctx.fillText(stat.value, x, vy, colW);
    if (stat.unit) {
      const vw = ctx.measureText(stat.value).width;
      ctx.font = `600 ${unitPx}px ${fonts.body}`;
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fillText(stat.unit, x + vw + 0.01 * k * pw, vy + (valuePx - unitPx) * 0.82);
    }
  });
  shadowOff(ctx);
}

function paintText(ctx: Ctx, item: NonNullable<PhotoOverlay["text"]>, px: number, py: number, pw: number, ph: number, fonts: ShareFonts) {
  const k = OVERLAY_SCALE[item.size];
  const size = M.textSize * k * pw;
  ctx.font = `800 ${size}px ${fonts.display}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#fff";
  const lines = wrapLines(item.body, M.textMaxW * pw, (s) => ctx.measureText(s).width);
  const lineH = size * M.textLineHeight;
  const blockH = lines.length * lineH;
  const cx = px + item.x * pw;
  let y = py + item.y * ph - blockH / 2 + (lineH - size) / 2;
  shadowOn(ctx, pw);
  for (const line of lines) {
    ctx.fillText(line, cx, y);
    y += lineH;
  }
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

  // The backdrop: the picture itself, blown up, blurred and dimmed.
  ctx.save();
  ctx.filter = "blur(48px)";
  const b = cover(assets.photo, input.width, input.height, W, H, 1.2);
  ctx.drawImage(b.img, b.dx, b.dy, b.dw, b.dh);
  ctx.restore();
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(0, 0, W, H);

  // The picture, full width, its own shape, centred.
  const pw = W;
  const ph = Math.round((W * input.height) / input.width);
  const px = 0;
  const py = Math.round((H - ph) / 2);
  ctx.drawImage(assets.photo, px, py, pw, ph);

  if (input.overlay?.stats) paintStats(ctx, input.overlay.stats, input.stats, px, py, pw, ph, assets.fonts);
  if (input.overlay?.text) paintText(ctx, input.overlay.text, px, py, pw, ph, assets.fonts);

  // The mark, lower right, in the margin under the picture — or on it when
  // the picture is tall enough to leave no margin.
  const pad = 56;
  const markH = 72;
  const wordH = 30;
  const gap = 18;
  const wordW = Math.round(wordH * (781 / 141));
  const bottom = H - pad;
  const right = W - pad;
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  shadowOn(ctx, pw);
  if (assets.mark && assets.wordmark) {
    ctx.drawImage(assets.wordmark, right - wordW, bottom - Math.round((markH + wordH) / 2), wordW, wordH);
    ctx.drawImage(assets.mark, right - wordW - gap - markH, bottom - markH, markH, markH);
  } else if (assets.mark) {
    ctx.drawImage(assets.mark, right - markH, bottom - markH, markH, markH);
  } else {
    ctx.font = `800 ${wordH * 1.2}px ${assets.fonts.display}`;
    ctx.fillStyle = "#fff";
    ctx.fillText(input.brand.toUpperCase(), right, bottom);
  }
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

export function storyFileName(date: string): string {
  return `voinic-story-${date}.jpg`;
}
