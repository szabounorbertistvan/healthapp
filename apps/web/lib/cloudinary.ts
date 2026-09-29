import "server-only";
import { v2 as cloudinary } from "cloudinary";
import { MEDIA_VARIANTS, mediaTokenKey, signMediaToken, verifyMediaToken, type MediaClaim, type MediaVariant } from "./media-token";

/**
 * Cloudinary, for progress photos.
 *
 * Three decisions worth knowing before changing anything here.
 *
 * 1. **`type: "authenticated"`, never `upload`.** These are pictures of
 *    someone's body. A public `upload` asset is served to anyone who can guess
 *    or leak the URL, for ever. Authenticated assets are only reachable through
 *    a signed URL that expires, and the signing key never leaves the server.
 * 2. **Signed uploads, never an unsigned preset.** An unsigned preset lets
 *    anyone who reads the cloud name out of the page fill the account. The
 *    browser asks this server for a signature that covers the exact folder and
 *    public_id it is allowed to write, then posts the file straight to
 *    Cloudinary — so the image never passes through a server action's body
 *    limit, but it also cannot land anywhere the server did not authorise.
 * 3. **The database stores the `public_id`, not a URL.** Signed URLs expire, so
 *    a stored URL is a dead link by definition; the id is the durable handle
 *    and the URL is rebuilt per render.
 */
const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME?.trim();
const API_KEY = process.env.CLOUDINARY_API_KEY?.trim();
const API_SECRET = process.env.CLOUDINARY_API_SECRET?.trim();

/** How long a delivery URL stays valid. Long enough to load a gallery, short
    enough that a copied link is not a permanent handle to someone's body. */
const URL_TTL_SECONDS = 60 * 30;

export class CloudinaryNotConfiguredError extends Error {
  constructor() {
    super(
      "Cloudinary is not configured. CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and " +
        "CLOUDINARY_API_SECRET must be set (server-side, no NEXT_PUBLIC_ prefix).",
    );
    this.name = "CloudinaryNotConfiguredError";
  }
}

export function cloudinaryConfigured(): boolean {
  return Boolean(CLOUD_NAME && API_KEY && API_SECRET);
}

function configured() {
  if (!CLOUD_NAME || !API_KEY || !API_SECRET) throw new CloudinaryNotConfiguredError();
  cloudinary.config({
    cloud_name: CLOUD_NAME,
    api_key: API_KEY,
    api_secret: API_SECRET,
    secure: true,
  });
  return cloudinary;
}

/**
 * Where one person's photos live. Ordered so the console is browsable and a
 * whole account can be removed with one prefix — which is what account
 * deletion needs, since the purge job only reaches SQL.
 */
export function progressFolder(userId: string): string {
  return `voinic/progress/${userId}`;
}

export type UploadTicket = {
  cloudName: string;
  apiKey: string;
  timestamp: number;
  signature: string;
  publicId: string;
  folder: string;
};

/**
 * A one-shot permission to upload exactly one asset. The signature covers every
 * parameter the browser will send, so it cannot widen the folder, change the
 * type to public, or overwrite a different photo.
 */
export function signUpload(userId: string, publicId: string): UploadTicket {
  const client = configured();
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = progressFolder(userId);
  const params = { folder, public_id: publicId, timestamp, type: "authenticated" };
  const signature = client.utils.api_sign_request(params, API_SECRET!);
  return { cloudName: CLOUD_NAME!, apiKey: API_KEY!, timestamp, signature, publicId, folder };
}

/** A signed, expiring URL for one stored public_id. */
export function photoUrl(publicId: string, options: { width?: number } = {}): string {
  const client = configured();
  return client.url(publicId, {
    type: "authenticated",
    sign_url: true,
    secure: true,
    expires_at: Math.floor(Date.now() / 1000) + URL_TTL_SECONDS,
    // Progress photos are looked at, not printed: capping the width keeps a
    // phone-camera original from being shipped whole into a grid of thumbnails.
    transformation: [
      { width: options.width ?? 800, crop: "limit", quality: "auto", fetch_format: "auto" },
    ],
  });
}

