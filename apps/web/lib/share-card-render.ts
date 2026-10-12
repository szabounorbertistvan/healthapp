// Paints a ShareCardLayout onto a 2D canvas at its exact pixel size — a real
// 1080×1920 / 1080×1080 PNG, not a screenshot of the DOM. Drawing is
// deterministic given the fonts: every element is placed by the layout, and a
// line that would overflow its box is drawn smaller, never clipped or squashed.
//
// paintShareCard() takes any 2D-context-like object so vitest can drive it
// with a recorder; renderShareCard() is the browser entry that creates the
// canvas, waits for the brand fonts and images, and returns a PNG blob.
import {
  SHARE_CARD_COLORS,
  type ShareCardItem,
  type ShareCardLayout,
  type ShareTextItem,
} from "./share-card";

/** The slice of CanvasRenderingContext2D the painter uses. */
export type ShareContext2D = {
  font: string;
  fillStyle: string | CanvasGradient;
  strokeStyle: string | CanvasGradient;
  lineWidth: number;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  letterSpacing?: string;
  globalAlpha: number;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  beginPath(): void;
  closePath(): void;
  arc(x: number, y: number, r: number, start: number, end: number): void;
  roundRect?(x: number, y: number, w: number, h: number, r: number): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
  fill(): void;
  stroke(): void;
  clip(): void;
  save(): void;
  restore(): void;
  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): CanvasGradient;
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): CanvasGradient;
  drawImage(image: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void;
  drawImage(image: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void;
};

export type ShareFonts = { display: string; body: string };

/** Images the card may draw; a missing one falls back to text or an initial. */
export type ShareAssets = {
  fonts: ShareFonts;
  mark: CanvasImageSource | null;
  wordmark: CanvasImageSource | null;
  avatar: CanvasImageSource | null;
  /** The picture a `photo` item draws (the coach card's portrait); absent = the initial. */
  photo?: CanvasImageSource | null;
  /** The wordmark tinted near-black, for a brand item with tone "dark" (see tintImage). */
  wordmarkDark?: CanvasImageSource | null;
};

/** An image's own pixel size: natural for an <img>, plain width / height for a canvas or a bitmap. */
function sourceSize(img: CanvasImageSource): { w: number; h: number } {
  const i = img as { naturalWidth?: number; naturalHeight?: number; width?: number | { baseVal?: { value: number } }; height?: number | { baseVal?: { value: number } } };
  const w = i.naturalWidth || (typeof i.width === "number" ? i.width : 0);
  const h = i.naturalHeight || (typeof i.height === "number" ? i.height : 0);
  return { w, h };
}

/** The source rectangle that covers a w × h box from the image's centre, aspect kept — object-fit: cover. */
export function coverCrop(src: { w: number; h: number }, box: { w: number; h: number }, focusY = 0.5): { sx: number; sy: number; sw: number; sh: number } {
  if (src.w <= 0 || src.h <= 0) return { sx: 0, sy: 0, sw: src.w, sh: src.h };
  const scale = Math.max(box.w / src.w, box.h / src.h);
  const sw = box.w / scale;
  const sh = box.h / scale;
  return { sx: (src.w - sw) / 2, sy: Math.max(0, Math.min(src.h - sh, (src.h - sh) * focusY)), sw, sh };
}

/** Natural sizes of the brand PNGs (public/brand), used to scale by height. */
const MARK_RATIO = 1; // 681 × 681
const WORDMARK_RATIO = 781 / 141;

function hexToRgba(hex: string, alpha: number): string {
  const v = hex.replace("#", "");
  const n = parseInt(v.length === 3 ? v.split("").map((c) => c + c).join("") : v, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function fontString(item: Pick<ShareTextItem, "weight" | "font">, size: number, fonts: ShareFonts): string {
  return `${item.weight} ${size}px ${item.font === "display" ? fonts.display : fonts.body}`;
}

function rounded(ctx: ShareContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
  }
  ctx.closePath();
}

/**
 * Draws one line of text in its box. The size given by the layout is the
 * ceiling; if the measured line is wider than maxWidth the size is stepped
 * down until it fits, so a long day name or exercise shrinks instead of
 * running off the card. Below half the size it stops shrinking and trims
 * the text with an ellipsis instead — small type is worse than a short name.
 */
function paintText(ctx: ShareContext2D, item: ShareTextItem, fonts: ShareFonts) {
  let size = item.size;
  let text = item.text;
  const tracking = item.tracking ?? 0;
  const floor = Math.max(8, Math.round(item.size / 2));
  const widthOf = () => {
    ctx.font = fontString(item, size, fonts);
    if (ctx.letterSpacing !== undefined) ctx.letterSpacing = `${tracking * size}px`;
    // Manual tracking fallback: measureText ignores letterSpacing where unsupported.
    const extra = ctx.letterSpacing === undefined ? tracking * size * Math.max(0, text.length - 1) : 0;
    return ctx.measureText(text).width + extra;
  };
  while (widthOf() > item.maxWidth && size > floor) size = Math.max(floor, Math.round(size * 0.94));
  while (widthOf() > item.maxWidth && text.length > 2) text = `${text.slice(0, -2).trimEnd()}…`;
  ctx.fillStyle = SHARE_CARD_COLORS[item.color];
  ctx.textAlign = item.align;
  ctx.textBaseline = "top";
  // With tracking, browsers add the spacing after the last glyph too; nudge
  // centred/right text back by half / one gap so it reads centred.
  const trail = tracking * size;
  const x = item.align === "center" ? item.x + trail / 2 : item.align === "right" ? item.x + trail : item.x;
  ctx.fillText(text, x, item.y);
  if (ctx.letterSpacing !== undefined) ctx.letterSpacing = "0px";
}

function paintItem(ctx: ShareContext2D, item: ShareCardItem, layout: ShareCardLayout, assets: ShareAssets) {
  switch (item.kind) {
    case "glow": {
      const g = ctx.createRadialGradient(item.x, item.y, 0, item.x, item.y, item.r);
      g.addColorStop(0, "rgba(212, 169, 56, 0.22)");
      g.addColorStop(1, "rgba(212, 169, 56, 0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, layout.width, layout.height);
      return;
    }
    case "rect": {
      ctx.fillStyle = SHARE_CARD_COLORS[item.color];
      if (item.radius > 0) {
        rounded(ctx, item.x, item.y, item.w, item.h, item.radius);
        ctx.fill();
        if (item.stroke) {
          ctx.strokeStyle = SHARE_CARD_COLORS[item.stroke];
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      } else {
        ctx.fillRect(item.x, item.y, item.w, item.h);
      }
      return;
    }
    case "bar": {
      ctx.fillStyle = SHARE_CARD_COLORS.line;
      rounded(ctx, item.x, item.y, item.w, item.h, item.h / 2);
      ctx.fill();
      const fillW = Math.max(item.h, Math.round(item.w * item.value));
      const g = ctx.createLinearGradient(item.x, 0, item.x + item.w, 0);
      g.addColorStop(0, SHARE_CARD_COLORS.accentInk);
      g.addColorStop(1, SHARE_CARD_COLORS.accent);
      ctx.fillStyle = g;
      rounded(ctx, item.x, item.y, fillW, item.h, item.h / 2);
      ctx.fill();
      return;
    }
    case "text":
      paintText(ctx, item, assets.fonts);
      return;
    case "avatar": {
      const r = item.size / 2;
      const cx = item.x + r;
      const cy = item.y + r;
      if (assets.avatar) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(assets.avatar, item.x, item.y, item.size, item.size);
        ctx.restore();
      } else {
        ctx.fillStyle = SHARE_CARD_COLORS.accent;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.closePath();
        ctx.fill();
        ctx.font = `800 ${Math.round(item.size * 0.46)}px ${assets.fonts.display}`;
        if (ctx.letterSpacing !== undefined) ctx.letterSpacing = "0px";
        ctx.fillStyle = SHARE_CARD_COLORS.accentFg;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(item.initial, cx, cy + item.size * 0.03);
      }
      ctx.strokeStyle = SHARE_CARD_COLORS.accentInk;
      ctx.lineWidth = Math.max(2, Math.round(item.size * 0.04));
      ctx.beginPath();
      ctx.arc(cx, cy, r - ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.stroke();
      return;
    }
    case "photo": {
      ctx.save();
      ctx.beginPath();
      if (item.circle) ctx.arc(item.x + item.w / 2, item.y + item.h / 2, Math.min(item.w, item.h) / 2, 0, Math.PI * 2);
      else rounded(ctx, item.x, item.y, item.w, item.h, item.radius);
      ctx.closePath();
      ctx.clip();
      const img = assets.photo ?? null;
      const size = img ? sourceSize(img) : { w: 0, h: 0 };
      if (img && size.w > 0 && size.h > 0) {
        // a face sits in the upper part of a portrait: crop a little above centre
        const c = coverCrop(size, { w: item.w, h: item.h }, 0.35);
        ctx.drawImage(img, c.sx, c.sy, c.sw, c.sh, item.x, item.y, item.w, item.h);
      } else {
        ctx.fillStyle = SHARE_CARD_COLORS[item.fallback];
        ctx.fillRect(item.x, item.y, item.w, item.h);
        const g = ctx.createRadialGradient(item.x + item.w / 2, item.y, 0, item.x + item.w / 2, item.y, Math.max(item.w, item.h));
        g.addColorStop(0, "rgba(212, 169, 56, 0.20)");
        g.addColorStop(1, "rgba(212, 169, 56, 0)");
        ctx.fillStyle = g;
        ctx.fillRect(item.x, item.y, item.w, item.h);
        // the brand emblem, faint, behind the initials: a designed monogram rather than an empty box
        if (assets.mark) {
          const m = Math.round(Math.min(item.w, item.h) * 0.78);
          ctx.globalAlpha = 0.09;
          ctx.drawImage(assets.mark, item.x + (item.w - m) / 2, item.y + (item.h - m) / 2, m, m);
          ctx.globalAlpha = 1;
        }
        const letters = Math.max(1, item.initial.length);
        ctx.font = `800 ${Math.round(Math.min(item.w, item.h) * (letters > 1 ? 0.34 : 0.42))}px ${assets.fonts.display}`;
        if (ctx.letterSpacing !== undefined) ctx.letterSpacing = "0px";
        ctx.fillStyle = SHARE_CARD_COLORS[item.initialColor];
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(item.initial, item.x + item.w / 2, item.y + item.h / 2 + Math.min(item.w, item.h) * 0.03);
      }
      ctx.restore();
      if (item.stroke) {
        ctx.strokeStyle = SHARE_CARD_COLORS[item.stroke];
        ctx.lineWidth = item.strokeWidth ?? 4;
        ctx.beginPath();
        if (item.circle) ctx.arc(item.x + item.w / 2, item.y + item.h / 2, Math.min(item.w, item.h) / 2 - ctx.lineWidth / 2, 0, Math.PI * 2);
        else rounded(ctx, item.x, item.y, item.w, item.h, item.radius);
        ctx.closePath();
        ctx.stroke();
      }
      return;
    }
    case "fade": {
      const g = ctx.createLinearGradient(0, item.y, 0, item.y + item.h);
      const solid = hexToRgba(SHARE_CARD_COLORS[item.color], 1);
      const clear = hexToRgba(SHARE_CARD_COLORS[item.color], 0);
      g.addColorStop(0, item.reverse ? solid : clear);
      g.addColorStop(1, item.reverse ? clear : solid);
      ctx.fillStyle = g;
      ctx.fillRect(item.x, item.y, item.w, item.h);
      return;
    }
    case "qr": {
      const n = item.modules.length;
      const quiet = 4;
      // whole-pixel modules: a fractional cell gives alternating 7 / 8 px columns, which
      // throws off a scanner's grid sampling; the code is centred in its light square instead
      const cell = Math.max(1, Math.floor(item.size / (n + quiet * 2)));
      const inset = Math.floor((item.size - cell * (n + quiet * 2)) / 2);
      ctx.fillStyle = SHARE_CARD_COLORS[item.light];
      if (item.radius > 0) {
        rounded(ctx, item.x, item.y, item.size, item.size, item.radius);
        ctx.fill();
      } else {
        ctx.fillRect(item.x, item.y, item.size, item.size);
      }
      ctx.fillStyle = SHARE_CARD_COLORS[item.dark];
      for (let r = 0; r < n; r++) {
        const row = item.modules[r]!;
        for (let c = 0; c < n; c++) {
          if (row[c]) ctx.fillRect(item.x + inset + (c + quiet) * cell, item.y + inset + (r + quiet) * cell, cell, cell);
        }
      }
      return;
    }
    case "poly": {
      if (item.points.length < 3) return;
      ctx.globalAlpha = item.alpha ?? 1;
      ctx.fillStyle = SHARE_CARD_COLORS[item.color];
      ctx.beginPath();
      ctx.moveTo(item.points[0]![0], item.points[0]![1]);
      for (const [px, py] of item.points.slice(1)) ctx.lineTo(px, py);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      return;
    }
    case "brand": {
      const markH = Math.round(item.h * 0.56);
      const wordH = Math.round(item.h * 0.3);
      const gap = Math.round(item.h * 0.18);
      const word = item.tone === "dark" ? (assets.wordmarkDark ?? null) : assets.wordmark;
      const markW = assets.mark ? markH * MARK_RATIO : 0;
      const wordW = word ? wordH * WORDMARK_RATIO : 0;
      const cy = item.y + item.h / 2;
      if (assets.mark || word) {
        const total = markW + (markW && wordW ? gap : 0) + wordW;
        let x = item.align === "left" ? item.x : item.align === "center" ? item.x - total / 2 : item.x - total;
        if (assets.mark) {
          ctx.drawImage(assets.mark, x, cy - markH / 2, markW, markH);
          x += markW + gap;
        }
        if (word) ctx.drawImage(word, x, cy - wordH / 2, wordW, wordH);
      } else {
        ctx.font = `800 ${Math.round(item.h * 0.36)}px ${assets.fonts.display}`;
        if (ctx.letterSpacing !== undefined) ctx.letterSpacing = `${Math.round(item.h * 0.36 * 0.2)}px`;
        ctx.fillStyle = SHARE_CARD_COLORS[item.tone === "dark" ? "tileInk" : "ink"];
        ctx.textAlign = item.align;
        ctx.textBaseline = "middle";
        ctx.fillText(item.text.toUpperCase(), item.x, cy);
        if (ctx.letterSpacing !== undefined) ctx.letterSpacing = "0px";
      }
      return;
    }
  }
}

/** Paints the whole card. The canvas must already be layout.width × layout.height. */
export function paintShareCard(ctx: ShareContext2D, layout: ShareCardLayout, assets: ShareAssets): void {
  ctx.globalAlpha = 1;
  ctx.fillStyle = SHARE_CARD_COLORS[layout.background];
  ctx.fillRect(0, 0, layout.width, layout.height);
  for (const item of layout.items) paintItem(ctx, item, layout, assets);
}

// ---------- browser entry ----------

/** The minimum of HTMLCanvasElement the renderer needs — injectable for tests. */
export type ShareCanvas = {
  width: number;
  height: number;
  getContext(kind: "2d"): ShareContext2D | null;
  toBlob(cb: (blob: Blob | null) => void, type?: string): void;
};

export type RenderShareCardOptions = {
  assets: ShareAssets;
  createCanvas?: (width: number, height: number) => ShareCanvas;
};

function domCanvas(width: number, height: number): ShareCanvas {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c as unknown as ShareCanvas;
}

/** Paints the layout on a fresh canvas of its exact size and returns the PNG. */
export async function renderShareCard(layout: ShareCardLayout, opts: RenderShareCardOptions): Promise<Blob> {
  const canvas = (opts.createCanvas ?? domCanvas)(layout.width, layout.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context unavailable");
  paintShareCard(ctx, layout, opts.assets);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("toBlob failed"))), "image/png");
  });
}

