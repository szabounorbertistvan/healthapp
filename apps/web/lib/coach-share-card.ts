// Coach share cards — the promotional image a coach posts to Instagram,
// Facebook or WhatsApp to send people to their public Voinic page. Pure, like
// share-card.ts: what the card is made of, which choices the coach has, and
// where everything sits. It reuses that file's item model, and the painter in
// share-card-render.ts draws both kinds of card.
//
// Truth first: every word on the card comes from the coach's *public* profile
// (coach_public_profile — the page anyone can open), picked field by field in
// coachShareCardFromPublic. The coach chooses a template, a format, a photo
// among their own and which of their own specializations to show; they cannot
// type a claim, a number or a credential onto it.
import { SHARE_FORMAT_SIZE, type ShareCardItem, type ShareCardLayout, type ShareColor, type ShareFormat } from "./share-card";

// ---------- choices ----------

export type CoachShareTemplate = "signature" | "minimal" | "athletic";
export const COACH_SHARE_TEMPLATES: readonly CoachShareTemplate[] = ["signature", "minimal", "athletic"];

/** Square first: the feed post is what most coaches make first. */
export const COACH_SHARE_FORMATS: readonly ShareFormat[] = ["square", "story"];

export type CoachSharePhoto = "avatar" | "cover" | "none";

/** At most this many specializations besides the primary — more reads as a list, not a card. */
export const COACH_SHARE_MAX_SPECS = 3;

export type CoachShareOptions = {
  template: CoachShareTemplate;
  format: ShareFormat;
  photo: CoachSharePhoto;
  /** Slugs of the coach's own non-primary specializations to show, in their order. */
  specs: string[];
  showHeadline: boolean;
  showQr: boolean;
};

// ---------- the card's data: public fields only ----------

export type CoachShareSpecialization = { slug: string; name_en: string; name_ro: string; is_primary: boolean };

export type CoachShareCard = {
  slug: string;
  name: string;
  headline: string | null;
  avatarUrl: string | null;
  coverUrl: string | null;
  specializations: CoachShareSpecialization[];
  city: { ro: string; en: string } | null;
  online: boolean;
  inPerson: boolean;
  /** Voinic Verified — an admin's decision, carried as the public page shows it. */
  verified: boolean;
  /** The canonical public page: `${SITE_URL}/coaches/<slug>`. */
  url: string;
};

/** What coachShareCardFromPublic reads — a subset of CoachPublicProfile, so a test can build one. */
export type CoachSharePublicSource = {
  slug: string;
  display_name: string;
  headline: string | null;
  avatar_url: string | null;
  cover_url: string | null;
  online: boolean;
  in_person: boolean;
  verified?: boolean;
  specializations: CoachShareSpecialization[];
  locations: { city: string; city_en: string }[];
};

/**
 * The card's data from the public profile, by an explicit list of fields:
 * nothing else of the payload (about, services, prices, certifications,
 * stats, the viewer's user id) can reach the image, whatever is added to
 * coach_public_profile later.
 */
export function coachShareCardFromPublic(p: CoachSharePublicSource, siteUrl: string): CoachShareCard {
  const loc = p.in_person ? p.locations[0] : undefined;
  return {
    slug: p.slug,
    name: p.display_name.trim(),
    headline: p.headline?.trim() || null,
    avatarUrl: p.avatar_url || null,
    coverUrl: p.cover_url || null,
    specializations: p.specializations.map((s) => ({ slug: s.slug, name_en: s.name_en, name_ro: s.name_ro, is_primary: s.is_primary === true })),
    city: loc ? { ro: loc.city, en: loc.city_en || loc.city } : null,
    online: p.online,
    inPerson: p.in_person,
    verified: p.verified === true,
    url: `${siteUrl.replace(/\/+$/, "")}/coaches/${p.slug}`,
  };
}

/** "voinic.fit/coaches/ana" — the URL as a person types it, for the card's text. */
export function shortProfileUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
}

export function primarySpecialization(card: CoachShareCard): CoachShareSpecialization | null {
  return card.specializations.find((s) => s.is_primary) ?? null;
}

/** The specializations the coach may pick for the card: their own, primary excluded (it is shown on its own). */
export function selectableSpecializations(card: CoachShareCard): CoachShareSpecialization[] {
  return card.specializations.filter((s) => !s.is_primary);
}

export function defaultCoachShareOptions(card: CoachShareCard): CoachShareOptions {
  return {
    template: "signature",
    format: "square",
    photo: card.avatarUrl ? "avatar" : card.coverUrl ? "cover" : "none",
    specs: selectableSpecializations(card).slice(0, COACH_SHARE_MAX_SPECS).map((s) => s.slug),
    showHeadline: Boolean(card.headline),
    showQr: true,
  };
}

