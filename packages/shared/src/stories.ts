/**
 * Stories — the rules both sides share. The database has the same ones
 * (20261004100000_social_stories.sql): the text bounds and background list
 * are check constraints, the 24 hours is set by a trigger, and "live" is
 * `expires_at > now()` in every policy and RPC. Nothing here is the only line
 * of defence; it is the first, so a bad request is refused before it is sent.
 */

export const STORY_TEXT_MAX = 200;
export const STORY_TTL_HOURS = 24;
/** Live stories one person may have at once — a spam brake, mirrored by a trigger. */
export const STORY_LIVE_MAX = 30;

export const STORY_BACKGROUNDS = ["gold", "night", "paper"] as const;
export type StoryBackground = (typeof STORY_BACKGROUNDS)[number];

export function isStoryBackground(v: unknown): v is StoryBackground {
  return typeof v === "string" && (STORY_BACKGROUNDS as readonly string[]).includes(v);
}

/** Trimmed, 1–200 characters, or refused. Counted in UTF-16 units, which never exceeds Postgres's char_length. */
export function validateStoryText(text: unknown): { ok: true; text: string } | { ok: false } {
  if (typeof text !== "string") return { ok: false };
  const clean = text.trim();
  if (clean.length < 1 || clean.length > STORY_TEXT_MAX) return { ok: false };
  return { ok: true, text: clean };
}

/** Whether a story is still up. The server decides for real; this only keeps a stale tab honest. */
export function isStoryLive(expiresAt: string, nowMs: number): boolean {
  const t = new Date(expiresAt).getTime();
  return Number.isFinite(t) && t > nowMs;
}

/**
 * How long a story stays on screen: five seconds, plus time to read longer
 * text, capped so a full 200 characters is twelve.
 */
export function storyDurationMs(text: string): number {
  return Math.min(12_000, Math.max(5_000, 5_000 + Math.max(0, text.length - 40) * 45));
}

// ---------- moving through the tray ----------

/** Where the viewer is: which author in the tray, which of their stories. */
export type StoryPos = { author: number; story: number };

/**
 * The next story, crossing into the next author after an author's last one.
 * `counts[i]` is how many live stories author i has. Null at the very end:
 * the viewer closes.
 */
export function nextStoryPos(pos: StoryPos, counts: readonly number[]): StoryPos | null {
  if (pos.story + 1 < (counts[pos.author] ?? 0)) return { author: pos.author, story: pos.story + 1 };
  for (let a = pos.author + 1; a < counts.length; a++) {
    if ((counts[a] ?? 0) > 0) return { author: a, story: 0 };
  }
  return null;
}

/**
 * The previous story, stepping back into the previous author's first story
 * from an author's first one (the way the big apps do it: back means "the
 * person before", from the start). Null at the very first story: the viewer
 * restarts it rather than closing.
 */
export function prevStoryPos(pos: StoryPos, counts: readonly number[]): StoryPos | null {
  if (pos.story > 0) return { author: pos.author, story: pos.story - 1 };
  for (let a = pos.author - 1; a >= 0; a--) {
    if ((counts[a] ?? 0) > 0) return { author: a, story: 0 };
  }
  return null;
}

/** Where to start in one author's stories: the first one not yet seen, or the first. */
export function firstUnseenIndex(stories: readonly { seen: boolean }[]): number {
  const i = stories.findIndex((s) => !s.seen);
  return i < 0 ? 0 : i;
}
