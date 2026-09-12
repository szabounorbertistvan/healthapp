// Server-side reads for challenges. Same contract as client-data.ts: demo mode
// folds the in-process store, live mode goes through Supabase under RLS. All
// progress is derived — challengeProgress() over session rollups and active
// days — never read from a column, so nothing a client types can move it.
import "server-only";
import {
  canJoin,
  challengeProgress,
  challengeStatus,
  daysRemaining,
  isChallengeComplete,
  isChallengeType,
  progressPct,
  rankParticipants,
  trainingLoadFromStats,
  type ChallengeActivity,
  type ChallengeType,
} from "@healthapp/shared";
import { isDemo, supabaseServer } from "./supabase/server";
import { getI18n } from "./i18n/server";
import { getProfile, getRoster } from "./data";
import { store } from "./demo-store";
import { viewingClientId } from "./view-mode";
import { clientStore, isoDay, type StoredChallenge, type StoredParticipant } from "./demo-client-store";
import { loadOf } from "./training-load";
import type { ChallengeCard, ChallengeDetail, CoachChallengeRow, LeaderboardRow } from "./types";

type Row = {
  id: string;
  title_en: string;
  title_ro: string;
  description_en: string | null;
  description_ro: string | null;
  type: string;
  target_value: number | string;
  start_date: string;
  end_date: string;
  visibility: "public" | "private";
};

/** Everything one person's standing in a challenge is built from. */
type Standing = { joined: boolean; completed_at: string | null; participants: number; activity: ChallengeActivity };

async function toCard(row: Row, standing: Standing, today: string): Promise<ChallengeCard | null> {
  if (!isChallengeType(row.type)) return null;
  const { locale } = await getI18n();
  const target = Number(row.target_value);
  const window = { start_date: row.start_date, end_date: row.end_date };
  const progress = standing.joined ? challengeProgress(row.type, standing.activity, window) : 0;
  const completed = standing.completed_at !== null || (standing.joined && isChallengeComplete(progress, target));
  return {
    id: row.id,
    title: locale === "ro" ? row.title_ro : row.title_en,
    description: locale === "ro" ? row.description_ro : row.description_en,
    type: row.type,
    target,
    start_date: row.start_date,
    end_date: row.end_date,
    visibility: row.visibility,
    participants: standing.participants,
    joined: standing.joined,
    completed_at: standing.completed_at,
    progress,
    pct: progressPct(progress, target),
    status: challengeStatus(window, today, completed),
    days_remaining: daysRemaining(row.end_date, today),
    can_join: !standing.joined && canJoin(window, today),
  };
}

// ---------- demo ----------

function demoActivityFor(userId: string): ChallengeActivity {
  const cs = clientStore();
  const sessions = cs.sessions
    .filter((s) => s.client_id === userId && s.completed_at !== null)
    .map((s) => {
      const load = loadOf(
        cs.sets.filter((x) => x.session_id === s.id).map((x) => ({ ...x, exercise: x.exercise_name })),
        s.started_at,
        s.completed_at,
      );
      return { day: s.started_at.slice(0, 10), load: load.score, volume_kg: load.volume_kg };
    });
  const active = new Set<string>();
  for (const f of cs.foodLogs) if (f.client_id === userId) active.add(f.logged_on);
  const habitIds = new Set(cs.habits.filter((h) => h.client_id === userId).map((h) => h.id));
  for (const h of cs.habitLogs) if (habitIds.has(h.habit_id)) active.add(h.done_on);
  return { sessions, active_days: [...active] };
}

function demoStanding(challenge: StoredChallenge, userId: string): Standing {
  const members = clientStore().participants.filter((p) => p.challenge_id === challenge.id);
  const mine = members.find((p) => p.user_id === userId) ?? null;
  return {
    joined: mine !== null,
    completed_at: mine?.completed_at ?? null,
    participants: members.length,
    activity: mine ? demoActivityFor(userId) : { sessions: [], active_days: [] },
  };
}

function demoName(userId: string): string {
  return store().clients.find((c) => c.client_id === userId)?.full_name ?? userId;
}

/** Stamp completed_at the first time the target is seen reached — the "completed" event. */
function demoPersistCompletion(p: StoredParticipant, card: ChallengeCard) {
  if (p.completed_at === null && card.joined && isChallengeComplete(card.progress, card.target)) {
    p.completed_at = new Date().toISOString();
    card.completed_at = p.completed_at;
  }
}

// ---------- live ----------

type ProgressRow = {
  user_id: string;
  full_name: string | null;
  username: string | null;
  kind: "session" | "day";
  day: string;
  sets: number | null;
  volume_kg: number | string | null;
  duration_min: number | null;
  mean_rpe: number | string | null;
  exercises: number | null;
};

