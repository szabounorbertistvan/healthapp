import "server-only";
import { normalizePhotoOverlay } from "@healthapp/shared";
import { cloudinaryConfigured, postMediaUrl } from "./cloudinary";
import type { PostMediaItem } from "./types";

/** A row of `media` as social_feed / social_post / social_saved_posts return it. */
type RawMedia = {
  id?: unknown; kind?: unknown; public_id?: unknown; width?: unknown; height?: unknown; alt?: unknown; overlay?: unknown;
};

/**
 * The pictures of one post as a page may show them. The RPC decided the
 * reader may see the post; this mints the short-lived links for exactly those
 * rows (the public_id never leaves the server) and drops anything malformed.
 * Without Cloudinary configured there is nothing to deliver, so no pictures.
 * `allowStats` is true for a workout post: its overlay may carry the
 * workout's figures, which no other post type has.
 */
export function toMediaItems(raw: unknown, allowStats = false): PostMediaItem[] {
  if (!Array.isArray(raw) || raw.length === 0 || !cloudinaryConfigured()) return [];
  const out: PostMediaItem[] = [];
  for (const r of raw as RawMedia[]) {
    if (!r || typeof r.id !== "string" || typeof r.public_id !== "string") continue;
    if (r.kind !== "image") continue; // video: schema only, nothing to deliver yet
    if (typeof r.width !== "number" || typeof r.height !== "number" || r.width <= 0 || r.height <= 0) continue;
    out.push({
      id: r.id,
      kind: "image",
      url: postMediaUrl(r.public_id, "feed"),
      thumb_url: postMediaUrl(r.public_id, "thumb"),
      width: r.width,
      height: r.height,
      alt: typeof r.alt === "string" && r.alt.length > 0 ? r.alt : null,
      overlay: normalizePhotoOverlay(r.overlay ?? null, allowStats),
    });
  }
  return out;
}