/**
 * Remove every photo an account holds.
 *
 * The SQL purge job cannot reach object storage, so without this a deleted
 * account would leave its photos in Cloudinary for ever — the one category of
 * data where that is least acceptable. Called when deletion is *requested*
 * rather than when the 30-day window closes: the request cannot be cancelled,
 * and holding someone's body photos for a month after they asked you to delete
 * them serves nobody.
 */
export async function destroyUserPhotos(userId: string): Promise<void> {
  const client = configured();
  const prefix = progressFolder(userId);
  await client.api.delete_resources_by_prefix(prefix, { type: "authenticated" });
  // The folder itself lingers otherwise, empty but named after a user id.
  await client.api.delete_folder(prefix).catch(() => {});
  // The profile picture is public, so it is the one that matters most here.
  await client.api.delete_resources_by_prefix(avatarFolder(userId));
  await client.api.delete_folder(avatarFolder(userId)).catch(() => {});
  // Workout-post photos are public too, and a deleted account's face has no
  // business staying in a feed. The same folder holds the private post
  // pictures (20261016100000), which need their own type to be found.
  await client.api.delete_resources_by_prefix(postPhotoFolder(userId));
  await client.api.delete_resources_by_prefix(postPhotoFolder(userId), { type: "authenticated" });
  await client.api.delete_folder(postPhotoFolder(userId)).catch(() => {});
}

// ---------- profile pictures ----------
//
// Public (`type: "upload"`), unlike everything above: an avatar is shown to
// followers, on leaderboards and in the feed, so a plain URL that other
// people's browsers can fetch is the point. Still a signed upload into a folder
// only this server names, and one fixed public_id per person, so re-uploading
// replaces the picture instead of stacking orphans.

export function avatarFolder(userId: string): string {
  return `voinic/avatars/${userId}`;
}
export const AVATAR_PUBLIC_ID = "avatar";

export type AvatarUploadTicket = {
  cloudName: string;
  apiKey: string;
  /** Every field the browser must post, exactly as signed. */
  fields: Record<string, string>;
};

export function signAvatarUpload(userId: string): AvatarUploadTicket {
  const client = configured();
  const timestamp = Math.floor(Date.now() / 1000);
  const params = {
    folder: avatarFolder(userId),
    public_id: AVATAR_PUBLIC_ID,
    timestamp,
    overwrite: "true",
    invalidate: "true",
  };
  const signature = client.utils.api_sign_request(params, API_SECRET!);
  return {
    cloudName: CLOUD_NAME!,
    apiKey: API_KEY!,
    fields: {
      folder: params.folder,
      public_id: params.public_id,
      timestamp: String(timestamp),
      overwrite: params.overwrite,
      invalidate: params.invalidate,
      signature,
    },
  };
}

/**
 * The URL stored in users.avatar_url: square, face-centred, and versioned so a
 * replaced picture is not served from a browser cache of the old one.
 */
export function avatarUrl(publicId: string, version: number): string {
  const client = configured();
  return client.url(publicId, {
    type: "upload",
    secure: true,
    version,
    transformation: [
      { width: 256, height: 256, crop: "fill", gravity: "face", quality: "auto", fetch_format: "auto" },
    ],
  });
}

/** Remove the profile picture asset. Best effort; the column is the record. */
export async function destroyAvatar(userId: string): Promise<void> {
  const client = configured();
  await client.uploader.destroy(`${avatarFolder(userId)}/${AVATAR_PUBLIC_ID}`, { invalidate: true });
  await client.api.delete_folder(avatarFolder(userId)).catch(() => {});
}

/** Remove one asset. Called when the row it belongs to is deleted. */
export async function destroyPhoto(publicId: string): Promise<void> {
  const client = configured();
  await client.uploader.destroy(publicId, { type: "authenticated", invalidate: true });
}

// ---------- workout post photos (legacy, read-only) ----------
//
// Before 20261017100000 a workout post carried one public picture
// (`type: "upload"`) whose URL sat in the post payload. Nothing uploads there
// any more — every new picture goes through the private post media below — but
// those old posts still show their picture, and the account purge still clears
// the folder, which both kinds share.

export function postPhotoFolder(userId: string): string {
  return `voinic/posts/${userId}`;
}

