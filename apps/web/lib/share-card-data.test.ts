import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ShareableSession } from "./types";

// getWorkoutShareCard builds the card only from what getShareableSession
// returns, and that read is scoped to the signed-in user (user_id = viewer
// on top of RLS). These tests pin the contract at this layer: someone else's
// session id — which the scoped read answers with null — yields no card and
// leaks nothing about the author; the user's own id yields their card with
// the aggregates untouched.

vi.mock("server-only", () => ({}));
vi.mock("./social-data", () => ({ getShareableSession: vi.fn() }));
vi.mock("./data", () => ({
  getProfile: vi.fn(),
  displayName: (p: { username: string | null; full_name: string }) => p.username ?? p.full_name.split("@")[0]!,
}));

const { getShareableSession } = await import("./social-data");
const { getProfile } = await import("./data");
const { getWorkoutShareCard, shareProfileOf } = await import("./share-card-data");

const mine: ShareableSession = {
  session_id: "mine-1", name: "Push", date: "2026-09-14", duration_min: 50, exercises: 5, sets: 15,
  volume_kg: 5200, load: 61, prs: [], already_shared: false,
};

const me = { id: "u1", full_name: "Norbert Szabo", username: "norbert", avatar_url: null, sex: null, birth_year: null, role: "client" as const, tier: "free" as const, trial_ends_at: null };

beforeEach(() => {
  vi.mocked(getProfile).mockResolvedValue(me as never);
  vi.mocked(getShareableSession).mockImplementation(async (id: string) => (id === "mine-1" ? mine : null));
});

describe("getWorkoutShareCard", () => {
  test("returns the signed-in user's own session as a card", async () => {
    const card = await getWorkoutShareCard("mine-1");
    expect(card).not.toBeNull();
    expect(card!.session_id).toBe("mine-1");
    expect(card!.workout.volume_kg).toBe(5200);
    expect(card!.workout.load).toBe(61);
    expect(card!.profile).toEqual({ name: "norbert", username: "norbert", avatar_url: null });
    expect(getShareableSession).toHaveBeenCalledWith("mine-1");
  });

  test("another user's session id yields no card — the scoped read returns nothing", async () => {
    expect(await getWorkoutShareCard("someone-elses-session")).toBeNull();
    expect(await getWorkoutShareCard("")).toBeNull();
  });

  test("with no signed-in user there is no card", async () => {
    vi.mocked(getShareableSession).mockResolvedValue(null);
    vi.mocked(getProfile).mockResolvedValue(null);
    expect(await getWorkoutShareCard("mine-1")).toBeNull();
  });
});

describe("shareProfileOf", () => {
  test("shows the username, never the email behind full_name", () => {
    expect(shareProfileOf({ full_name: "someone@example.com", username: "someone", avatar_url: "a.png" }))
      .toEqual({ name: "someone", username: "someone", avatar_url: "a.png" });
    expect(shareProfileOf(null)).toBeNull();
  });
});