/**
 * Options as the card can honour them: an unknown template or format falls
 * back, a photo the coach does not have becomes none, a slug that is not one
 * of their own specializations is dropped, three at most.
 */
export function normalizeCoachShareOptions(card: CoachShareCard, o: Partial<CoachShareOptions>): CoachShareOptions {
  const d = defaultCoachShareOptions(card);
  const own = new Set(selectableSpecializations(card).map((s) => s.slug));
  const photo = o.photo === "avatar" && card.avatarUrl ? "avatar" : o.photo === "cover" && card.coverUrl ? "cover" : o.photo === "none" ? "none" : d.photo;
  return {
    template: COACH_SHARE_TEMPLATES.includes(o.template as CoachShareTemplate) ? (o.template as CoachShareTemplate) : d.template,
    format: COACH_SHARE_FORMATS.includes(o.format as ShareFormat) ? (o.format as ShareFormat) : d.format,
    photo,
    specs: o.specs ? [...new Set(o.specs)].filter((s) => own.has(s)).slice(0, COACH_SHARE_MAX_SPECS) : d.specs,
    showHeadline: o.showHeadline === undefined ? d.showHeadline : o.showHeadline && Boolean(card.headline),
    showQr: o.showQr ?? d.showQr,
  };
}

/** The image URL for the chosen photo, or null. */
export function coachSharePhotoUrl(card: CoachShareCard, photo: CoachSharePhoto): string | null {
  return photo === "avatar" ? card.avatarUrl : photo === "cover" ? card.coverUrl : null;
}

/**
 * The stored avatar is a 256 px square and the cover a 1600 × 600 crop —
 * fine on a page, soft on a 1080 px card. A Cloudinary delivery URL can ask
 * the same uploaded asset for a larger rendition; this rewrites only the
 * transformation segment and keeps the version and public id, so it is still
 * the coach's own picture. Anything else is returned as is. The caller falls
 * back to the stored URL if the rendition does not load (strict
 * transformations on the account).
 */
export function cardPhotoRendition(url: string | null, w: number, h: number, gravity: "face" | "auto"): string | null {
  if (!url) return null;
  const m = url.match(/^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(?:[^/]*[a-z]_[^/]*\/)*(v\d+\/.+)$/);
  if (!m) return url;
  return `${m[1]}c_fill,g_${gravity},w_${w},h_${h},q_auto:good,f_jpg/${m[2]}`;
}

export function coachShareFileName(slug: string, template: CoachShareTemplate, format: ShareFormat): string {
  return `voinic-${slug}-${template}-${format}.png`;
}

// ---------- layout ----------

export type CoachShareLabels = {
  cta: string;
  verified: string;
  online: string;
  inPerson: string;
  brand: string;
};

/** Measures one line of text — canvas measureText in the browser, a fixed-width fake in tests. */
export type MeasureText = (text: string, size: number, weight: number, font: "display" | "body", tracking: number) => number;

export type CoachShareLayoutInput = {
  card: CoachShareCard;
  options: CoachShareOptions;
  locale: "en" | "ro";
  labels: CoachShareLabels;
  measure: MeasureText;
  /** qrModules(card.url), computed by the caller (lib/qr.ts); null hides the code. */
  qr: readonly (readonly boolean[])[] | null;
};

type Font = { size: number; min: number; weight: 400 | 500 | 600 | 700 | 800; font: "display" | "body"; tracking?: number; upper?: boolean };

/**
 * Greedy word wrap at the largest size from `f.size` down to `f.min` that
 * fits in `maxLines`; at the floor the last line is trimmed with an ellipsis.
 * A single word wider than the box is shrunk, then trimmed — never overflows.
 */
export function wrapText(measure: MeasureText, raw: string, f: Font, maxWidth: number, maxLines: number): { lines: string[]; size: number } {
  // ordinary whitespace only: \s would also swallow the no-break space that keeps "→" with its word
  const text = (f.upper ? raw.toUpperCase() : raw).replace(/[ \t\n\r]+/g, " ").trim();
  if (!text) return { lines: [], size: f.size };
  const tr = f.tracking ?? 0;
  const w = (s: string, size: number) => measure(s, size, f.weight, f.font, tr);
  // break opportunities: spaces, and after a hyphen or a slash ("Constantinescu-|Vlădescu",
  // "voinic.fit/coaches/|ana") — a double-barrelled name or a long address wraps instead of being cut
  const pieces: { text: string; space: boolean }[] = [];
  for (const word of text.split(" ")) {
    // no lookbehind regex: older iOS Safari cannot even parse one
    word.replace(/([-/])/g, "$1\u0000").split("\u0000").filter(Boolean)
      .forEach((part, i) => pieces.push({ text: part, space: i === 0 }));
  }
  const wrapAt = (size: number) => {
    const lines: string[] = [];
    let cur = "";
    for (const p of pieces) {
      const next = cur ? `${cur}${p.space ? " " : ""}${p.text}` : p.text;
      if (!cur || w(next, size) <= maxWidth) cur = next;
      else { lines.push(cur); cur = p.text; }
    }
    if (cur) lines.push(cur);
    return lines;
  };
  let size = f.size;
  for (;;) {
    const lines = wrapAt(size);
    if (lines.length <= maxLines && lines.every((l) => w(l, size) <= maxWidth)) return { lines, size };
    const next = Math.max(f.min, Math.round(size * 0.93));
    if (next === size) {
      const kept = lines.slice(0, maxLines);
      let last = kept[kept.length - 1] ?? "";
      if (lines.length > maxLines) last = `${last}…`;
      while (w(last, size) > maxWidth && last.length > 2) last = `${last.slice(0, -2).trimEnd()}…`;
      kept[kept.length - 1] = last;
      return { lines: kept, size };
    }
    size = next;
  }
}

