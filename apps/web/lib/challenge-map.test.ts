import { describe, expect, it } from "vitest";
import { toChallengeCard, toLeaderboard, type ChallengeCardRow } from "./challenge-map";

function row(over: Partial<ChallengeCardRow> = {}): ChallengeCardRow {
  return {
    id: "c1", title_en: "50,000 kg Volume", title_ro: "50.000 kg volum",
    description_en: "Lift it.", description_ro: "Ridică-l.",
    type: "volume", target_value: "50000.00", start_date: "2026-10-01", end_date: "2026-10-31",
    visibility: "public", difficulty: "hard", exercise_id: null, exercise_name_en: null, exercise_name_ro: null,
    is_platform: true, is_mine: false, participant_count: 12,
    joined: true, value: "45200.00", completed_at: null, milestones: [25, 50, 75], local_today: "2026-10-26",
    ...over,
  };
}

describe("toChallengeCard", () => {
  it("reads numeric columns exactly and computes the page's figures from them", () => {
    const c = toChallengeCard(row(), "en")!;
    expect(c.progress).toBe(45200);
    expect(c.target).toBe(50000);
    expect(c.pct).toBe(90.4);
    expect(c.days_remaining).toBe(6);
    expect(c.status).toBe("active");
    expect(c.unit).toBe("kg");
    expect(c.category).toBe("training");
    expect(c.milestones).toEqual([25, 50, 75]);
  });

  it("uses the member's LOCAL today from the database, not the server's", () => {
    // Oct 31 is still the last day locally even if the server is past midnight UTC.
    const c = toChallengeCard(row({ local_today: "2026-10-31" }), "en")!;
    expect(c.status).toBe("active");
    expect(c.days_remaining).toBe(1);
    expect(toChallengeCard(row({ local_today: "2026-11-01" }), "en")!.status).toBe("ended");
  });

  it("picks the reader's language, falling back to English", () => {
    expect(toChallengeCard(row(), "ro")!.title).toBe("50.000 kg volum");
    expect(toChallengeCard(row({ title_ro: "" }), "ro")!.title).toBe("50,000 kg Volume");
  });

  it("a card not joined has no progress, and the completion stamp decides 'completed'", () => {
    const notJoined = toChallengeCard(row({ joined: false, value: null, milestones: [] }), "en")!;
    expect(notJoined.progress).toBe(0);
    expect(notJoined.pct).toBe(0);
    expect(notJoined.can_join).toBe(true);
    const done = toChallengeCard(row({ completed_at: "2026-10-20T10:00:00Z", value: "51000" }), "en")!;
    expect(done.status).toBe("completed");
    expect(done.can_join).toBe(false);
  });

  it("an exercise challenge carries the exercise's name", () => {
    const c = toChallengeCard(row({ type: "strength_gain", exercise_id: "e1", exercise_name_en: "Squat", exercise_name_ro: "Genuflexiuni", target_value: 5, value: 2.5 }), "ro")!;
    expect(c.exercise_name).toBe("Genuflexiuni");
    expect(c.unit).toBe("percent");
    expect(c.pct).toBe(50);
  });

  it("drops a row of a type the app does not know", () => {
    expect(toChallengeCard(row({ type: "steps" }), "en")).toBeNull();
  });
});

describe("toLeaderboard", () => {
  const rows = [
    { rank: 1, username: "alice", value: "2", completed: false, is_me: false, participant_count: 3 },
    { rank: 1, username: "bob", value: "2", completed: false, is_me: true, participant_count: 3 },
    { rank: 3, username: "carol", value: "0", completed: false, is_me: false, participant_count: 3 },
  ];

  it("keeps the database's ranks (ties included) and carries no user ids", () => {
    const board = toLeaderboard(rows, "public")!;
    expect(board.map((r) => [r.rank, r.name, r.value, r.me])).toEqual([[1, "alice", 2, false], [1, "bob", 2, true], [3, "carol", 0, false]]);
    expect(Object.keys(board[0]!)).not.toContain("user_id");
  });

  it("a private challenge with only its creator has nothing to rank", () => {
    expect(toLeaderboard([{ ...rows[1]!, participant_count: 1 }], "private")).toBeNull();
    expect(toLeaderboard([], "public")).toBeNull();
  });
});
