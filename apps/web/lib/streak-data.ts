// Workout streak reads. Everything derives from completed logged_sessions —
// live through workout_days() (one row per local day, already grouped in
// SQL; RLS decides whose) and social_streak() (two numbers for someone
// else's profile); demo from the in-process sessions. The math is
// packages/shared/streaks, the timezone is users.timezone, and nothing here
// is ever written: a client cannot hand the server a streak.
import "server-only";
import { cache } from "react";
import {
  DEFAULT_TIMEZONE,
  getActiveWorkoutDays,
  milestonesReached,
  nextMilestone,
  streakCalendar,
  streakStatus,
  streakSummary,
  todayIn,
  type CalendarDay,
  type MilestoneReached,
  type StreakStatus,
  type StreakSummary,
  type WorkoutDay,
} from "@healthapp/shared";
import { isDemo, supabaseServer } from "./supabase/server";
import { viewingClientId } from "./view-mode";
import { clientStore } from "./demo-client-store";

export type StreakView = {
  today: string;
  timezone: string;
  summary: StreakSummary;
  status: StreakStatus;
  /** The last 12 weeks, Monday → Sunday, oldest week first. */
  calendar: CalendarDay[][];
  /** Every milestone reached, newest first, with whether it is already on the feed. */
  milestones: (MilestoneReached & { shared: boolean })[];
  next_milestone: number | null;
};

/** The two public numbers a profile shows. */
export type StreakStats = { current: number; longest: number };

function sharedKey(m: { milestone: number; streak_start: string }): string {
  return `${m.milestone}@${m.streak_start}`;
}

/**
 * A user's workout days and timezone — their own, or a client's for their
 * coach (live, RLS on logged_sessions decides; an unrelated user gets no
 * rows). Cached per request: Today and the weekly summary both ask.
 */
const workoutDaysFor = cache(async (userId: string): Promise<{ days: WorkoutDay[]; timezone: string }> => {
  if (isDemo) {
    return {
      days: getActiveWorkoutDays(clientStore().sessions.filter((s) => s.client_id === userId), DEFAULT_TIMEZONE),
      timezone: DEFAULT_TIMEZONE,
    };
  }
  const supabase = await supabaseServer();
  const [{ data: rows }, { data: user }] = await Promise.all([
    supabase.rpc("workout_days", { p_user: userId }),
    supabase.from("users").select("timezone").eq("id", userId).maybeSingle(),
  ]);
  return {
    days: ((rows ?? []) as WorkoutDay[]).map((r) => ({ day: r.day, workouts: Number(r.workouts) })),
    timezone: (user?.timezone as string | null) ?? DEFAULT_TIMEZONE,
  };
});

async function me(): Promise<string | null> {
  if (isDemo) return viewingClientId();
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  return auth.user?.id ?? null;
}

/** Current streak of a user the caller may read (self, or a coach's client) — for the weekly summary. */
export async function getWorkoutStreak(userId: string): Promise<StreakSummary> {
  const { days, timezone } = await workoutDaysFor(userId);
  return streakSummary(days, todayIn(timezone));
}

/** The signed-in user's own streak, calendar and milestones. */
export const getMyStreak = cache(async (): Promise<StreakView | null> => {
  const viewer = await me();
  if (!viewer) return null;
  const [{ days, timezone }, shared] = await Promise.all([workoutDaysFor(viewer), sharedMilestones(viewer)]);
  const today = todayIn(timezone);
  const summary = streakSummary(days, today);
  return {
    today,
    timezone,
    summary,
    status: streakStatus(summary),
    calendar: streakCalendar(days, today),
    milestones: milestonesReached(days, today).map((m) => ({ ...m, shared: shared.has(sharedKey(m)) })),
    next_milestone: nextMilestone(summary.current),
  };
});

/** Which (milestone, streak_start) pairs are already on the feed. */
async function sharedMilestones(userId: string): Promise<Set<string>> {
  type Payload = { milestone?: unknown; streak_start?: unknown } | null;
  const keys = (payloads: Payload[]) =>
    new Set(
      payloads
        .filter((p): p is { milestone: number; streak_start: string } => typeof p?.milestone === "number" && typeof p?.streak_start === "string")
        .map(sharedKey),
    );
  if (isDemo) {
    return keys(
      clientStore().posts
        .filter((p) => p.user_id === userId && p.type === "streak" && p.deleted_at === null)
        .map((p) => p.payload as Payload),
    );
  }
  const supabase = await supabaseServer();
  const { data } = await supabase.from("social_posts").select("payload").eq("user_id", userId).eq("type", "streak").is("deleted_at", null);
  return keys(((data ?? []) as { payload: Payload }[]).map((p) => p.payload));
}

/** Someone's current and longest streak — the numbers only, for their profile. */
export async function getUserStreak(userId: string): Promise<StreakStats> {
  if (isDemo) {
    const s = await getWorkoutStreak(userId);
    return { current: s.current, longest: s.longest };
  }
  const supabase = await supabaseServer();
  const { data } = await supabase.rpc("social_streak", { p_user: userId });
  const row = ((data ?? []) as { current_days: number; longest_days: number }[])[0];
  return { current: row?.current_days ?? 0, longest: row?.longest_days ?? 0 };
}