/**
 * The card is set in the app's own fonts. next/font registers Exo 2 and
 * Inter under generated family names exposed through --font-exo2 /
 * --font-inter; read them from the root element and ask the font set to load
 * every weight the card uses before painting, so the first render is already
 * in the right face (a font that arrives later would leave a fallback baked
 * into the PNG).
 */
export async function loadShareFonts(): Promise<ShareFonts> {
  const root = getComputedStyle(document.documentElement);
  const display = root.getPropertyValue("--font-exo2").trim() || "system-ui";
  const body = root.getPropertyValue("--font-inter").trim() || "system-ui";
  if (typeof document.fonts?.load === "function") {
    // load() fetches only the unicode-range files its sample text needs — the default
    // sample is plain Latin, which left ă â î ș ț (the latin-ext file) to a fallback face
    // on the first card painted. Ask for them explicitly, both cedilla and comma forms.
    const sample = "AaZz09 ĂăÂâÎîȘșȚțŞşŢţ →✓·";
    await Promise.all([
      ...[600, 700, 800].map((w) => document.fonts.load(`${w} 40px ${display}`, sample)),
      ...[400, 500, 600, 700].map((w) => document.fonts.load(`${w} 40px ${body}`, sample)),
    ]).catch(() => undefined);
  }
  return { display, body };
}