type Builder = { items: ShareCardItem[]; measure: MeasureText };

/** Lines of text at x, from y down; returns the height used. */
function textBlock(
  b: Builder, id: string, raw: string, f: Font, x: number, y: number, maxWidth: number, maxLines: number,
  color: ShareColor, align: "left" | "center" | "right" = "left", lineHeight = 1.12,
): number {
  const { lines, size } = wrapText(b.measure, raw, f, maxWidth, maxLines);
  lines.forEach((line, i) => {
    b.items.push({
      kind: "text", id: lines.length === 1 ? id : `${id}-${i}`, text: line, x, y: y + Math.round(i * size * lineHeight),
      size, weight: f.weight, font: f.font, color, align, maxWidth, tracking: f.tracking,
    });
  });
  return lines.length === 0 ? 0 : Math.round((lines.length - 1) * size * lineHeight + size);
}

/** Pills that flow left to right (or centred) and wrap; labels too long for a row are trimmed. Returns the height. */
function chips(
  b: Builder, id: string, labels: string[], x: number, y: number, maxWidth: number,
  o: { size: number; h: number; padX: number; gap: number; maxRows: number; fill: ShareColor; ink: ShareColor; stroke?: ShareColor; align: "left" | "center"; upper?: boolean },
): number {
  if (labels.length === 0) return 0;
  const f: Font = { size: o.size, min: o.size, weight: 600, font: "body", upper: o.upper, tracking: o.upper ? 0.08 : 0 };
  const rows: { text: string; w: number }[][] = [[]];
  let rowW = 0;
  for (const raw of labels) {
    const fitted = wrapText(b.measure, raw, f, maxWidth - o.padX * 2, 1).lines[0] ?? raw;
    const pill = Math.ceil(b.measure(fitted, o.size, 600, "body", f.tracking ?? 0)) + o.padX * 2;
    const row = rows[rows.length - 1]!;
    if (row.length > 0 && rowW + o.gap + pill > maxWidth) {
      if (rows.length === o.maxRows) break;
      rows.push([{ text: fitted, w: pill }]);
      rowW = pill;
    } else {
      row.push({ text: fitted, w: pill });
      rowW += (row.length > 1 ? o.gap : 0) + pill;
    }
  }
  rows.forEach((row, r) => {
    const total = row.reduce((s, p) => s + p.w, 0) + o.gap * (row.length - 1);
    let cx = o.align === "center" ? x + (maxWidth - total) / 2 : x;
    const cy = y + r * (o.h + o.gap);
    row.forEach((p, i) => {
      b.items.push({ kind: "rect", id: `${id}-${r}-${i}`, x: Math.round(cx), y: cy, w: p.w, h: o.h, color: o.fill, radius: o.h / 2, stroke: o.stroke });
      b.items.push({
        kind: "text", id: `${id}-${r}-${i}-text`, text: p.text, x: Math.round(cx + p.w / 2), y: cy + Math.round((o.h - o.size) / 2) - 1,
        size: o.size, weight: 600, font: "body", color: o.ink, align: "center", maxWidth: p.w - o.padX, tracking: f.tracking,
      });
      cx += p.w + o.gap;
    });
  });
  return rows.length * o.h + (rows.length - 1) * o.gap;
}

/** A filled pill sized to its label (the primary-discipline tag, the CTA). Returns its width. */
function pill(
  b: Builder, id: string, raw: string, x: number, y: number, h: number, maxWidth: number, f: Font, fill: ShareColor, ink: ShareColor,
  align: "left" | "center" = "left", radius = h / 2,
): number {
  const padX = Math.round(h * 0.42);
  const { lines, size } = wrapText(b.measure, raw, f, maxWidth - padX * 2, 1);
  const text = lines[0] ?? "";
  const w = Math.min(maxWidth, Math.ceil(b.measure(text, size, f.weight, f.font, f.tracking ?? 0)) + padX * 2);
  const left = align === "center" ? Math.round(x - w / 2) : x;
  b.items.push({ kind: "rect", id, x: left, y, w, h, color: fill, radius });
  b.items.push({
    kind: "text", id: `${id}-text`, text, x: left + Math.round(w / 2), y: y + Math.round((h - size) / 2) - 1,
    size, weight: f.weight, font: f.font, color: ink, align: "center", maxWidth: w - padX, tracking: f.tracking,
  });
  return w;
}

