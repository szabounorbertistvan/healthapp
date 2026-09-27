import { describe, expect, it } from "vitest";
import { boardRowHref, splitBoard } from "./leaderboard-map";
import { toLeaderboard } from "./challenge-map";

const id = (n: number) => `d1000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const row = (rank: number, me = false, score = 100 - rank) => ({ rank, user_id: id(rank), is_current_user: me, score });

describe("splitBoard — the server's rows, as sent", () => {
  it("shows the top rows without the blocked person, keeping every rank and score the server sent", () => {
    // Rank 3 was blocked: the server sent 1, 2, 4 … 11 to fill a top ten.
    const rows = [1, 2, 4, 5, 6, 7, 8, 9, 10, 11].map((r) => row(r));
    const board = splitBoard(rows, 10);
    expect(board.entries.map((r) => r.rank)).toEqual([1, 2, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(board.entries.map((r) => r.score)).toEqual(rows.map((r) => r.score));
    expect(board.entries).toHaveLength(10);
  });
  it("does not re-sort by score: the server's order stands", () => {
    const rows = [row(1, false, 5), row(2, false, 9)];
    expect(splitBoard(rows, 10).entries.map((r) => r.rank)).toEqual([1, 2]);
  });
  it("keeps the caller's own row below the top out of the top, but finds it", () => {
    const rows = [...[1, 2, 3].map((r) => row(r)), row(27, true)];
    const board = splitBoard(rows, 3);
    expect(board.entries.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(board.me?.rank).toBe(27);
    expect(board.total).toBe(27);
  });
  it("finds the caller inside the top too", () => {
    expect(splitBoard([row(1), row(2, true)], 10).me?.rank).toBe(2);
  });
  it("an empty board — nothing visible, or a failed read — is empty, not an error", () => {
    expect(splitBoard([], 10)).toEqual({ entries: [], me: null, total: 0 });
  });
});

describe("toLeaderboard — a challenge's ranking", () => {
  const db = (rank: number, username: string, value: number, is_me = false) =>
    ({ rank, username, value, completed: false, is_me, participant_count: 4 });

  it("keeps the server's ranks and values when a row was left out", () => {
    const board = toLeaderboard([db(2, "carabd", 4), db(3, "anabd", 3, true), db(4, "danbd", 2)], "public");
    expect(board?.map((r) => `${r.name}:${r.rank}:${r.value}`)).toEqual(["carabd:2:4", "anabd:3:3", "danbd:4:2"]);
  });
  it("no visible rows is no board (the page shows its empty state)", () => {
    expect(toLeaderboard([], "public")).toBeNull();
  });
});

describe("boardRowHref", () => {
  it("links a row to the person's profile", () => {
    expect(boardRowHref(id(1))).toBe(`/people/${id(1)}`);
  });
  it("links nothing for an id that is not one", () => {
    expect(boardRowHref("../admin")).toBeNull();
  });
});