/**
 * A copy of a one-colour image (the white wordmark) in another colour, keeping
 * its alpha — the canvas version of the light theme's `.brand-wordmark` invert.
 */
export function tintImage(img: CanvasImageSource | null, color: string): HTMLCanvasElement | null {
  if (!img) return null;
  const { w, h } = sourceSize(img);
  if (!w || !h) return null;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  return c;
}

/**
 * Measures a line exactly as paintText will draw it — same font string, same
 * tracking — on a scratch canvas, so a layout that wraps with it never meets
 * the painter's shrink-to-fit safety net. Fonts must be loaded first.
 */
export function canvasMeasure(fonts: ShareFonts): (text: string, size: number, weight: number, font: "display" | "body", tracking: number) => number {
  const ctx = document.createElement("canvas").getContext("2d") as unknown as ShareContext2D | null;
  if (!ctx) return (text, size) => text.length * size * 0.56;
  return (text, size, weight, font, tracking) => {
    ctx.font = `${weight} ${size}px ${font === "display" ? fonts.display : fonts.body}`;
    if (ctx.letterSpacing !== undefined) {
      ctx.letterSpacing = `${tracking * size}px`;
      const w = ctx.measureText(text).width;
      ctx.letterSpacing = "0px";
      return w;
    }
    return ctx.measureText(text).width + tracking * size * Math.max(0, text.length - 1);
  };
}