/** "AP" for Andrei Popescu, "AC" for Alexandra-Maria Constantinescu-Vlădescu, "I" for Ion. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]!.charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1]!.charAt(0) : "";
  return (first + last).toUpperCase();
}

/** "Cluj-Napoca · Online · In person" — only what the profile says. */
function placeLine(card: CoachShareCard, locale: "en" | "ro", labels: CoachShareLabels): string {
  return [card.city ? card.city[locale] : null, card.online ? labels.online : null, card.inPerson ? labels.inPerson : null]
    .filter(Boolean).join(" · ");
}

type Content = {
  primary: string | null;
  specs: string[];
  headline: string | null;
  place: string;
  cta: string;
  url: string;
};

function contentOf(input: CoachShareLayoutInput): Content {
  const { card, options, locale, labels } = input;
  const name = (s: CoachShareSpecialization) => (locale === "ro" ? s.name_ro : s.name_en);
  const p = primarySpecialization(card);
  const bySlug = new Map(selectableSpecializations(card).map((s) => [s.slug, s]));
  return {
    primary: p ? name(p) : null,
    specs: options.specs.map((slug) => bySlug.get(slug)).filter((s): s is CoachShareSpecialization => Boolean(s)).map(name),
    headline: options.showHeadline ? card.headline : null,
    place: placeLine(card, locale, labels),
    cta: labels.cta,
    url: shortProfileUrl(card.url),
  };
}

/** The story's top and bottom bands are covered by the apps' own UI (profile bar, reply box): no text there. */
export const STORY_SAFE = { top: 250, bottom: 250 } as const;

function photoItem(id: string, input: CoachShareLayoutInput, box: { x: number; y: number; w: number; h: number }, o: Partial<{ radius: number; circle: boolean; fallback: ShareColor; initialColor: ShareColor; stroke: ShareColor; strokeWidth: number }> = {}): ShareCardItem {
  return {
    kind: "photo", id, ...box, radius: o.radius ?? 0, circle: o.circle, initial: initialsOf(input.card.name),
    fallback: o.fallback ?? "surface", initialColor: o.initialColor ?? "accentInk", stroke: o.stroke, strokeWidth: o.strokeWidth,
  };
}

// ---- Template A: Signature — portrait in a framed panel, the name large, a gold call to action ----

