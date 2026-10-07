"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { liveUser } from "@/lib/supabase/server";
import { notSignedIn } from "@/lib/action-result";
import { id, parseInput } from "@/lib/validate";
import { REVIEW_BODY_MAX, REVIEW_RESPONSE_MAX, reviewErrorCode } from "@/lib/coach-review";
import type { ActionResult } from "./actions";

// Review writes (migration 20261106100000). Every one is an RPC: who wrote
// it, about whom, and whether they may, are decided in the database from the
// session — nothing here sends a reviewer or a coach id. Reports go through
// the existing reportContent() (moderation-actions.ts), moderation through
// admin-actions.ts.

function failure(error: { message: string }): ActionResult {
  const code = reviewErrorCode(error);
  if (code) return { ok: false, errorCode: code, message: code };
  console.error("review write failed:", error.message);
  return { ok: false, message: error.message };
}

function touched(slug?: string) {
  if (slug) revalidatePath(`/coaches/${slug}`);
  revalidatePath("/coaches", "layout");
  revalidatePath("/reviews");
}

/** Write or rewrite the reader's review of a coach: one per coach, edited in place. */
export async function submitReview(input: { profileId: string; slug: string; rating: number; body: string | null }): Promise<ActionResult> {
  const parsed = await parseInput(z.object({
    profileId: id, slug: z.string().max(60), rating: z.number().int().min(1).max(5),
    body: z.string().max(REVIEW_BODY_MAX).nullable(),
  }).strict(), input);
  if (!parsed.ok) return parsed.result;
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { error } = await live.supabase.rpc("submit_coach_review", {
    p_coach_profile: parsed.data.profileId, p_rating: parsed.data.rating, p_body: parsed.data.body?.trim() || null,
  });
  if (error) return failure(error);
  touched(parsed.data.slug);
  return { ok: true };
}

/** The reviewer takes their review down (it can be written again later). */
export async function deleteMyReview(reviewId: string, slug: string): Promise<ActionResult> {
  const parsed = await parseInput(z.object({ reviewId: id, slug: z.string().max(60) }).strict(), { reviewId, slug });
  if (!parsed.ok) return parsed.result;
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { error } = await live.supabase.rpc("delete_my_coach_review", { p_review: parsed.data.reviewId });
  if (error) return failure(error);
  touched(parsed.data.slug);
  return { ok: true };
}

/** The coach's one answer to a review about them; empty removes it. */
export async function respondToReview(reviewId: string, body: string): Promise<ActionResult> {
  const parsed = await parseInput(z.object({ reviewId: id, body: z.string().max(REVIEW_RESPONSE_MAX) }).strict(), { reviewId, body });
  if (!parsed.ok) return parsed.result;
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { error } = await live.supabase.rpc("respond_to_coach_review", { p_review: parsed.data.reviewId, p_body: parsed.data.body });
  if (error) return failure(error);
  touched();
  return { ok: true };
}
