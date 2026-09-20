// Admin reads. Every function here is a thin wrapper over one admin_* RPC
// (supabase/migrations/20260920100000_admin_panel.sql); the RPC checks
// is_admin() itself, so a non-admin caller gets a 42501 error, never data.
// Pages call requireAdmin() first for the redirect, then these for the rows.
import "server-only";
import { cache } from "react";
import { FITNESS_SCORE_PERIOD_DAYS, fitnessScore, fitnessScoreTrend, todayIn } from "@healthapp/shared";
import type { FitnessScoreSession } from "@healthapp/shared";
import { supabaseServer } from "@/lib/supabase/server";
import { loadOf, toLoadSet, type LoadSetJoin } from "@/lib/training-load";
import type { FitnessScoreView } from "@/lib/fitness-score-data";
import type {
  AdminOverview, AdminUserDetail, AdminUsersPage, AuditPage, AuthStats, ChallengeDetail, ChallengesPage,
  DailyPoint, ExercisesPage, InvitationsPage, NotificationStats, NutritionStats, Probe, SearchResults,
  SocialPage, SocialPostDetail, SystemHealth, TimelineEvent, WorkoutStats,
} from "./types";

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data as T;
}

export const getAdminOverview = cache(() => rpc<AdminOverview>("admin_overview"));

export const getAdminDailySeries = cache((days: number) =>
  rpc<DailyPoint[]>("admin_daily_series", { p_days: days }),
);

export type UsersQuery = {
  search?: string | null; role?: string | null; status?: string | null; coach?: string | null;
  createdDays?: number | null; activeDays?: number | null; sort?: string | null; limit: number; offset: number;
};

export function getAdminUsers(q: UsersQuery): Promise<AdminUsersPage> {
  return rpc<AdminUsersPage>("admin_users", {
    p_search: q.search ?? null, p_role: q.role ?? null, p_status: q.status ?? null, p_coach: q.coach ?? null,
    p_created_days: q.createdDays ?? null, p_active_days: q.activeDays ?? null,
    p_sort: q.sort ?? "newest", p_limit: q.limit, p_offset: q.offset,
  });
}

export const getAdminUserDetail = cache((userId: string) =>
  rpc<AdminUserDetail | null>("admin_user_detail", { p_user: userId }),
);

export function getAdminUserTimeline(userId: string, before: string | null, limit: number): Promise<TimelineEvent[]> {
  return rpc<TimelineEvent[]>("admin_user_timeline", { p_user: userId, p_before: before, p_limit: limit });
}

/**
 * The same fitness score Today shows the person, computed from sessions the
 * admin RPC hands back (RLS would hide them from a plain select).
 */
export async function getAdminUserFitness(userId: string, timezone: string): Promise<FitnessScoreView> {
  type Row = { started_at: string; completed_at: string | null; sets: LoadSetJoin[] };
  const rows = await rpc<Row[]>("admin_user_load_sessions", { p_user: userId, p_days: 2 * FITNESS_SCORE_PERIOD_DAYS + 1 });
  const sessions: FitnessScoreSession[] = rows.map((s) => {
    const load = loadOf((s.sets ?? []).map(toLoadSet), s.started_at, s.completed_at);
    return { started_at: s.started_at, completed_at: s.completed_at, load: load.score, volume_kg: load.volume_kg };
  });
  const today = todayIn(timezone);
  const current = fitnessScore({ sessions, timeZone: timezone, today, periodsAgo: 0 });
  const previous = fitnessScore({ sessions, timeZone: timezone, today, periodsAgo: 1 });
  return { current, previous, trend: fitnessScoreTrend(current, previous), timezone, today };
}

export type AuditQuery = {
  action?: string | null; actor?: string | null; target?: string | null; entityType?: string | null;
  search?: string | null; from?: string | null; to?: string | null; limit: number; offset: number;
};

export function getAdminAuditLog(q: AuditQuery): Promise<AuditPage> {
  return rpc<AuditPage>("admin_audit_log", {
    p_action: q.action ?? null, p_actor: q.actor ?? null, p_target: q.target ?? null,
    p_entity_type: q.entityType ?? null, p_search: q.search ?? null,
    p_from: q.from ?? null, p_to: q.to ?? null, p_limit: q.limit, p_offset: q.offset,
  });
}

