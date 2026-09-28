// Pictures on a post: the rules the composer, the server action and the
// database (20261016100000_social_post_media.sql) all apply. The SQL is the
// authority — social_post_media_guard and social_create_post refuse anything
// these functions would — and this module is what lets the browser say so
// before a request is made, and the server action before a round trip.

/** At most this many pictures on one post (social_post_media.position 0..9). */
export const POST_MEDIA_MAX = 10;

/**
 * What the picker accepts from the device, by the MIME type the browser
 * reports. Everything is re-encoded to JPEG in the browser before upload
 * (lib/image-prepare.ts), and Cloudinary refuses anything that is not really
 * jpg / png / webp (`allowed_formats` is part of the signed upload), so this
 * list is about a fast, honest "that is not a photo", not about trust.
 */
export const MEDIA_ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] as const;

/** The largest original the picker takes (it is shrunk to ≤1600px before upload). */
export const MEDIA_PICK_MAX_BYTES = 25 * 1024 * 1024;

/** The largest stored asset the server accepts, as Cloudinary reports it. */
export const MEDIA_STORED_MAX_BYTES = 8 * 1024 * 1024;

/** Formats a stored post picture may have (Cloudinary's `format`). */
export const MEDIA_STORED_FORMATS = ["jpg", "png", "webp"] as const;

export const MEDIA_ALT_MAX = 300;
export const MEDIA_DIMENSION_MAX = 20000;

export type MediaFileError = "type" | "size" | "empty";

/** Whether a file the user picked may even be tried. */
export function validateMediaFile(file: { type: string; size: number }): MediaFileError | null {
  if (!file || file.size <= 0) return "empty";
  if (!(MEDIA_ACCEPTED_TYPES as readonly string[]).includes(file.type.toLowerCase())) return "type";
  if (file.size > MEDIA_PICK_MAX_BYTES) return "size";
  return null;
}

/** How many more pictures fit, given how many are already on the post. */
export function mediaSlotsLeft(count: number): number {
  return Math.max(0, POST_MEDIA_MAX - Math.max(0, count));
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/**
 * The public_id shape the database mints (social_media_upload_register):
 * the author's own post folder, an "m-" prefix and a random id. Mirrors the
 * check constraint on social_media_uploads.
 */
export function isPostMediaPublicId(publicId: unknown, userId: string): publicId is string {
  return (
    typeof publicId === "string" &&
    new RegExp(`^voinic/posts/${userId.toLowerCase()}/m-${UUID}$`).test(publicId)
  );
}

export type PostMediaInput = {
  publicId: string;
  width: number;
  height: number;
  alt?: string | null;
  /** The overlay the author placed; only kept on a single-picture post. */
  overlay?: unknown;
};

export type CleanMediaItem = { public_id: string; width: number; height: number; alt: string | null };

/**
 * The list as the server action sends it on: in order, at most ten, each
 * one the author's own, with whole positive pixel sizes and alt text trimmed
 * to 300 characters (empty is none — alt text never blocks a post). Null
 * when anything is wrong, so a hand-made request gets one answer.
 */
export function normalizeMediaItems(input: unknown, userId: string): CleanMediaItem[] | null {
  if (input === null || input === undefined) return [];
  if (!Array.isArray(input) || input.length > POST_MEDIA_MAX) return null;
  const seen = new Set<string>();
  const out: CleanMediaItem[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") return null;
    const item = raw as Record<string, unknown>;
    if (!isPostMediaPublicId(item.publicId, userId) || seen.has(item.publicId)) return null;
    const w = item.width;
    const h = item.height;
    if (!Number.isInteger(w) || !Number.isInteger(h)) return null;
    if ((w as number) < 1 || (h as number) < 1 || (w as number) > MEDIA_DIMENSION_MAX || (h as number) > MEDIA_DIMENSION_MAX) return null;
    seen.add(item.publicId);
    const alt = typeof item.alt === "string" ? item.alt.replace(/\s+/g, " ").trim().slice(0, MEDIA_ALT_MAX).trim() : "";
    out.push({ public_id: item.publicId, width: w as number, height: h as number, alt: alt.length > 0 ? alt : null });
  }
  return out;
}

/** What the stored asset must be, as Cloudinary describes it after upload. */
export function storedMediaProblem(asset: { format?: string; bytes?: number; width?: number; height?: number; resource_type?: string } | undefined): string | null {
  if (!asset) return "missing";
  if (asset.resource_type && asset.resource_type !== "image") return "kind";
  if (!asset.format || !(MEDIA_STORED_FORMATS as readonly string[]).includes(asset.format.toLowerCase())) return "format";
  if (typeof asset.bytes !== "number" || asset.bytes <= 0 || asset.bytes > MEDIA_STORED_MAX_BYTES) return "size";
  if (!Number.isInteger(asset.width) || !Number.isInteger(asset.height) || !asset.width || !asset.height) return "dimensions";
  return null;
}

/** Tallest and widest a gallery frame gets: the shapes image-prepare crops to. */
export const MEDIA_FRAME_MIN_RATIO = 4 / 5;
export const MEDIA_FRAME_MAX_RATIO = 16 / 9;

/**
 * The gallery's frame (width / height): the first picture's own shape,
 * bounded to portrait 4:5 … landscape 16:9. Known before any byte loads, so
 * the feed reserves the space and nothing jumps.
 */
export function mediaFrameRatio(first: { width: number; height: number } | undefined): number {
  if (!first || first.width <= 0 || first.height <= 0) return 1;
  return Math.min(MEDIA_FRAME_MAX_RATIO, Math.max(MEDIA_FRAME_MIN_RATIO, first.width / first.height));
}

/** Portrait, square or landscape, for labels and layout decisions. */
export function mediaOrientation(item: { width: number; height: number }): "portrait" | "square" | "landscape" {
  const r = item.width / item.height;
  if (r < 0.95) return "portrait";
  if (r > 1.05) return "landscape";
  return "square";
}

/** The slide a carousel moves to, clamped to its ends (no wrap-around). */
export function carouselStep(current: number, total: number, delta: number): number {
  if (total <= 0) return 0;
  return Math.min(total - 1, Math.max(0, current + delta));
}

/** Which slides get a real <img>: everything seen so far and the next one. */
export function carouselLoaded(index: number, maxSeen: number): boolean {
  return index <= maxSeen + 1;
}
