import type { SignedUploadV1 } from "@healthapp/api/v1";

// A signed Cloudinary upload from the phone — the web's uploadSignedImage()
// (lib/cloudinary-upload.ts): every field of the server's ticket exactly as
// signed, then the file. On a phone a file part is { uri, name, type }; the
// web preview hands a File. What Cloudinary stored comes back for the server
// to check and record; null when the upload did not go through.

export type PickedFile = { uri: string; name: string; type: string; size: number | null; file?: Blob | null };

export async function uploadSigned(ticket: SignedUploadV1, picked: PickedFile): Promise<{ publicId: string; version: number } | null> {
  const body = new FormData();
  if (picked.file) body.append("file", picked.file);
  else body.append("file", { uri: picked.uri, name: picked.name, type: picked.type } as unknown as Blob);
  body.append("api_key", ticket.apiKey);
  for (const [key, value] of Object.entries(ticket.fields)) body.append(key, value);
  const response = await fetch(`https://api.cloudinary.com/v1_1/${ticket.cloudName}/image/upload`, { method: "POST", body });
  if (!response.ok) return null;
  const uploaded = (await response.json()) as { public_id?: string; version?: number };
  if (!uploaded.public_id || !uploaded.version) return null;
  return { publicId: uploaded.public_id, version: uploaded.version };
}
