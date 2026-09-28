// The pictures in the composer before a post exists: what was picked, how far
// each upload got, their order, their alt text. A pure reducer, so every
// transition the picker can make is testable without a browser (the project
// runs no React tests — see vitest.config.ts); components/media-picker.tsx
// holds the files and does the network work, and dispatches here.
import { POST_MEDIA_MAX, mediaSlotsLeft, type PostMediaInput } from "@healthapp/shared";

export type DraftStatus = "preparing" | "uploading" | "ready" | "failed";
export type DraftFailure = "prepare" | "upload" | "type" | "size";

export type DraftItem = {
  /** Stable for the life of the draft: React key, and how actions name an item. */
  key: string;
  status: DraftStatus;
  /** A local object URL — never the stored picture's address. */
  previewUrl: string | null;
  width: number | null;
  height: number | null;
  /** Set once the upload landed: the id the server issued for it. */
  publicId: string | null;
  alt: string;
  failure: DraftFailure | null;
};

export type MediaDraft = {
  items: DraftItem[];
  /** How many picks did not fit the last time the picker was full. */
  overflow: number;
};

export const EMPTY_DRAFT: MediaDraft = { items: [], overflow: 0 };

export type DraftAction =
  | { type: "add"; keys: string[] }
  | { type: "rejected"; key: string; failure: DraftFailure }
  | { type: "prepared"; key: string; previewUrl: string; width: number; height: number }
  | { type: "uploaded"; key: string; publicId: string }
  | { type: "failed"; key: string; failure: DraftFailure }
  | { type: "retry"; key: string }
  | { type: "remove"; key: string }
  | { type: "move"; key: string; delta: number }
  | { type: "moveTo"; key: string; index: number }
  | { type: "alt"; key: string; alt: string }
  | { type: "reset" };

function update(state: MediaDraft, key: string, patch: Partial<DraftItem>): MediaDraft {
  let hit = false;
  const items = state.items.map((i) => {
    if (i.key !== key) return i;
    hit = true;
    return { ...i, ...patch };
  });
  return hit ? { ...state, items } : state;
}

function moveTo(items: DraftItem[], key: string, index: number): DraftItem[] {
  const from = items.findIndex((i) => i.key === key);
  if (from < 0) return items;
  const to = Math.min(items.length - 1, Math.max(0, index));
  if (to === from) return items;
  const next = items.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

export function mediaDraftReducer(state: MediaDraft, action: DraftAction): MediaDraft {
  switch (action.type) {
    case "add": {
      // Never more than ten: whatever does not fit is counted, not queued.
      const room = mediaSlotsLeft(state.items.length);
      const take = action.keys.slice(0, room);
      const added: DraftItem[] = take.map((key) => ({
        key, status: "preparing", previewUrl: null, width: null, height: null, publicId: null, alt: "", failure: null,
      }));
      return { items: [...state.items, ...added], overflow: action.keys.length - take.length };
    }
    case "rejected":
    case "failed":
      return update(state, action.key, { status: "failed", failure: action.failure });
    case "prepared":
      return update(state, action.key, {
        status: "uploading", previewUrl: action.previewUrl, width: action.width, height: action.height, failure: null,
      });
    case "uploaded": {
      const item = state.items.find((i) => i.key === action.key);
      // An upload that finishes after its picture was removed changes nothing.
      if (!item || item.status !== "uploading") return state;
      return update(state, action.key, { status: "ready", publicId: action.publicId, failure: null });
    }
    case "retry": {
      const item = state.items.find((i) => i.key === action.key);
      // Only a failed upload of a picture that was prepared can be retried;
      // a file that was not a photo stays refused.
      if (!item || item.status !== "failed" || item.failure !== "upload" || !item.previewUrl) return state;
      return update(state, action.key, { status: "uploading", failure: null });
    }
    case "remove":
      return { ...state, items: state.items.filter((i) => i.key !== action.key), overflow: 0 };
    case "move": {
      const from = state.items.findIndex((i) => i.key === action.key);
      if (from < 0) return state;
      const items = moveTo(state.items, action.key, from + action.delta);
      return items === state.items ? state : { ...state, items };
    }
    case "moveTo": {
      const items = moveTo(state.items, action.key, action.index);
      return items === state.items ? state : { ...state, items };
    }
    case "alt":
      return update(state, action.key, { alt: action.alt });
    case "reset":
      return EMPTY_DRAFT;
  }
}

/** "3/10" — shown once there is at least one picture. */
export function draftCounter(state: MediaDraft): string | null {
  return state.items.length > 0 ? `${state.items.length}/${POST_MEDIA_MAX}` : null;
}

/** Whether an upload is still running (the post button waits for it). */
export function draftBusy(state: MediaDraft): boolean {
  return state.items.some((i) => i.status === "preparing" || i.status === "uploading");
}

/** Every upload that reached storage — what a cancel has to clean up. */
export function draftUploadedIds(state: MediaDraft): string[] {
  return state.items.filter((i) => i.publicId !== null).map((i) => i.publicId!);
}

export type PublishPlan =
  | { ok: true; media: PostMediaInput[] }
  | { ok: false; reason: "empty" | "busy" | "failed" };

/**
 * What the post button sends, or why it cannot yet: words or at least one
 * picture; every picture uploaded (a failed one must be retried or removed —
 * a post never silently drops one the author chose). Alt text is optional.
 */
export function publishPlan(state: MediaDraft, text: string): PublishPlan {
  if (draftBusy(state)) return { ok: false, reason: "busy" };
  if (state.items.some((i) => i.status === "failed")) return { ok: false, reason: "failed" };
  const media: PostMediaInput[] = state.items.map((i) => ({
    publicId: i.publicId!, width: i.width!, height: i.height!, alt: i.alt.trim() || null,
  }));
  if (media.length === 0 && text.trim().length === 0) return { ok: false, reason: "empty" };
  return { ok: true, media };
}
