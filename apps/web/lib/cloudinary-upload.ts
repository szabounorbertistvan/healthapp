/**
 * The browser half of a signed Cloudinary upload: post the file with the
 * fields the server signed (lib/cloudinary.ts → sign*Upload) and hand back
 * what the server action needs to record it. Shared by the avatar and the
 * coach cover; the server rebuilds the URL itself and checks the public_id
 * is the one it signed, so nothing returned here is trusted as-is.
 */
export type SignedTicket = { cloudName: string; apiKey: string; fields: Record<string, string> };

/** 5 MB, the same cap the avatar has always had. */
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export type UploadCheck = "NOT_IMAGE" | "TOO_LARGE" | null;

export function checkImage(file: { type: string; size: number }): UploadCheck {
  if (!file.type.startsWith("image/")) return "NOT_IMAGE";
  if (file.size > IMAGE_MAX_BYTES) return "TOO_LARGE";
  return null;
}

/** Null on any failure — the caller shows its own "upload failed" line. */
export async function uploadSignedImage(
  ticket: SignedTicket, file: File,
): Promise<{ publicId: string; version: number } | null> {
  const body = new FormData();
  body.append("file", file);
  body.append("api_key", ticket.apiKey);
  for (const [key, value] of Object.entries(ticket.fields)) body.append(key, value);
  const response = await fetch(`https://api.cloudinary.com/v1_1/${ticket.cloudName}/image/upload`, { method: "POST", body });
  if (!response.ok) return null;
  const uploaded = (await response.json()) as { public_id?: string; version?: number };
  if (!uploaded.public_id || !uploaded.version) return null;
  return { publicId: uploaded.public_id, version: uploaded.version };
}