/** Fold the RPC's rollups into one ChallengeActivity per participant. */
function activitiesFrom(rows: ProgressRow[]): Map<string, { name: string; activity: ChallengeActivity }> {
  const out = new Map<string, { name: string; activity: ChallengeActivity }>();
  for (const r of rows) {
    let entry = out.get(r.user_id);
    if (!entry) {
      entry = { name: r.username ?? r.full_name ?? "—", activity: { sessions: [], active_days: [] } };
      out.set(r.user_id, entry);
    }
    if (r.kind === "day") {
      entry.activity.active_days.push(r.day);
      continue;
    }
    const load = trainingLoadFromStats({
      volume_kg: Number(r.volume_kg ?? 0),
      sets: r.sets ?? 0,
      duration_min: r.duration_min,
      intensity: r.mean_rpe === null ? null : Number(r.mean_rpe),
      exercises: r.exercises,
    });
    entry.activity.sessions.push({ day: r.day, load: load.score, volume_kg: load.volume_kg });
  }
  return out;
}

async function livePersistCompletion(
  supabase: Awaited<ReturnType<typeof supabaseServer>>,
  challengeId: string,
  userId: string,
  card: ChallengeCard,
) {
  if (card.completed_at !== null || !card.joined || !isChallengeComplete(card.progress, card.target)) return;
  const stamp = new Date().toISOString();
  const { error } = await supabase
    .from("challenge_participants")
    .update({ completed_at: stamp })
    .eq("challenge_id", challengeId)
    .eq("user_id", userId)
    .is("completed_at", null);
  if (!error) card.completed_at = stamp;
}

// ---------- public API ----------

/** Every challenge the person can see, with their own standing. Newest deadline first. */
export async function getMyChallenges(): Promise<ChallengeCard[]> {
  const today = isoDay();
  if (isDemo) {
    const userId = await viewingClientId();
    const cs = clientStore();
    const cards: ChallengeCard[] = [];
    for (const ch of cs.challenges) {
      const card = await toCard(ch, demoStanding(ch, userId), today);
      if (!card) continue;
      const mine = cs.participants.find((p) => p.challenge_id === ch.id && p.user_id === userId);
      if (mine) demoPersistCompletion(mine, card);
      cards.push(card);
    }
    return sortCards(cards);
  }
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return [];
  const [{ data: rows }, { data: parts }] = await Promise.all([
    supabase.from("challenges").select("*").order("end_date", { ascending: false }),
    supabase.from("challenge_participants").select("challenge_id, user_id, completed_at"),
  ]);
  type Part = { challenge_id: string; user_id: string; completed_at: string | null };
  const partRows = (parts ?? []) as Part[];
  const cards: ChallengeCard[] = [];
  for (const row of (rows ?? []) as Row[]) {
    const members = partRows.filter((p) => p.challenge_id === row.id);
    const mine = members.find((p) => p.user_id === auth.user.id) ?? null;
    let activity: ChallengeActivity = { sessions: [], active_days: [] };
    if (mine) {
      const { data } = await supabase.rpc("challenge_progress_rows", { p_challenge: row.id });
      activity = activitiesFrom((data ?? []) as ProgressRow[]).get(auth.user.id)?.activity ?? activity;
    }
    const card = await toCard(
      row,
      { joined: mine !== null, completed_at: mine?.completed_at ?? null, participants: members.length, activity },
      today,
    );
    if (!card) continue;
    await livePersistCompletion(supabase, row.id, auth.user.id, card);
    cards.push(card);
  }
  return sortCards(cards);
}

/** Active first, then upcoming, then finished; nearest deadline first within a group. */
function sortCards(cards: ChallengeCard[]): ChallengeCard[] {
  const order = { active: 0, upcoming: 1, completed: 2, ended: 3 };
  return [...cards].sort((a, b) => order[a.status] - order[b.status] || a.end_date.localeCompare(b.end_date));
}