// ---------- post pictures (private) ----------
//
// Since 20261016100000 the pictures of a post live here as `authenticated`
// assets, one public_id per picture, minted by the database
// (social_media_upload_register) — the server signs an upload for exactly
// that id, so the browser can neither choose where a picture lands nor
// overwrite another. Unlike the legacy single photo above, nothing public:
// a picture is only ever delivered through /api/media/<token>, minted per
// render for a row the reader's RPC returned (lib/media-token.ts).

export type PostMediaUploadTicket = {
  cloudName: string;
  apiKey: string;
  /** Every field the browser must post, exactly as signed. */
  fields: Record<string, string>;
  publicId: string;
};

/**
 * A one-shot upload of one picture to one issued public_id. The signature
 * covers the folder, the id, the private type and the formats Cloudinary will
 * accept — decided from the file's content, not its name — so a renamed
 * executable, an SVG or a video is refused by Cloudinary itself.
 */
export function signPostMediaUpload(userId: string, publicId: string): PostMediaUploadTicket {
  const client = configured();
  const folder = postPhotoFolder(userId);
  if (!publicId.startsWith(`${folder}/`) || publicId.slice(folder.length + 1).includes("/")) {
    throw new Error("public_id outside the author's post folder");
  }
  const timestamp = Math.floor(Date.now() / 1000);
  const params = {
    folder,
    public_id: publicId.slice(folder.length + 1),
    timestamp,
    type: "authenticated",
    allowed_formats: "jpg,png,webp",
  };
  const signature = client.utils.api_sign_request(params, API_SECRET!);
  return {
    cloudName: CLOUD_NAME!,
    apiKey: API_KEY!,
    publicId,
    fields: {
      folder: params.folder,
      public_id: params.public_id,
      timestamp: String(timestamp),
      type: params.type,
      allowed_formats: params.allowed_formats,
      signature,
    },
  };
}

function postMediaKey(): Buffer {
  if (!API_SECRET) throw new CloudinaryNotConfiguredError();
  return mediaTokenKey(API_SECRET);
}

/** The link a browser gets for one picture: this app, never Cloudinary. */
export function postMediaUrl(publicId: string, variant: MediaVariant): string {
  return `/api/media/${signMediaToken(publicId, variant, Math.floor(Date.now() / 1000), postMediaKey())}`;
}

export function verifyPostMediaToken(token: string): MediaClaim | null {
  if (!cloudinaryConfigured()) return null;
  return verifyMediaToken(token, Math.floor(Date.now() / 1000), postMediaKey());
}

/**
 * The signed Cloudinary address the media route fetches from — server-side
 * only. Width-capped to the variant, re-encoded to the best format the
 * browser asked for, never the original upload.
 */
export function postMediaSourceUrl(publicId: string, variant: MediaVariant): string {
  const client = configured();
  return client.url(publicId, {
    type: "authenticated",
    sign_url: true,
    secure: true,
    transformation: [{ width: MEDIA_VARIANTS[variant], crop: "limit", quality: "auto", fetch_format: "auto" }],
  });
}

export type StoredMediaAsset = {
  public_id: string; format?: string; bytes?: number; width?: number; height?: number; resource_type?: string;
};

/**
 * What Cloudinary actually stored for these ids — format, bytes and pixel
 * size as it decoded them, not as the browser claimed. One Admin API call for
 * the whole post.
 */
export async function lookupPostMedia(publicIds: string[]): Promise<Map<string, StoredMediaAsset>> {
  const client = configured();
  const found = new Map<string, StoredMediaAsset>();
  if (publicIds.length === 0) return found;
  const result = (await client.api.resources_by_ids(publicIds, { type: "authenticated", resource_type: "image" })) as {
    resources?: StoredMediaAsset[];
  };
  for (const r of result.resources ?? []) found.set(r.public_id, r);
  return found;
}

/** Remove pictures that were uploaded but never became part of a post. */
export async function destroyPostMedia(publicIds: string[]): Promise<void> {
  if (publicIds.length === 0) return;
  const client = configured();
  await client.api.delete_resources(publicIds, { type: "authenticated", resource_type: "image", invalidate: true });
}
