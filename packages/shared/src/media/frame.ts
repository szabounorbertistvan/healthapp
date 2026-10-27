// The crop and size every uploaded photo gets — the web (lib/image-prepare.ts)
// and the app both prepare a picture to this frame before uploading it.
//
// A phone camera original is 4000×3000 and 4–8 MB; a feed card is at most
// 680px wide and the story export 1080. Resizing here — not on Cloudinary —
// makes the upload five to ten times smaller on a 4G connection, and it is
// what lets the post carry exact pixel dimensions (photo_w / photo_h) for the
// overlay to be placed against.
//
// The picture is also cropped to a bounded shape, the way Instagram does on
// upload: never taller than 4:5, never wider than 16:9, centred. So a feed
// card is at most 1.25× its width tall, and nothing on the overlay can sit in
// a part of the picture a different surface would crop away.

export const PHOTO_MAX_EDGE = 1600;
/** Tallest allowed: 4:5 (height / width). */
export const PHOTO_MAX_TALL = 5 / 4;
/** Widest allowed: 16:9 (width / height). */
export const PHOTO_MAX_WIDE = 16 / 9;
export const PHOTO_JPEG_QUALITY = 0.86;

/** The crop and the output size for a picture of w×h. Pure, so it is testable. */
export function photoFrame(w: number, h: number): { sx: number; sy: number; sw: number; sh: number; dw: number; dh: number } {
  let sw = w;
  let sh = h;
  if (sh / sw > PHOTO_MAX_TALL) sh = Math.round(sw * PHOTO_MAX_TALL);
  if (sw / sh > PHOTO_MAX_WIDE) sw = Math.round(sh * PHOTO_MAX_WIDE);
  const sx = Math.round((w - sw) / 2);
  const sy = Math.round((h - sh) / 2);
  const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(sw, sh));
  const dw = Math.max(1, Math.round(sw * scale));
  const dh = Math.max(1, Math.round(sh * scale));
  return { sx, sy, sw, sh, dw, dh };
}

