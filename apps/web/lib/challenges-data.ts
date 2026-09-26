// Server-side reads for challenges.
//
// Progress, completion, milestones and ranks are computed in the database
// (20261001100000_advanced_challenges): challenge_cards() folds the caller's
// logged rows for every challenge they can see — and stamps milestones and
// completion once, server-side — challenge_leaderboard() ranks participants,
// coach_challenge_progress() gives a coach their clients' standing. This file
// only maps rows (lib/challenge-map) and sorts; nothing a client sends is ever
// read as progress.
import "server-only";
import { getI18n } from "./i18n/server";
import { getProfile } from "./data";
import { liveUser, supabaseServer } from "./supabase/server";
import { toChallengeCard, toLeaderboard, type ChallengeCardRow, type LeaderboardDbRow } from "./challenge-map";
import type { ChallengeCard, ChallengeDetail, CoachChallengeRow } from "./types";

/** How many rows a detail page's board shows — the caller's own row is always added. */
const BOARD_SIZE = 20;

/** Active first, then upcoming, then finished; nearest deadline first within a group. */
function sortCards(cards: ChallengeCard[]): ChallengeCard[] {
  const order = { active: 0, upcoming: 1, completed: 2, ended: 3 };
  return [...cards].sort((a, b) => order[a.status] - order[b.status] || a.end_date.localeCompare(b.end_date));
}

async function cards(p_challenge: string | null): Promise<ChallengeCard[]> {
  const live = await liveUser();
  if (!live) return [];
  const [{ locale }, { data, error }] = await Promise.all([
    getI18n(),
    live.supabase.rpc("challenge_cards", { p_challenge }),
  ]);
  // An empty list is a legitimate answer; a failed read must not look like one.
  if (error) throw new Error(`Failed to load challenges: ${error.message}`);
  return ((data ?? []) as ChallengeCardRow[])
    .map((r) => toChallengeCard(r, locale))
    .filter((c): c is ChallengeCard => c !== null);
}

/** Every challenge the person can see, with their own standing. One round trip. */
export async function getMyChallenges(): Promise<ChallengeCard[]> {
  return sortCards(await cards(null));
}

/** One challenge with its board — the board is null for a private single-person challenge. */
export async function getChallenge(id: string): Promise<ChallengeDetail | null> {
  const live = await liveUser();
  if (!live) return null;
  const [list, { data: board, error }] = await Promise.all([
    cards(id),
    live.supabase.rpc("challenge_leaderboard", { p_challenge: id, p_limit: BOARD_SIZE }),
  ]);
  const card = list[0];
  if (!card) return null;
  if (error) throw new Error(`Failed to load the leaderboard for ${id}: ${error.message}`);
  return { ...card, leaderboard: toLeaderboard((board ?? []) as LeaderboardDbRow[], card.visibility) };
}

/**
 * The coach's view: every challenge one of their active clients has joined,
 * with each client's progress — two round trips in total, never one per
 * challenge.
 */
export async function getCoachChallenges(): Promise<CoachChallengeRow[]> {
  const profile = await getProfile();
  if (!profile || (profile.role !== "coach" && profile.role !== "admin")) return [];
  const supabase = await supabaseServer();
  const [{ data: progress, error }, all] = await Promise.all([
    supabase.rpc("coach_challenge_progress"),
    cards(null),
  ]);
  if (error) throw new Error(`Failed to load clients' challenges: ${error.message}`);
  type Row = { challenge_id: string; client_id: string; username: string; value: number | string; completed: boolean };
  const byChallenge = new Map<string, Row[]>();
  for (const r of (progress ?? []) as Row[]) {
    const list = byChallenge.get(r.challenge_id) ?? [];
    list.push(r);
    byChallenge.set(r.challenge_id, list);
  }
  const out: CoachChallengeRow[] = [];
  for (const card of all) {
    const clients = byChallenge.get(card.id);
    if (!clients) continue;
    out.push({
      challenge: card,
      clients: clients.map((c) => {
        const value = Number(c.value);
        return {
          client_id: c.client_id,
          name: c.username,
          progress: value,
          pct: card.target > 0 ? (value * 100) / card.target : 0,
          completed: c.completed,
        };
      }),
    });
  }
  return out;
}