/** One challenge with the leaderboard — null for a private single-person challenge. */
export async function getChallenge(id: string): Promise<ChallengeDetail | null> {
  const today = isoDay();
  if (isDemo) {
    const userId = await viewingClientId();
    const cs = clientStore();
    const ch = cs.challenges.find((c) => c.id === id);
    if (!ch) return null;
    const card = await toCard(ch, demoStanding(ch, userId), today);
    if (!card) return null;
    const mine = cs.participants.find((p) => p.challenge_id === ch.id && p.user_id === userId);
    if (mine) demoPersistCompletion(mine, card);
    const members = cs.participants.filter((p) => p.challenge_id === ch.id);
    const entries = members.map((p) => ({
      user_id: p.user_id,
      name: demoName(p.user_id),
      me: p.user_id === userId,
      value: challengeProgress(ch.type, demoActivityFor(p.user_id), ch),
    }));
    return { ...card, leaderboard: leaderboardOf(ch.visibility, entries) };
  }
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data: row } = await supabase.from("challenges").select("*").eq("id", id).maybeSingle();
  if (!row || !isChallengeType((row as Row).type)) return null;
  const r = row as Row;
  const [{ data: parts }, { data: progress }] = await Promise.all([
    supabase.from("challenge_participants").select("user_id, completed_at").eq("challenge_id", id),
    supabase.rpc("challenge_progress_rows", { p_challenge: id }),
  ]);
  type Part = { user_id: string; completed_at: string | null };
  const members = (parts ?? []) as Part[];
  const mine = members.find((p) => p.user_id === auth.user.id) ?? null;
  const activities = activitiesFrom((progress ?? []) as ProgressRow[]);
  const card = await toCard(
    r,
    {
      joined: mine !== null,
      completed_at: mine?.completed_at ?? null,
      participants: members.length,
      activity: activities.get(auth.user.id)?.activity ?? { sessions: [], active_days: [] },
    },
    today,
  );
  if (!card) return null;
  await livePersistCompletion(supabase, id, auth.user.id, card);
  const entries = members.map((p) => {
    const a = activities.get(p.user_id);
    return {
      user_id: p.user_id,
      name: a?.name ?? "—",
      me: p.user_id === auth.user.id,
      value: a ? challengeProgress(r.type as ChallengeType, a.activity, r) : 0,
    };
  });
  return { ...card, leaderboard: leaderboardOf(r.visibility, entries) };
}

function leaderboardOf(
  visibility: "public" | "private",
  entries: { user_id: string; name: string; me: boolean; value: number }[],
): LeaderboardRow[] | null {
  if (entries.length === 0) return null;
  if (visibility === "private" && entries.length === 1) return null;
  return rankParticipants(entries);
}

/**
 * The coach's view: every challenge one of their active clients has joined,
 * with each client's progress. Live, RLS shows the coach exactly those
 * participant rows and the RPC scores them; nothing extra to filter.
 */
export async function getCoachChallenges(): Promise<CoachChallengeRow[]> {
  const today = isoDay();
  if (isDemo) {
    const cs = clientStore();
    const roster = new Set(store().clients.filter((c) => c.status === "active").map((c) => c.client_id));
    const out: CoachChallengeRow[] = [];
    for (const ch of cs.challenges) {
      const members = cs.participants.filter((p) => p.challenge_id === ch.id && roster.has(p.user_id));
      if (members.length === 0) continue;
      const card = await toCard(
        ch,
        { joined: false, completed_at: null, participants: cs.participants.filter((p) => p.challenge_id === ch.id).length, activity: { sessions: [], active_days: [] } },
        today,
      );
      if (!card) continue;
      out.push({
        challenge: card,
        clients: members.map((p) => {
          const progress = challengeProgress(ch.type, demoActivityFor(p.user_id), ch);
          return {
            client_id: p.user_id,
            name: demoName(p.user_id),
            progress,
            pct: progressPct(progress, ch.target_value),
            completed: p.completed_at !== null || isChallengeComplete(progress, ch.target_value),
          };
        }),
      });
    }
    return out;
  }
  const profile = await getProfile();
  if (!profile || (profile.role !== "coach" && profile.role !== "admin")) return [];
  const supabase = await supabaseServer();
  // RLS also shows the coach every participant of a public challenge, so the
  // rows are narrowed to the active roster here.
  const roster = new Set((await getRoster()).map((c) => c.id));
  if (roster.size === 0) return [];
  const { data: parts } = await supabase
    .from("challenge_participants")
    .select("challenge_id, user_id, completed_at")
    .in("user_id", [...roster]);
  type Part = { challenge_id: string; user_id: string; completed_at: string | null };
  const partRows = (parts ?? []) as Part[];
  const ids = [...new Set(partRows.map((p) => p.challenge_id))];
  if (ids.length === 0) return [];
  const { data: rows } = await supabase.from("challenges").select("*").in("id", ids);
  const out: CoachChallengeRow[] = [];
  for (const row of (rows ?? []) as Row[]) {
    if (!isChallengeType(row.type)) continue;
    const members = partRows.filter((p) => p.challenge_id === row.id);
    const { data: progress } = await supabase.rpc("challenge_progress_rows", { p_challenge: row.id });
    const activities = activitiesFrom((progress ?? []) as ProgressRow[]);
    const card = await toCard(
      row,
      { joined: false, completed_at: null, participants: members.length, activity: { sessions: [], active_days: [] } },
      today,
    );
    if (!card) continue;
    const target = Number(row.target_value);
    out.push({
      challenge: card,
      clients: members.map((p) => {
        const a = activities.get(p.user_id);
        const value = a ? challengeProgress(row.type as ChallengeType, a.activity, row) : 0;
        return {
          client_id: p.user_id,
          name: a?.name ?? "—",
          progress: value,
          pct: progressPct(value, target),
          completed: p.completed_at !== null || isChallengeComplete(value, target),
        };
      }),
    });
  }
  return out;
}
