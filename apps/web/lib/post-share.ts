/**
 * Share + Save, the decisions that are not markup: the link to a post, which
 * share targets a browser offers, the save button's state machine, and what
 * a share shows of its original. Pure, so vitest covers them
 * (lib/post-share.test.ts).
 */
import { isPostId } from "@healthapp/shared";

// ---------- the link ----------

/**
 * The address of a post's own page. Only a real post id and a real http(s)
 * origin make one: the id comes from the server's row, the origin from the
 * page's own location, never from anything a user typed.
 */
export function postShareUrl(origin: string, postId: string): string | null {
  if (!isPostId(postId)) return null;
  let base: URL;
  try {
    base = new URL(origin);
  } catch {
    return null;
  }
  if (base.protocol !== "https:" && base.protocol !== "http:") return null;
  return `${base.origin}/feed/${postId.toLowerCase()}`;
}

// ---------- targets ----------

export type ShareTarget = "copy" | "voinic" | "external";

/**
 * What the share sheet offers. Copy is always there (with a select-it-yourself
 * fallback when the clipboard is refused); Share to Voinic only for a post
 * that is not yours and whose original can still be seen; the system share
 * sheet only when the browser has one.
 */
export function shareTargets(env: { webShare: boolean; canRepost: boolean }): ShareTarget[] {
  return [
    "copy",
    ...(env.canRepost ? (["voinic"] as const) : []),
    ...(env.webShare ? (["external"] as const) : []),
  ];
}

/** Whether this browser can hand a link to the system share sheet. Never assumed. */
export function canWebShare(nav: { share?: unknown; canShare?: (data: { url: string }) => boolean } | undefined, url: string): boolean {
  if (!nav || typeof nav.share !== "function") return false;
  if (typeof nav.canShare !== "function") return true;
  try {
    return nav.canShare({ url });
  } catch {
    return false;
  }
}

/**
 * Whether a post can be shared to Voinic from its card: never your own
 * (the database refuses it too), and a share only while its original is
 * visible — sharing a share shares the original.
 */
export function canRepost(post: { mine: boolean; type: string; shared: unknown | null }): boolean {
  if (post.mine) return false;
  if (post.type === "shared_post") return post.shared !== null;
  return true;
}

// ---------- the save button ----------

export type SaveState = { saved: boolean; pending: boolean; error: boolean };
export type SaveEvent = { type: "tap" } | { type: "done"; ok: boolean } | { type: "sync"; saved: boolean };

/**
 * Optimistic, one request at a time, rolled back on failure:
 *   tap   flips at once and marks a request in flight — ignored while one is;
 *   done  settles it, or on failure flips back and remembers the error;
 *   sync  takes the server's value after a refresh, unless a request is out.
 */
export function saveReducer(state: SaveState, event: SaveEvent): SaveState {
  switch (event.type) {
    case "tap":
      if (state.pending) return state;
      return { saved: !state.saved, pending: true, error: false };
    case "done":
      if (!state.pending) return state;
      return event.ok
        ? { ...state, pending: false }
        : { saved: !state.saved, pending: false, error: true };
    case "sync":
      if (state.pending || state.saved === event.saved) return state;
      return { ...state, saved: event.saved };
  }
}

// ---------- a share's original ----------

/**
 * What a card shows in a share's media slot: the original, when the server
 * returned it for this reader; "unavailable" when it did not (deleted,
 * hidden, author suspended) — never a guess at what it said.
 */
export function sharedView(post: { type: string; shared: unknown | null }): "original" | "unavailable" | "none" {
  if (post.type !== "shared_post") return "none";
  return post.shared ? "original" : "unavailable";
}