/** Loads an image for the canvas; null when it cannot be drawn (missing, CORS-tainted). */
export function loadShareImage(url: string | null, crossOrigin = false): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

// ---------- share / save ----------

export function shareFileName(date: string, format: string): string {
  return `voinic-workout-${date}-${format}.png`;
}

/** True when the browser can put a PNG into the native share sheet. */
export function canShareFile(file: File, nav: Pick<Navigator, "share" | "canShare"> | undefined = typeof navigator === "undefined" ? undefined : navigator): boolean {
  if (!nav || typeof nav.share !== "function" || typeof nav.canShare !== "function") return false;
  try {
    return nav.canShare({ files: [file] });
  } catch {
    return false;
  }
}

/**
 * Native share sheet when the browser offers one for files; otherwise a
 * download, which is what desktop gets. Returns how it was delivered, or
 * "cancelled" when the person closed the sheet (an AbortError, not a failure).
 */
export async function deliverShareImage(
  blob: Blob,
  fileName: string,
  title: string,
  deps: { nav?: Pick<Navigator, "share" | "canShare">; download?: (blob: Blob, name: string) => void } = {},
): Promise<"shared" | "saved" | "cancelled"> {
  // The MIME type follows the blob: the workout card is a PNG, the photo story a JPEG.
  const file = new File([blob], fileName, { type: blob.type || "image/png" });
  const nav = deps.nav ?? (typeof navigator === "undefined" ? undefined : navigator);
  if (nav && canShareFile(file, nav)) {
    try {
      await nav.share({ files: [file], title });
      return "shared";
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") return "cancelled";
      // A share sheet that refused the file still leaves the download.
    }
  }
  (deps.download ?? downloadBlob)(blob, fileName);
  return "saved";
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
