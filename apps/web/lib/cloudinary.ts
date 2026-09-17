import "server-only";
import { v2 as cloudinary } from "cloudinary";

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
}

/** Remove one asset. Called when the row it belongs to is deleted. */
export async function destroyPhoto(publicId: string): Promise<void> {
  const client = configured();
  await client.uploader.destroy(publicId, { type: "authenticated", invalidate: true });
}
