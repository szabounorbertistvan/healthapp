/**
 * The post card's decisions that are not markup: how old a post reads, where a
 * caption's hashtags are, when a caption folds, and what a double tap may do.
 * Pure and framework-free, so vitest covers them (lib/post-card.test.ts) and
 * the card stays a layout.
 */

// ---------- age ----------

export type PostAge =
  | { unit: "now" }
  | { unit: "minutes"; n: number }
  | { unit: "hours"; n: number }
  | { unit: "yesterday" }
  | { unit: "days"; n: number }
  | { unit: "date" };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * "2m", "1h", "Yesterday", "3d", then a date. Measured in elapsed time, not
 * calendar days — the card renders once and never ticks, so a label computed
 * on the server and one computed in the browser a second later agree except at
 * a boundary. A timestamp from the future (clock skew) reads as now.
 */
export function postAge(iso: string, nowMs: number): PostAge {
  const ms = nowMs - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < MINUTE) return { unit: "now" };
  if (ms < HOUR) return { unit: "minutes", n: Math.floor(ms / MINUTE) };
  if (ms < DAY) return { unit: "hours", n: Math.floor(ms / HOUR) };
  if (ms < 2 * DAY) return { unit: "yesterday" };
  if (ms < 7 * DAY) return { unit: "days", n: Math.floor(ms / DAY) };
  return { unit: "date" };
}

// ---------- hashtags ----------

export type TagPiece = { kind: "text" | "tag"; text: string };

// A tag is # and then letters, digits or underscores, in any script (so
// #picioare and #ăîșț count). Only styling rides on this: nothing is linked,
// searched or stored.
const TAG = /#[\p{L}\p{N}_]+/gu;
// What may stand right before a # for it to start a tag: nothing, or anything
// that is not itself part of a word — so "abc#def" and "&#39;" stay text.
const WORDISH = /[\p{L}\p{N}_&/]/u;

/**
 * Splits plain text into runs of text and #tags, in order, covering every
 * character exactly once. The pieces are rendered as React text nodes, never
 * as HTML, so a caption can hold anything and still only be text.
 */
export function splitHashtags(text: string): TagPiece[] {
  const out: TagPiece[] = [];
  let last = 0;
  for (const m of text.matchAll(TAG)) {
    const at = m.index ?? 0;
    const before = at > 0 ? text[at - 1]! : "";
    // A lone "#" followed by digits only ("#1") is a rank, not a tag.
    if ((before && WORDISH.test(before)) || /^#\d+$/.test(m[0])) continue;
    if (at > last) out.push({ kind: "text", text: text.slice(last, at) });
    out.push({ kind: "tag", text: m[0] });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

// ---------- caption folding ----------

/** Past this, a caption in the feed starts folded behind "more". */
export const CAPTION_FOLD_CHARS = 140;
export const CAPTION_FOLD_LINES = 3;

/**
 * Whether a caption is long enough to fold. Decided from the text rather than
 * by measuring the rendered box: the answer is the same on the server and in
 * the browser, so the card never renders open and then snaps shut.
 */
export function captionFolds(text: string | null | undefined): boolean {
  if (!text) return false;
  return text.length > CAPTION_FOLD_CHARS || text.split("\n").length > CAPTION_FOLD_LINES;
}

// ---------- double tap ----------

/**
 * A double tap on the media only ever gives. Already given, your own post
 * (which cannot take Kudos), or a request still in flight: nothing happens —
 * the burst may play, but no toggle goes out.
 */
export function doubleTapGives(state: { mine: boolean; given: boolean; pending: boolean }): boolean {
  return !state.mine && !state.given && !state.pending;
}

/**
 * toggleKudos is a toggle, and the card's `given` can be stale (Kudos given
 * from another tab). If a give came back as "removed", the server had it
 * already and the tap just took it away — one more toggle puts it back.
 */
export function giveNeedsUndo(result: { ok: boolean; kudos?: boolean }): boolean {
  return result.ok && result.kudos === false;
}

/** Two taps within this many ms, and this close together, are a double tap. */
export const DOUBLE_TAP_MS = 300;
export const DOUBLE_TAP_SLOP_PX = 24;

export function isDoubleTap(
  prev: { t: number; x: number; y: number } | null,
  next: { t: number; x: number; y: number },
): boolean {
  if (!prev) return false;
  return next.t - prev.t <= DOUBLE_TAP_MS && Math.hypot(next.x - prev.x, next.y - prev.y) <= DOUBLE_TAP_SLOP_PX;
}