function signature(input: CoachShareLayoutInput, b: Builder): void {
  const { format } = input.options;
  const { width: W, height: H } = SHARE_FORMAT_SIZE[format];
  const c = contentOf(input);
  const items = b.items;
  items.push({ kind: "glow", id: "glow", x: format === "story" ? W / 2 : 160, y: 0, r: format === "story" ? 1150 : 980 });
  items.push({ kind: "rect", id: "top-bar", x: 0, y: 0, w: W, h: 8, color: "accent", radius: 0 });

  if (format === "square") {
    const pad = 72;
    items.push({ kind: "brand", id: "brand", x: pad, y: 64, h: 76, align: "left", text: input.labels.brand });
    if (input.card.verified) {
      textBlock(b, "verified", `✓ ${input.labels.verified}`, { size: 22, min: 18, weight: 700, font: "display", tracking: 0.16, upper: true }, W - pad, 92, 360, 1, "accentInk", "right");
    }
    const photo = { x: 596, y: 176, w: 412, h: 540 };
    items.push(photoItem("photo", input, photo, { radius: 36, stroke: "line", strokeWidth: 2 }));
    const colX = pad;
    const colW = photo.x - pad - 44;
    // the text column, vertically centred against the portrait
    const col: Builder = { items: [], measure: b.measure };
    let y = 0;
    if (c.primary) { y += textBlock(col, "primary", c.primary, { size: 26, min: 20, weight: 700, font: "display", tracking: 0.2, upper: true }, colX, y, colW, 2, "accentInk", "left", 1.25) + 22; }
    y += textBlock(col, "name", input.card.name, { size: 86, min: 52, weight: 800, font: "display" }, colX, y, colW, 3, "ink", "left", 1.02) + 26;
    col.items.push({ kind: "rect", id: "rule", x: colX, y, w: 64, h: 6, color: "accent", radius: 3 });
    y += 6 + 26;
    if (c.headline) y += textBlock(col, "headline", c.headline, { size: 31, min: 25, weight: 500, font: "body" }, colX, y, colW, 2, "inkSoft", "left", 1.32) + 20;
    if (c.place) y += textBlock(col, "place", c.place, { size: 24, min: 20, weight: 600, font: "body", tracking: 0.04 }, colX, y, colW, 1, "inkFaint");
    const top = photo.y + Math.max(0, Math.round((photo.h - y) / 2));
    for (const it of col.items) items.push({ ...it, y: (it as { y: number }).y + top } as ShareCardItem);
    const chipsY = photo.y + photo.h + 40;
    chips(b, "spec", c.specs, pad, chipsY, W - pad * 2, { size: 25, h: 54, padX: 22, gap: 12, maxRows: 1, fill: "surface", ink: "ink", stroke: "line", align: "left" });
    // the call to action, the address and the code along the bottom
    const qrSize = 172;
    const qrX = W - pad - qrSize;
    const qrY = H - pad - qrSize;
    if (input.qr) items.push({ kind: "qr", id: "qr", x: qrX, y: qrY, size: qrSize, modules: input.qr, dark: "bg", light: "ink", radius: 16 });
    const ctaMax = (input.qr ? qrX - 32 : W - pad) - pad;
    pill(b, "cta", `${c.cta}\u00a0→`, pad, qrY + 8, 84, ctaMax, { size: 32, min: 24, weight: 800, font: "display" }, "accent", "accentFg");
    textBlock(b, "url", c.url, { size: 27, min: 20, weight: 600, font: "body", tracking: 0.02 }, pad, qrY + 8 + 84 + 22, ctaMax, 2, "inkSoft", "left", 1.15);
    return;
  }

  // story: brand, portrait, the stack, then code + call to action — all inside the safe band
  const pad = 96;
  items.push({ kind: "brand", id: "brand", x: W / 2, y: STORY_SAFE.top + 8, h: 80, align: "center", text: input.labels.brand });
  const bottom = H - STORY_SAFE.bottom;
  // big enough to scan off a phone held at arm's length, with clear air before the button
  const qrSize = 240;
  const footTop = bottom - qrSize;
  const stack: Builder = { items: [], measure: b.measure };
  const cw = W - pad * 2;
  let y = 0;
  if (c.primary) { y += textBlock(stack, "primary", c.primary, { size: 32, min: 24, weight: 700, font: "display", tracking: 0.2, upper: true }, W / 2, y, cw, 1, "accentInk", "center") + 22; }
  y += textBlock(stack, "name", input.card.name, { size: 100, min: 60, weight: 800, font: "display" }, W / 2, y, cw, 2, "ink", "center", 1.02) + 28;
  stack.items.push({ kind: "rect", id: "rule", x: W / 2 - 36, y, w: 72, h: 6, color: "accent", radius: 3 });
  y += 6 + 28;
  if (c.headline) y += textBlock(stack, "headline", c.headline, { size: 36, min: 28, weight: 500, font: "body" }, W / 2, y, cw, 2, "inkSoft", "center", 1.3) + 20;
  const meta = [c.place, input.card.verified ? `✓ ${input.labels.verified}` : ""].filter(Boolean).join(" · ");
  if (meta) y += textBlock(stack, "place", meta, { size: 28, min: 22, weight: 600, font: "body", tracking: 0.04 }, W / 2, y, cw, 1, "inkFaint", "center") + 24;
  y += chips(stack, "spec", c.specs, pad, y, cw, { size: 28, h: 60, padX: 24, gap: 12, maxRows: 2, fill: "surface", ink: "ink", stroke: "line", align: "center" });
  const roomTop = STORY_SAFE.top + 8 + 80 + 48;
  const stackTop = footTop - 64 - y;
  const fullH = Math.max(320, stackTop - 56 - roomTop);
  // no photo chosen: a monogram needs no more than a square of 520 — the rest becomes air, shared above and below
  const photoH = input.options.photo === "none" ? Math.min(fullH, 520) : fullH;
  const photoTop = roomTop + Math.round((fullH - photoH) / 2);
  const photoW = Math.min(W - pad * 2, Math.round(photoH * 1.05));
  items.push(photoItem("photo", input, { x: Math.round((W - photoW) / 2), y: photoTop, w: photoW, h: photoH }, { radius: 44, stroke: "line", strokeWidth: 2 }));
  const shift = photoTop + photoH + 56;
  for (const it of stack.items) items.push({ ...it, y: (it as { y: number }).y + shift } as ShareCardItem);
  if (input.qr) {
    items.push({ kind: "qr", id: "qr", x: pad, y: footTop, size: qrSize, modules: input.qr, dark: "bg", light: "ink", radius: 20 });
    const tx = pad + qrSize + 56;
    const tw = W - pad - tx;
    pill(b, "cta", `${c.cta}\u00a0→`, tx, footTop + 28, 96, tw, { size: 36, min: 26, weight: 800, font: "display" }, "accent", "accentFg");
    textBlock(b, "url", c.url, { size: 30, min: 22, weight: 600, font: "body", tracking: 0.02 }, tx, footTop + 28 + 96 + 24, tw, 2, "inkSoft", "left", 1.15);
  } else {
    pill(b, "cta", `${c.cta}\u00a0→`, W / 2, footTop + 40, 100, cw, { size: 38, min: 26, weight: 800, font: "display" }, "accent", "accentFg", "center");
    textBlock(b, "url", c.url, { size: 30, min: 22, weight: 600, font: "body", tracking: 0.02 }, W / 2, footTop + 40 + 100 + 30, cw, 2, "inkSoft", "center", 1.15);
  }
}

