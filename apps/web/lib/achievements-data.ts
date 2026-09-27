// Achievement reads for the signed-in person. One RPC, achievement_progress(),
// computes every metric from their own rows in the database and returns the
// whole catalog with current / target / award date — no per-badge queries,
// and no number the browser could supply. Someone else's badges go through
// getProfileBadges() in social-data.ts, which applies their privacy setting.
import "server-only";
import { cache } from "react";
import type { AchievementRow } from "./types";
import { currentActorId } from "./actor";
import { supabaseServer } from "./supabase/server";

/** The caller's catalog with progress, in catalog order. Cached per request. */
export const getMyAchievements = cache(async (): Promise<AchievementRow[]> => {
  const viewer = await currentActorId();
  if (!viewer) return [];
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("achievement_progress");
  if (error) {
    console.error("achievement progress read failed:", error.message);
    return [];
  }
  return ((data ?? []) as AchievementRow[]).map((r) => ({
    ...r,
    target: Number(r.target),
    current_value: Number(r.current_value),
  }));
});
