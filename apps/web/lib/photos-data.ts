import "server-only";
import { liveUser } from "./supabase/server";
import { cloudinaryConfigured, photoUrl } from "./cloudinary";
import type { Pose } from "@/app/photo-actions";

export type ProgressPhoto = {
  id: string;
  date: string;
  pose: Pose;
  /** Signed and expiring — rebuilt on every render, never stored. */
  url: string;
};

/**
 * This client's photos, newest first. The URLs are minted here because signing
 * needs the API secret, which must not reach the browser.
 */
export async function getMyPhotos(limit = 60): Promise<ProgressPhoto[]> {
  if (!cloudinaryConfigured()) return [];
  const live = await liveUser();
  if (!live) return [];
  const { supabase, userId } = live;
  const { data, error } = await supabase
    .from("progress_photos")
    .select("id, date, pose, storage_path")
    .eq("user_id", userId)
    .order("date", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("progress photos read failed:", error.message);
    return [];
  }
  type Row = { id: string; date: string; pose: Pose | null; storage_path: string };
  return ((data ?? []) as Row[])
    .filter((row) => row.pose !== null)
    .map((row) => ({
      id: row.id,
      date: row.date,
      pose: row.pose as Pose,
      url: photoUrl(row.storage_path, { width: 600 }),
    }));
}