// ---- Template B: Minimal — cream paper, a full-bleed portrait, quiet type ----

function minimal(input: CoachShareLayoutInput, b: Builder): void {
  const { format } = input.options;
  const { width: W, height: H } = SHARE_FORMAT_SIZE[format];
  const c = contentOf(input);
  const items = b.items;
  const specLine = c.specs.join("  ·  ");
  const tone = { fallback: "tileLine" as ShareColor, initialColor: "tileAccent" as ShareColor };

  if (format === "square") {
    const photoW = 470;
    items.push(photoItem("photo", input, { x: 0, y: 0, w: photoW, h: H }, tone));
    const x = photoW + 64;
    const cw = W - 72 - x;
    items.push({ kind: "brand", id: "brand", x, y: 72, h: 58, align: "left", text: input.labels.brand, tone: "dark" });
    const col: Builder = { items: [], measure: b.measure };
    let y = 0;
    if (c.primary) y += textBlock(col, "primary", c.primary, { size: 22, min: 18, weight: 700, font: "display", tracking: 0.24, upper: true }, x, y, cw, 2, "tileAccent", "left", 1.3) + 22;
    y += textBlock(col, "name", input.card.name, { size: 70, min: 46, weight: 700, font: "display" }, x, y, cw, 3, "tileInk", "left", 1.05) + 28;
    col.items.push({ kind: "rect", id: "rule", x, y, w: 48, h: 3, color: "tileAccent", radius: 1 });
    y += 3 + 28;
    if (c.headline) y += textBlock(col, "headline", c.headline, { size: 28, min: 23, weight: 400, font: "body" }, x, y, cw, 4, "tileSoft", "left", 1.4) + 22;
    if (specLine) y += textBlock(col, "specs", specLine, { size: 23, min: 19, weight: 600, font: "body" }, x, y, cw, 2, "tileInk", "left", 1.4) + 16;
    if (c.place) y += textBlock(col, "place", c.place, { size: 21, min: 18, weight: 500, font: "body", tracking: 0.04 }, x, y, cw, 1, "tileSoft");
    const top = 190 + Math.max(0, Math.round((620 - y) / 2));
    for (const it of col.items) items.push({ ...it, y: (it as { y: number }).y + top } as ShareCardItem);
    const qrSize = 144;
    const qrY = H - 72 - qrSize;
    if (input.qr) items.push({ kind: "qr", id: "qr", x, y: qrY, size: qrSize, modules: input.qr, dark: "tileInk", light: "tile", radius: 0 });
    const tx = input.qr ? x + qrSize + 24 : x;
    const tw = W - 72 - tx;
    const ctaY = qrY + (input.qr ? 34 : 60);
    // the address follows the call to action's real height, one line or two
    const ctaH = textBlock(b, "cta", `${c.cta}\u00a0→`, { size: 27, min: 21, weight: 700, font: "display" }, tx, ctaY, tw, 2, "tileInk", "left", 1.2);
    textBlock(b, "url", c.url, { size: 21, min: 17, weight: 500, font: "body" }, tx, ctaY + ctaH + 14, tw, 2, "tileSoft", "left", 1.2);
    return;
  }

  // story: the portrait across the top, the text set on paper beneath it
  const x = 96;
  const cw = W - x * 2;
  const bottom = H - STORY_SAFE.bottom;
  const qrSize = 196;
  const footTop = bottom - qrSize;
  const stack: Builder = { items: [], measure: b.measure };
  let y = 0;
  stack.items.push({ kind: "brand", id: "brand", x, y, h: 54, align: "left", text: input.labels.brand, tone: "dark" });
  y += 54 + 48;
  if (c.primary) y += textBlock(stack, "primary", c.primary, { size: 26, min: 20, weight: 700, font: "display", tracking: 0.24, upper: true }, x, y, cw, 1, "tileAccent") + 22;
  y += textBlock(stack, "name", input.card.name, { size: 90, min: 56, weight: 700, font: "display" }, x, y, cw, 2, "tileInk", "left", 1.04) + 30;
  stack.items.push({ kind: "rect", id: "rule", x, y, w: 56, h: 3, color: "tileAccent", radius: 1 });
  y += 3 + 30;
  if (c.headline) y += textBlock(stack, "headline", c.headline, { size: 34, min: 27, weight: 400, font: "body" }, x, y, cw, 3, "tileSoft", "left", 1.38) + 24;
  if (specLine) y += textBlock(stack, "specs", specLine, { size: 28, min: 22, weight: 600, font: "body" }, x, y, cw, 2, "tileInk", "left", 1.35) + 18;
  if (c.place) y += textBlock(stack, "place", c.place, { size: 26, min: 21, weight: 500, font: "body", tracking: 0.04 }, x, y, cw, 1, "tileSoft");
  const stackTop = footTop - 72 - y;
  const photoH = Math.max(560, stackTop - 72);
  items.push(photoItem("photo", input, { x: 0, y: 0, w: W, h: photoH }, tone));
  const shift = photoH + 72;
  for (const it of stack.items) items.push({ ...it, y: (it as { y: number }).y + shift } as ShareCardItem);
  if (input.qr) items.push({ kind: "qr", id: "qr", x, y: footTop, size: qrSize, modules: input.qr, dark: "tileInk", light: "tile", radius: 0 });
  const tx = input.qr ? x + qrSize + 36 : x;
  const tw = W - x - tx;
  const ctaH = textBlock(b, "cta", `${c.cta}\u00a0→`, { size: 36, min: 26, weight: 700, font: "display" }, tx, footTop + 52, tw, 2, "tileInk", "left", 1.2);
  textBlock(b, "url", c.url, { size: 28, min: 21, weight: 500, font: "body" }, tx, footTop + 52 + ctaH + 18, tw, 2, "tileSoft", "left", 1.2);
}

