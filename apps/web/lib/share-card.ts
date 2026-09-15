// External workout sharing — the card a client posts to Instagram Stories and
// the like. This file is pure: what a card is made of, how it is built from
// data the server already scored, and where every element sits on the image.
// It has no DOM, no Supabase and no `@/` imports, so vitest runs it in node.
//
// The data is the feed's own snapshot (workoutPostPayload from
// @healthapp/shared) plus the PR lines and the author — the same aggregates
// the history row and the feed post show, never a second formula. The
// client can choose the format, which stats are visible and whether the
// profile shows; it cannot supply a number.
import { payloadIsSafe, workoutPostPayload, type WorkoutPostPayload } from "@healthapp/shared";
import type { ShareableSession, WorkoutHistorySession } from "./types";

// ---------- formats ----------

export type ShareFormat = "story" | "square";

export const SHARE_FORMATS: readonly ShareFormat[] = ["story", "square"];

/** Instagram Story is 9:16; the square is the feed / WhatsApp shape. */
export const SHARE_FORMAT_SIZE: Record<ShareFormat, { width: number; height: number }> = {
  story: { width: 1080, height: 1920 },
  square: { width: 1080, height: 1080 },
};

// ---------- what the client may choose ----------

export type ShareStatKey = "duration" | "exercises" | "sets" | "volume" | "load" | "prs";

/** Every optional stat, in the order the Edit Stats list shows them. */
export const SHARE_STAT_KEYS: readonly ShareStatKey[] = ["duration", "exercises", "sets", "volume", "load", "prs"];

export type ShareCardOptions = {
  format: ShareFormat;
  stats: Record<ShareStatKey, boolean>;
  showProfile: boolean;
};

/**
 * Everything on, Story first. Body weight, body fat, measurements, food and
 * calories are not options at all: a brag card is built from the workout
 * only, and the type cannot carry them (see payloadIsSafe in the builders).
 */
export const DEFAULT_SHARE_OPTIONS: ShareCardOptions = {
  format: "story",
  stats: { duration: true, exercises: true, sets: true, volume: true, load: true, prs: true },
  showProfile: true,
};

// ---------- the card's data ----------

export type ShareCardProfile = {
  /** What the app shows for the person — the username, never the email. */
  name: string;
  username: string | null;
  avatar_url: string | null;
};

export type ShareCardPr = { exercise: string; weight_kg: number; reps: number };

/** How many PR lines fit on a card before the rest folds into "+N". */
export const SHARE_MAX_PR_LINES = 3;

export type WorkoutShareCard = {
  session_id: string;
  /** The feed's snapshot of the session: name, date, duration, counts, volume, load, PR count. */
  workout: WorkoutPostPayload;
  /** The PR sets of the session, heaviest first — what "🏆 New PR" lists. */
  prs: ShareCardPr[];
  profile: ShareCardProfile | null;
};

function sortPrs(prs: ShareCardPr[]): ShareCardPr[] {
  return [...prs].sort((a, b) => b.weight_kg * b.reps - a.weight_kg * a.reps || a.exercise.localeCompare(b.exercise));
}

function assertSafe(card: WorkoutShareCard): WorkoutShareCard {
  if (!payloadIsSafe(card.workout)) throw new Error("share card carries a forbidden field");
  return card;
}

/** The "Workout completed" screen already holds the scored session — reuse it. */
export function shareCardFromSession(session: ShareableSession, profile: ShareCardProfile | null): WorkoutShareCard {
  return assertSafe({
    session_id: session.session_id,
    workout: workoutPostPayload({ ...session, prs: session.prs.length }),
    prs: sortPrs(session.prs.map((p) => ({ exercise: p.exercise, weight_kg: p.weight_kg, reps: p.reps }))),
    profile,
  });
}

/**
 * A history row carries its sets grouped by exercise and its load already
 * scored; the day page has the day's name. No second fetch for a past session.
 */
export function shareCardFromHistory(
  session: WorkoutHistorySession,
  dayName: string,
  profile: ShareCardProfile | null,
): WorkoutShareCard {
  const prs = session.exercises.flatMap((e) =>
    e.sets.filter((s) => s.is_pr).map((s) => ({ exercise: e.name, weight_kg: s.weight_kg, reps: s.reps })),
  );
  return assertSafe({
    session_id: session.id,
    workout: workoutPostPayload({
      name: dayName,
      date: session.at.slice(0, 10),
      duration_min: session.load.duration_min,
      exercises: session.load.exercises,
      sets: session.sets,
      volume_kg: session.volume_kg,
      load: session.load.score,
      prs: prs.length,
    }),
    prs: sortPrs(prs),
    profile,
  });
}

