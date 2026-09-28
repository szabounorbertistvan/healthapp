// Shrinks a photo in the browser before it is uploaded.
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
//
// EXIF orientation is honoured by drawing from an <img>, which every current
// browser orients from the file's own tag before it is painted.

export const PHOTO_MAX_EDGE = 1600;
/** Tallest allowed: 4:5 (height / width). */
export const PHOTO_MAX_TALL = 5 / 4;
/** Widest allowed: 16:9 (width / height). */
export const PHOTO_MAX_WIDE = 16 / 9;
export const PHOTO_JPEG_QUALITY = 0.86;

export type PreparedPhoto = { blob: Blob; width: number; height: number; previewUrl: string };

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

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("image decode failed")); };
    img.src = url;
  });
}

/**
 * The file as it will be uploaded: a JPEG no larger than 1600px on its long
 * edge, cropped to the bounded shape, plus its exact pixel size and a preview
 * URL (an object URL — revoke it when the preview goes away).
 */
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  const img = await loadImage(file);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) throw new Error("image has no size");
  const f = photoFrame(w, h);
  const canvas = document.createElement("canvas");
  canvas.width = f.dw;
  canvas.height = f.dh;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context unavailable");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, f.sx, f.sy, f.sw, f.sh, 0, 0, f.dw, f.dh);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/jpeg", PHOTO_JPEG_QUALITY);
  });
  return { blob, width: f.dw, height: f.dh, previewUrl: URL.createObjectURL(blob) };
}