export const getAdminAuthStats = cache(() => rpc<AuthStats>("admin_auth_stats"));

export function getAdminInvitations(q: { status?: string | null; search?: string | null; days?: number | null; limit: number; offset: number }): Promise<InvitationsPage> {
  return rpc<InvitationsPage>("admin_invitations", {
    p_status: q.status ?? null, p_search: q.search ?? null, p_days: q.days ?? null, p_limit: q.limit, p_offset: q.offset,
  });
}

export const getAdminWorkoutStats = cache((days: number) => rpc<WorkoutStats>("admin_workout_stats", { p_days: days }));

export function getAdminExercises(q: {
  search?: string | null; category?: string | null; equipment?: string | null; muscle?: string | null;
  source?: string | null; owner?: string | null; limit: number; offset: number;
}): Promise<ExercisesPage> {
  return rpc<ExercisesPage>("admin_exercises", {
    p_search: q.search ?? null, p_category: q.category ?? null, p_equipment: q.equipment ?? null,
    p_muscle: q.muscle ?? null, p_source: q.source ?? null, p_owner: q.owner ?? null,
    p_limit: q.limit, p_offset: q.offset,
  });
}

export const getAdminNutritionStats = cache((days: number) => rpc<NutritionStats>("admin_nutrition_stats", { p_days: days }));

export function getAdminSocialPosts(q: {
  type?: string | null; visibility?: string | null; status?: string | null; search?: string | null; author?: string | null;
  limit: number; offset: number;
}): Promise<SocialPage> {
  return rpc<SocialPage>("admin_social_posts", {
    p_type: q.type ?? null, p_visibility: q.visibility ?? null, p_status: q.status ?? null,
    p_search: q.search ?? null, p_author: q.author ?? null, p_limit: q.limit, p_offset: q.offset,
  });
}

export const getAdminSocialPost = cache((postId: string) => rpc<SocialPostDetail | null>("admin_social_post", { p_post: postId }));

export const getAdminChallenges = cache(() => rpc<ChallengesPage>("admin_challenges"));

export const getAdminChallengeDetail = cache((id: string) => rpc<ChallengeDetail | null>("admin_challenge_detail", { p_challenge: id }));

export const getAdminNotificationStats = cache(() => rpc<NotificationStats>("admin_notification_stats"));

export const getAdminSystemHealth = cache(() => rpc<SystemHealth>("admin_system_health"));

/**
 * Reachability of the Supabase services from this server, with latency. A
 * HEAD/GET that answers anything at all counts as reachable — an auth error
 * from the functions gateway still proves the gateway is up. Never the
 * service role: the anon key is what the browser already has.
 */
export async function probeServices(): Promise<Probe[]> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";
  if (!base) return [];
  const targets: { name: string; url: string; init?: RequestInit }[] = [
    { name: "rest", url: `${base}/rest/v1/`, init: { headers: { apikey: anon } } },
    { name: "auth", url: `${base}/auth/v1/health`, init: { headers: { apikey: anon } } },
    { name: "functions", url: `${base}/functions/v1/rest-push`, init: { method: "OPTIONS" } },
    { name: "storage", url: `${base}/storage/v1/version`, init: { headers: { apikey: anon } } },
  ];
  return Promise.all(
    targets.map(async (t) => {
      const started = performance.now();
      try {
        const res = await fetch(t.url, { ...t.init, signal: AbortSignal.timeout(5000), cache: "no-store" });
        return { name: t.name, url: t.url, ok: res.status < 500, status: res.status, ms: Math.round(performance.now() - started) };
      } catch (e) {
        return { name: t.name, url: t.url, ok: false, status: null, ms: Math.round(performance.now() - started), note: e instanceof Error ? e.message : String(e) };
      }
    }),
  );
}

export const adminSearch = cache((query: string) => rpc<SearchResults>("admin_search", { p_query: query, p_limit: 8 }));
