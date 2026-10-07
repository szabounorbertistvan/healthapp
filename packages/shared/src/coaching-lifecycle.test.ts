import { describe, expect, it } from "vitest";
import { canTransition, coachingMoves, isCurrent, moveTarget, RELATIONSHIP_STATUSES } from "./coaching-lifecycle";

describe("the lifecycle graph (mirrors trainer_clients_lifecycle_guard)", () => {
  it("invited → active | ended; active → paused | ended; paused → active | ended", () => {
    expect(canTransition("invited", "active")).toBe(true);
    expect(canTransition("invited", "ended")).toBe(true);
    expect(canTransition("active", "paused")).toBe(true);
    expect(canTransition("active", "ended")).toBe(true);
    expect(canTransition("paused", "active")).toBe(true);
    expect(canTransition("paused", "ended")).toBe(true);
  });
  it("ended is final, and nothing goes back to invited or skips the start", () => {
    for (const to of RELATIONSHIP_STATUSES) if (to !== "ended") expect(canTransition("ended", to)).toBe(false);
    expect(canTransition("active", "invited")).toBe(false);
    expect(canTransition("invited", "paused")).toBe(false);
  });
});

describe("what a participant may do", () => {
  it("active: pause or end; paused: resume or end; otherwise nothing", () => {
    expect(coachingMoves("active")).toEqual(["pause", "end"]);
    expect(coachingMoves("paused")).toEqual(["resume", "end"]);
    expect(coachingMoves("ended")).toEqual([]);
    expect(coachingMoves("invited")).toEqual([]);
  });
  it("every move lands where the graph allows", () => {
    for (const from of RELATIONSHIP_STATUSES) {
      for (const move of coachingMoves(from)) expect(canTransition(from, moveTarget(move))).toBe(true);
    }
  });
  it("a paused coach is still the current coach", () => {
    expect(isCurrent("active")).toBe(true);
    expect(isCurrent("paused")).toBe(true);
    expect(isCurrent("ended")).toBe(false);
  });
});