// ---- Template C: Athletic — slanted gold bands, the name in capitals, a hard-edged frame ----

function athletic(input: CoachShareLayoutInput, b: Builder): void {
  const { format } = input.options;
  const { width: W, height: H } = SHARE_FORMAT_SIZE[format];
  const c = contentOf(input);
  const items = b.items;
  const specLine = c.specs.join(" / ");

  if (format === "square") {
    const pad = 72;
    // the band the call to action sits on, falling to the left
    items.push({ kind: "poly", id: "band-shadow", points: [[0, 712], [W, 610], [W, 640], [0, 742]], color: "accentInk", alpha: 0.35 });
    items.push({ kind: "poly", id: "band", points: [[0, 760], [W, 658], [W, 800], [0, 902]], color: "accent" });
    const photo = { x: 588, y: 88, w: 420, h: 540 };
    items.push({ kind: "rect", id: "frame", x: photo.x + 18, y: photo.y + 18, w: photo.w, h: photo.h, color: "accent", radius: 6 });
    items.push(photoItem("photo", input, photo, { radius: 6 }));
    items.push({ kind: "brand", id: "brand", x: pad, y: 72, h: 64, align: "left", text: input.labels.brand });
    const cw = photo.x - pad - 40;
    let y = 196;
    if (c.primary) { pill(b, "primary", c.primary.toUpperCase(), pad, y, 52, cw, { size: 24, min: 18, weight: 800, font: "display", tracking: 0.1 }, "accent", "accentFg", "left", 6); y += 52 + 28; }
    // capitals run wide: a fourth line before a name is ever cut; leading 1, not tighter —
    // Ă above and Ș / Ț below must not touch the next line
    y += textBlock(b, "name", input.card.name, { size: 92, min: 46, weight: 800, font: "display", upper: true }, pad, y, cw, 4, "ink", "left", 1) + 24;
    if (specLine) y += textBlock(b, "specs", specLine, { size: 26, min: 20, weight: 700, font: "display", tracking: 0.06, upper: true }, pad, y, cw, 2, "accentInk", "left", 1.3) + 16;
    if (c.place && y < 640) textBlock(b, "place", c.place, { size: 22, min: 18, weight: 600, font: "body", tracking: 0.04 }, pad, y, cw, 1, "inkFaint");
    // on the band: the call to action and the address
    const qrSize = 168;
    const ctaW = (input.qr ? W - pad - qrSize - 40 : W - pad) - pad;
    textBlock(b, "cta", `${c.cta}\u00a0→`.toUpperCase(), { size: 36, min: 24, weight: 800, font: "display", tracking: 0.02 }, pad, 782, ctaW, 1, "accentFg");
    // the band's lower edge rises to the right: a long address shrinks rather than leave the gold
    textBlock(b, "url", c.url, { size: 24, min: 14, weight: 700, font: "body" }, pad, 832, Math.min(ctaW, 460), 1, "accentFg");
    if (input.qr) items.push({ kind: "qr", id: "qr", x: W - pad - qrSize, y: H - pad - qrSize + 24, size: qrSize, modules: input.qr, dark: "bg", light: "ink", radius: 8 });
    if (input.card.verified) textBlock(b, "verified", `✓ ${input.labels.verified}`, { size: 22, min: 18, weight: 700, font: "display", tracking: 0.16, upper: true }, pad, H - pad - 22, 520, 1, "accentInk");
    return;
  }

  // story: a poster — the photo full-bleed at the top fading to black, the name stacked over its foot
  const pad = 96;
  const cw = W - pad * 2;
  const bottom = H - STORY_SAFE.bottom;
  const stack: Builder = { items: [], measure: b.measure };
  let y = 0;
  if (c.primary) { pill(stack, "primary", c.primary.toUpperCase(), pad, y, 60, cw, { size: 28, min: 20, weight: 800, font: "display", tracking: 0.1 }, "accent", "accentFg", "left", 6); y += 60 + 30; }
  y += textBlock(stack, "name", input.card.name, { size: 128, min: 64, weight: 800, font: "display", upper: true }, pad, y, cw, 4, "ink", "left", 1) + 26;
  if (specLine) y += textBlock(stack, "specs", specLine, { size: 32, min: 24, weight: 700, font: "display", tracking: 0.06, upper: true }, pad, y, cw, 2, "accentInk", "left", 1.3) + 18;
  if (c.headline) y += textBlock(stack, "headline", c.headline, { size: 32, min: 26, weight: 500, font: "body" }, pad, y, cw, 2, "inkSoft", "left", 1.32) + 16;
  const meta = [c.place, input.card.verified ? `✓ ${input.labels.verified}` : ""].filter(Boolean).join(" · ");
  if (meta) y += textBlock(stack, "place", meta, { size: 26, min: 21, weight: 600, font: "body", tracking: 0.04 }, pad, y, cw, 1, "inkFaint");
  const bandTop = bottom - 250;
  const stackTop = Math.max(STORY_SAFE.top + 130, bandTop - 70 - y);
  const photoH = Math.min(1280, stackTop + 220);
  items.push(photoItem("photo", input, { x: 0, y: 0, w: W, h: photoH }, { fallback: "surface" }));
  items.push({ kind: "fade", id: "photo-fade", x: 0, y: Math.round(photoH * 0.45), w: W, h: photoH - Math.round(photoH * 0.45) + 2, color: "bg" });
  items.push({ kind: "fade", id: "photo-top", x: 0, y: 0, w: W, h: 360, color: "bg", reverse: true });
  items.push({ kind: "brand", id: "brand", x: pad, y: STORY_SAFE.top + 10, h: 72, align: "left", text: input.labels.brand });
  for (const it of stack.items) items.push({ ...it, y: (it as { y: number }).y + stackTop } as ShareCardItem);
  // the band, rising to the right, with the code standing on it
  items.push({ kind: "poly", id: "band-shadow", points: [[0, bandTop + 40], [W, bandTop - 60], [W, bandTop - 28], [0, bandTop + 72]], color: "accentInk", alpha: 0.35 });
  items.push({ kind: "poly", id: "band", points: [[0, bandTop + 96], [W, bandTop - 4], [W, bottom + 30], [0, bottom + 130]], color: "accent" });
  const qrSize = 210;
  const ctaW = (input.qr ? W - pad - qrSize - 40 : W - pad) - pad;
  textBlock(b, "cta", `${c.cta}\u00a0→`.toUpperCase(), { size: 44, min: 28, weight: 800, font: "display", tracking: 0.02 }, pad, bandTop + 112, ctaW, 1, "accentFg");
  textBlock(b, "url", c.url, { size: 30, min: 22, weight: 700, font: "body" }, pad, bandTop + 176, ctaW, 2, "accentFg", "left", 1.15);
  if (input.qr) items.push({ kind: "qr", id: "qr", x: W - pad - qrSize, y: bottom - qrSize, size: qrSize, modules: input.qr, dark: "bg", light: "ink", radius: 8 });
}

const TEMPLATES: Record<CoachShareTemplate, (input: CoachShareLayoutInput, b: Builder) => void> = { signature, minimal, athletic };

/** Where everything on the coach card goes, for the chosen template and format. */
export function layoutCoachShareCard(input: CoachShareLayoutInput): ShareCardLayout {
  const { width, height } = SHARE_FORMAT_SIZE[input.options.format];
  const b: Builder = { items: [], measure: input.measure };
  TEMPLATES[input.options.template]({ ...input, qr: input.options.showQr ? input.qr : null }, b);
  return { format: input.options.format, width, height, background: input.options.template === "minimal" ? "tile" : "bg", items: b.items };
}
