"use server";
// Progress photos. The table and its policies shipped in August
// (20260823000500_progress.sql) and nothing ever wrote to them; the storage
// half lives in lib/cloudinary.ts, which documents why uploads are signed and
// delivery URLs expire.
import { revalidatePath } from "next/cache";
import { isoDay } from "@/lib/dates";
import { liveUser } from "@/lib/supabase/server";
import { mutated } from "@/lib/supabase/mutate";
import {
  CloudinaryNotConfiguredError, destroyPhoto, signUpload, type UploadTicket,
} from "@/lib/cloudinary";
import { uuidFrom } from "@/lib/stable-id";
import type { ActionResult } from "./actions";
import { notSignedIn } from "@/lib/action-result";

export type Pose = "front" | "side" | "back";
const POSES: readonly Pose[] = ["front", "side", "back"];

/**
 * Hand the browser permission to upload one photo.
 *
 * The public_id is derived here, not chosen by the caller: the same person,
 * day and pose always produces the same id, so re-uploading a pose replaces it
 * instead of leaving an orphan behind, and no request can write outside its own
 * folder. The date is part of the id rather than the folder so a day's three
 * poses sort together.
 */
export async function requestPhotoUpload(input: {
  pose: Pose;
  day?: string;
}): Promise<ActionResult & { ticket?: UploadTicket }> {
  if (!POSES.includes(input.pose)) return { ok: false, message: "Unknown pose" };
  const day = input.day ?? isoDay();
  const live = await liveUser();
  if (!live) return notSignedIn;

  try {
    // uuidFrom keeps the id opaque: a public_id built from a readable date is
    // still only reachable through a signed URL, but there is no reason to put
    // someone's calendar in a path either.
    const publicId = `${day}_${input.pose}_${uuidFrom(`${live.userId}:${day}:${input.pose}`).slice(0, 8)}`;
    return { ok: true, ticket: signUpload(live.userId, publicId) };
  } catch (error) {
    if (error instanceof CloudinaryNotConfiguredError) {
      console.error(error.message);
      // A deployment fault, not something the person did — the screen says so
      // rather than offering an upload that can only fail.
      return { ok: false, message: error.message };
    }
    throw error;
  }
}

/**
 * Record a photo the browser has just uploaded.
 *
 * `storage_path` holds Cloudinary's full public_id (folder included). The row
 * is upserted on (user, date, pose) in effect — the derived public_id makes a
 * repeat upload the same asset — so re-shooting a pose does not stack rows.
 */
export async function savePhoto(input: {
  publicId: string;
  pose: Pose;
  day?: string;
}): Promise<ActionResult> {
  if (!POSES.includes(input.pose)) return { ok: false, message: "Unknown pose" };
  if (!input.publicId.startsWith("voinic/progress/")) {
    return { ok: false, message: "Unexpected upload path" };
  }
  const day = input.day ?? isoDay();
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase, userId } = live;

  // The public_id is deterministic, so a second upload of the same pose points
  // at the same asset; delete any row that already claims it before inserting,
  // rather than letting the gallery show the same picture twice.
  await supabase
    .from("progress_photos")
    .delete()
    .eq("user_id", userId)
    .eq("storage_path", input.publicId);

  const { error } = await supabase.from("progress_photos").insert({
    user_id: userId,
    date: day,
    pose: input.pose,
    storage_path: input.publicId,
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/progress");
  return { ok: true };
}

/** Delete a photo — the row and the asset behind it. */
export async function deletePhoto(id: string): Promise<ActionResult> {
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase, userId } = live;

  const { data: row } = await supabase
    .from("progress_photos")
    .select("storage_path")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  const failed = await mutated(
    await supabase.from("progress_photos").delete({ count: "exact" }).eq("id", id).eq("user_id", userId),
  );
  if (failed) return failed;

  // The row is the record of consent; if the asset survives it, the photo is
  // still out there. Best effort, but loudly logged when it fails, because a
  // silent leftover is exactly what a deletion request must not produce.
  if (row?.storage_path) {
    try {
      await destroyPhoto(row.storage_path as string);
    } catch (error) {
      console.error("progress photo asset not removed:", (error as Error).message);
    }
  }
  revalidatePath("/progress");
  return { ok: true };
}