// ---------- formatting ----------

/** "1h 12m" / "45 min" — the feed's duration format, shared so the card matches it. */
export function durationLabel(min: number | null): string | null {
  if (min === null) return null;
  return min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min} min`;
}

function localeTag(locale: string): string {
  return locale === "ro" ? "ro-RO" : "en-GB";
}

/**
 * "15 SEP 2026" — day, three-letter month in the reader's language, year.
 * Assembled from parts because ICU's short months vary by engine ("Sept",
 * "sept."); the date is a yyyy-mm-dd day, read as local.
 */
export function shareDateLabel(day: string, locale: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  const month = new Intl.DateTimeFormat(localeTag(locale), { month: "short" }).format(date).replace(/\./g, "").slice(0, 3);
  return `${date.getDate()} ${month.toUpperCase()} ${date.getFullYear()}`;
}

export function shareNumber(v: number, locale: string): string {
  return new Intl.NumberFormat(localeTag(locale)).format(v);
}

// ---------- layout ----------

/** The card is always the brand look — gold on near-black — whatever the app's theme. Mirrors the dark tokens in globals.css. */
export const SHARE_CARD_COLORS = {
  bg: "#0b0b0d",
  surface: "#16171a",
  ink: "#f2efe8",
  inkSoft: "#b9b5ab",
  inkFaint: "#807c73",
  line: "#2a2b30",
  accent: "#d4a938",
  accentInk: "#e6c25a",
  accentFg: "#0b0b0d",
} as const;

export type ShareColor = keyof typeof SHARE_CARD_COLORS;

export type ShareTextItem = {
  kind: "text";
  /** Stable handle for tests and debugging: "name", "duration", "load", "pr-0"… */
  id: string;
  text: string;
  x: number;
  y: number;
  /** Font size in px at 1080 wide. */
  size: number;
  weight: 400 | 500 | 600 | 700 | 800;
  font: "display" | "body";
  color: ShareColor;
  align: "left" | "center" | "right";
  /** The painter shrinks the font until the line fits — no overflow, no overlap. */
  maxWidth: number;
  /** Tracking as a fraction of the font size (0.3 = 30 %). */
  tracking?: number;
};

export type ShareRectItem = {
  kind: "rect";
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: ShareColor;
  radius: number;
  /** A 1px-ish inner stroke in this colour, if set. */
  stroke?: ShareColor;
};

/** A 0..1 progress bar — the training load meter. */
export type ShareBarItem = { kind: "bar"; id: string; x: number; y: number; w: number; h: number; value: number };

export type ShareAvatarItem = { kind: "avatar"; id: string; x: number; y: number; size: number; url: string | null; initial: string };

/** Mark + wordmark, drawn from the brand PNGs; falls back to the name as text. */
export type ShareBrandItem = { kind: "brand"; id: string; x: number; y: number; h: number; align: "left" | "center" | "right"; text: string };

export type ShareGlowItem = { kind: "glow"; id: string; x: number; y: number; r: number };

export type ShareCardItem =
  | ShareTextItem
  | ShareRectItem
  | ShareBarItem
  | ShareAvatarItem
  | ShareBrandItem
  | ShareGlowItem;

export type ShareCardLayout = {
  format: ShareFormat;
  width: number;
  height: number;
  background: ShareColor;
  items: ShareCardItem[];
};

/** The copy the card needs, already in the reader's language. */
export type ShareCardLabels = {
  workoutComplete: string;
  duration: string;
  exercises: string;
  sets: string;
  volume: string;
  volumeUnit: string;
  trainingLoad: string;
  loadCategory: Record<"very_light" | "light" | "moderate" | "hard" | "very_hard", string>;
  newPr: string;
  prsCount: string;
  morePrs: string;
  /** Brand name for the footer (drawn as text when the PNGs cannot load). */
  brand: string;
};

export type ShareLayoutInput = {
  card: WorkoutShareCard;
  options: ShareCardOptions;
  locale: string;
  labels: ShareCardLabels;
};

function fill(message: string, values: Record<string, string | number>): string {
  return message.replace(/\{(\w+)\}/g, (m, key) => (key in values ? String(values[key]) : m));
}

function categoryOf(score: number): keyof ShareCardLabels["loadCategory"] {
  if (score >= 85) return "very_hard";
  if (score >= 70) return "hard";
  if (score >= 50) return "moderate";
  if (score >= 30) return "light";
  return "very_light";
}

/**
 * Everything sized at story scale; the square uses a smaller unit, tighter
 * gaps, and folds the duration into the stat row instead of a hero line —
 * the tall card has room for one big number on its own, the square does not.
 */
const SCALE: Record<ShareFormat, { unit: number; pad: number; gap: number; hero: boolean }> = {
  story: { unit: 1, pad: 96, gap: 64, hero: true },
  square: { unit: 0.62, pad: 72, gap: 40, hero: false },
};

type Block = { height: number; place: (y: number, s: number) => ShareCardItem[] };

/**
 * Where everything goes. Header (kicker, name, date) at the top, footer
 * (profile, brand) at the bottom, the stats stacked and vertically centred
 * between them. When every stat is on and there are three PR lines the stack
 * can be taller than the room; then every size and gap in the stack is
 * scaled down by the same factor so nothing overflows or overlaps. Absent
 * stats — a session without timestamps, no PRs — produce no block at all,
 * never a "0".
 */
export function layoutShareCard(input: ShareLayoutInput): ShareCardLayout {
  const { card, options, locale, labels } = input;
  const { width, height } = SHARE_FORMAT_SIZE[options.format];
  const { unit: u, pad, gap: gapBase, hero } = SCALE[options.format];
  const w = card.workout;
  const contentX = pad;
  const contentW = width - pad * 2;
  const centerX = width / 2;
  const items: ShareCardItem[] = [];

  items.push({ kind: "glow", id: "glow", x: centerX, y: 0, r: Math.round(width * 0.9) });
  items.push({ kind: "rect", id: "top-bar", x: 0, y: 0, w: width, h: Math.round(6 * u) + 2, color: "accent", radius: 0 });

  // ---- header ----
  let y = pad;
  const kickerSize = Math.round(30 * u);
  items.push({
    kind: "text", id: "kicker", text: labels.workoutComplete.toUpperCase(), x: centerX, y, size: kickerSize,
    weight: 700, font: "display", color: "accentInk", align: "center", maxWidth: contentW, tracking: 0.3,
  });
  y += kickerSize + Math.round(28 * u);
  const nameSize = Math.round(96 * u);
  items.push({
    kind: "text", id: "name", text: w.name.toUpperCase(), x: centerX, y, size: nameSize,
    weight: 800, font: "display", color: "ink", align: "center", maxWidth: contentW, tracking: 0.02,
  });
  y += nameSize + Math.round(20 * u);
  const dateSize = Math.round(34 * u);
  items.push({
    kind: "text", id: "date", text: shareDateLabel(w.date, locale), x: centerX, y, size: dateSize,
    weight: 600, font: "body", color: "inkSoft", align: "center", maxWidth: contentW, tracking: 0.12,
  });
  y += dateSize;
  const headerBottom = y + Math.round(72 * u);

  // ---- footer ----
  const footerH = Math.round(96 * u);
  const footerY = height - pad - footerH;
  const profile = options.showProfile ? card.profile : null;
  if (profile) {
    const initial = profile.name.trim().charAt(0).toUpperCase() || "?";
    items.push({ kind: "avatar", id: "avatar", x: contentX, y: footerY, size: footerH, url: profile.avatar_url, initial });
    const textX = contentX + footerH + Math.round(24 * u);
    const nameS = Math.round(40 * u);
    const userS = Math.round(30 * u);
    const nameMax = Math.round(contentW * 0.55);
    if (profile.username) {
      const gap = Math.round(8 * u);
      const top = footerY + Math.round((footerH - nameS - gap - userS) / 2);
      items.push({ kind: "text", id: "profile-name", text: profile.name, x: textX, y: top, size: nameS, weight: 700, font: "display", color: "ink", align: "left", maxWidth: nameMax });
      items.push({ kind: "text", id: "profile-username", text: `@${profile.username}`, x: textX, y: top + nameS + gap, size: userS, weight: 500, font: "body", color: "inkFaint", align: "left", maxWidth: nameMax });
    } else {
      items.push({ kind: "text", id: "profile-name", text: profile.name, x: textX, y: footerY + Math.round((footerH - nameS) / 2), size: nameS, weight: 700, font: "display", color: "ink", align: "left", maxWidth: nameMax });
    }
    items.push({ kind: "brand", id: "brand", x: width - pad, y: footerY, h: footerH, align: "right", text: labels.brand });
  } else {
    items.push({ kind: "brand", id: "brand", x: centerX, y: footerY, h: footerH, align: "center", text: labels.brand });
  }
  const footerTop = footerY - Math.round(72 * u);

  // ---- the stack ----
  const blocks: Block[] = [];
  const gap = Math.round(gapBase * u);

  const duration = options.stats.duration ? durationLabel(w.duration_min) : null;
  if (duration && hero) {
    const num = Math.round(150 * u);
    const lab = Math.round(32 * u);
    blocks.push({
      height: num + Math.round(12 * u) + lab,
      place: (top, s) => [
        { kind: "text", id: "duration", text: duration, x: centerX, y: top, size: Math.round(num * s), weight: 800, font: "display", color: "ink", align: "center", maxWidth: contentW },
        { kind: "text", id: "duration-label", text: labels.duration.toUpperCase(), x: centerX, y: top + Math.round((num + 12 * u) * s), size: Math.round(lab * s), weight: 600, font: "body", color: "inkFaint", align: "center", maxWidth: contentW, tracking: 0.2 },
      ],
    });
  }

  const columns: { id: string; value: string; label: string }[] = [];
  if (duration && !hero) columns.push({ id: "duration", value: duration, label: labels.duration });
  if (options.stats.exercises && w.exercises > 0) columns.push({ id: "exercises", value: shareNumber(w.exercises, locale), label: labels.exercises });
  if (options.stats.sets && w.sets > 0) columns.push({ id: "sets", value: shareNumber(w.sets, locale), label: labels.sets });
  if (options.stats.volume && w.volume_kg > 0) columns.push({ id: "volume", value: shareNumber(w.volume_kg, locale), label: `${labels.volumeUnit} ${labels.volume}` });
  if (columns.length > 0) {
    const num = Math.round(100 * u);
    const lab = Math.round(30 * u);
    const colW = contentW / columns.length;
    blocks.push({
      height: num + Math.round(10 * u) + lab,
      place: (top, s) =>
        columns.flatMap((c, i) => {
          const cx = contentX + colW * i + colW / 2;
          return [
            { kind: "text", id: c.id, text: c.value, x: cx, y: top, size: Math.round(num * s), weight: 800, font: "display", color: "ink", align: "center", maxWidth: colW - 24 * u },
            { kind: "text", id: `${c.id}-label`, text: c.label.toUpperCase(), x: cx, y: top + Math.round((num + 10 * u) * s), size: Math.round(lab * s), weight: 600, font: "body", color: "inkFaint", align: "center", maxWidth: colW - 24 * u, tracking: 0.16 },
          ] satisfies ShareCardItem[];
        }),
    });
  }

  if (options.stats.load && w.sets > 0) {
    const padIn = Math.round(44 * u);
    const lab = Math.round(32 * u);
    const num = Math.round(176 * u);
    const barH = Math.round(14 * u);
    const cat = Math.round(30 * u);
    const inner = lab + Math.round(6 * u) + num + Math.round(20 * u) + barH + Math.round(18 * u) + cat;
    blocks.push({
      height: inner + padIn * 2,
      place: (top, s) => {
        const h = Math.round((inner + padIn * 2) * s);
        const p = Math.round(padIn * s);
        const barW = Math.round(contentW * 0.5);
        const barY = top + Math.round((padIn + lab + 6 * u + num + 20 * u) * s);
        return [
          { kind: "rect", id: "load-panel", x: contentX, y: top, w: contentW, h, color: "surface", radius: Math.round(32 * u), stroke: "line" },
          { kind: "text", id: "load-label", text: labels.trainingLoad.toUpperCase(), x: centerX, y: top + p, size: Math.round(lab * s), weight: 700, font: "display", color: "accentInk", align: "center", maxWidth: contentW - p * 2, tracking: 0.22 },
          { kind: "text", id: "load", text: String(w.load), x: centerX, y: top + Math.round((padIn + lab + 6 * u) * s), size: Math.round(num * s), weight: 800, font: "display", color: "accent", align: "center", maxWidth: contentW - p * 2 },
          { kind: "bar", id: "load-bar", x: centerX - barW / 2, y: barY, w: barW, h: Math.round(barH * s), value: Math.min(1, Math.max(0, w.load / 100)) },
          { kind: "text", id: "load-category", text: labels.loadCategory[categoryOf(w.load)].toUpperCase(), x: centerX, y: barY + Math.round((barH + 18 * u) * s), size: Math.round(cat * s), weight: 600, font: "body", color: "inkSoft", align: "center", maxWidth: contentW - p * 2, tracking: 0.16 },
        ];
      },
    });
  }

  if (options.stats.prs && card.prs.length > 0) {
    const shown = card.prs.slice(0, SHARE_MAX_PR_LINES);
    const rest = card.prs.length - shown.length;
    const padIn = Math.round(40 * u);
    const head = Math.round(40 * u);
    const line = Math.round(60 * u);
    const lineS = Math.round(36 * u);
    const moreS = Math.round(32 * u);
    const more = rest > 0 ? moreS + Math.round(12 * u) : 0;
    const inner = head + Math.round(20 * u) + shown.length * line + more;
    const headText = card.prs.length === 1 ? labels.newPr : fill(labels.prsCount, { count: card.prs.length });
    blocks.push({
      height: inner + padIn * 2,
      place: (top, s) => {
        const h = Math.round((inner + padIn * 2) * s);
        const p = Math.round(padIn * s);
        const out: ShareCardItem[] = [
          { kind: "rect", id: "pr-panel", x: contentX, y: top, w: contentW, h, color: "accent", radius: Math.round(32 * u) },
          { kind: "text", id: "pr-head", text: `🏆 ${headText.toUpperCase()}`, x: contentX + p, y: top + p, size: Math.round(head * s), weight: 800, font: "display", color: "accentFg", align: "left", maxWidth: contentW - p * 2, tracking: 0.04 },
        ];
        const rowSize = Math.round(lineS * s);
        const valueMax = Math.round(contentW * 0.34);
        shown.forEach((pr, i) => {
          const ry = top + Math.round((padIn + head + 20 * u + i * line) * s) + Math.round(((line - lineS) / 2) * s);
          out.push({ kind: "text", id: `pr-${i}`, text: pr.exercise, x: contentX + p, y: ry, size: rowSize, weight: 700, font: "body", color: "accentFg", align: "left", maxWidth: contentW - p * 2 - valueMax - Math.round(24 * u) });
          out.push({ kind: "text", id: `pr-${i}-value`, text: `${shareNumber(pr.weight_kg, locale)} kg × ${pr.reps}`, x: contentX + contentW - p, y: ry, size: rowSize, weight: 600, font: "body", color: "accentFg", align: "right", maxWidth: valueMax });
        });
        if (rest > 0) {
          out.push({ kind: "text", id: "pr-more", text: fill(labels.morePrs, { count: rest }), x: contentX + p, y: top + Math.round((padIn + head + 20 * u + shown.length * line + 12 * u) * s), size: Math.round(moreS * s), weight: 600, font: "body", color: "accentFg", align: "left", maxWidth: contentW - p * 2 });
        }
        return out;
      },
    });
  }

  const room = footerTop - headerBottom;
  const needed = blocks.reduce((sum, b) => sum + b.height, 0) + gap * Math.max(0, blocks.length - 1);
  const s = needed > room ? room / needed : 1;
  let top = headerBottom + Math.max(0, Math.round((room - needed * s) / 2));
  for (const b of blocks) {
    items.push(...b.place(top, s));
    top += Math.round(b.height * s) + Math.round(gap * s);
  }

  return { format: options.format, width, height, background: "bg", items };
}

/** The texts a layout draws, by id — what the tests read. */
export function layoutText(layout: ShareCardLayout, id: string): string | null {
  const item = layout.items.find((i): i is ShareTextItem => i.kind === "text" && i.id === id);
  return item ? item.text : null;
}
