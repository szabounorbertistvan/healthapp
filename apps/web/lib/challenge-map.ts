// challenge_cards() / challenge_leaderboard() rows → what the pages render.
// Pure (split out of the server-only reader) so the rules are testable:
// numeric columns read exactly, the member's LOCAL today decides status and
// days left (the database hands it over), and the board keeps the database's
// ranks and carries no user ids.
import {
  canJoin,
  challengeCategory,
  challengePct,
  challengeStatus,
  challengeUnit,
  daysRemaining,
  isChallengeDifficulty,
  isChallengeType,
} from "@healthapp/shared";
import type { ChallengeCard, LeaderboardRow } from "./types";

export type ChallengeCardRow = {
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
  difficulty: string | null;
  exercise_id: string | null;
  exercise_name_en: string | null;
  exercise_name_ro: string | null;
  is_platform: boolean;
  is_mine: boolean;
  participant_count: number;
  joined: boolean;
  /** Null unless joined. */
  value: number | string | null;
  completed_at: string | null;
  milestones: number[] | null;
  /** The member's calendar day (users.timezone), from my_local_today(). */
  local_today: string;
};

export function toChallengeCard(r: ChallengeCardRow, locale: "en" | "ro"): ChallengeCard | null {
  if (!isChallengeType(r.type)) return null;
  const ro = locale === "ro";
  const target = Number(r.target_value);
  const progress = r.joined && r.value !== null ? Number(r.value) : 0;
  const window = { start_date: r.start_date, end_date: r.end_date };
  const completed = r.completed_at !== null;
  return {
    id: r.id,
    title: (ro && r.title_ro) || r.title_en,
    description: (ro ? r.description_ro : r.description_en) ?? r.description_en,
    type: r.type,
    unit: challengeUnit(r.type),
    category: challengeCategory(r.type),
    difficulty: isChallengeDifficulty(r.difficulty) ? r.difficulty : null,
    exercise_name: r.exercise_id ? ((ro && r.exercise_name_ro) || r.exercise_name_en) : null,
    target,
    start_date: r.start_date,
    end_date: r.end_date,
    visibility: r.visibility,
    participants: r.participant_count,
    joined: r.joined,
    completed_at: r.completed_at,
    progress,
    pct: r.joined ? (challengePct(progress, target) ?? 0) : 0,
    milestones: r.milestones ?? [],
    status: challengeStatus(window, r.local_today, completed),
    days_remaining: daysRemaining(r.end_date, r.local_today),
    can_join: !r.joined && canJoin(window, r.local_today),
    mine: r.is_mine,
    is_platform: r.is_platform,
  };
}

export type LeaderboardDbRow = {
  rank: number;
  username: string;
  value: number | string;
  completed: boolean;
  is_me: boolean;
  participant_count: number;
};

/** Null when there is nothing to rank: no rows, or a private challenge with one person. */
export function toLeaderboard(rows: readonly LeaderboardDbRow[], visibility: "public" | "private"): LeaderboardRow[] | null {
  if (rows.length === 0) return null;
  if (visibility === "private" && (rows[0]?.participant_count ?? 0) <= 1) return null;
  return rows.map((r) => ({ rank: r.rank, name: r.username, value: Number(r.value), me: r.is_me, completed: r.completed }));
}
