import { describe, expect, it } from "vitest";
import {
  CLIENT_STEPS, COACH_STEPS, ONBOARDING_KEY, TOUR_IDS, audienceOf, isOnboardingKey, mergeStates, openingStep,
  parseOnboardingState, parseStepParam, pendingSync, placePopover, setupProgress, shouldAutoOpenTour,
  shouldStartOnboarding, showSetupCard, stepStatus, tourEndMark, tourKey, type OnboardingState,
} from "./onboarding-model";

const NEW: OnboardingState = {};
// what 20261123100000 gives every account that existed before it
const EXISTING: OnboardingState = { welcome: "done" };

describe("who sees what", () => {
  it("a client gets the client flow, a coach (or a client turned coach) the coach flow", () => {
    expect(audienceOf("client")).toBe("client");
    expect(audienceOf("coach")).toBe("coach");
    expect(audienceOf("both")).toBe("coach");
    expect(audienceOf("admin")).toBe("coach");
  });

  it("the role picks the steps, never the other way round", () => {
    expect(setupProgress("client", {}, NEW).steps.map((s) => s.id)).toEqual([...CLIENT_STEPS]);
    expect(setupProgress("coach", {}, NEW).steps.map((s) => s.id)).toEqual([...COACH_STEPS]);
    // no coach-only step in the client's flow and vice versa
    expect(CLIENT_STEPS).not.toContain("public_profile" as never);
    expect(COACH_STEPS).not.toContain("goal" as never);
  });
});

describe("new account versus existing account", () => {
  it("only a new account is sent to the welcome cards", () => {
    expect(shouldStartOnboarding(NEW, "client")).toBe(true);
    expect(shouldStartOnboarding(NEW, "coach")).toBe(true);
    expect(shouldStartOnboarding(EXISTING, "client")).toBe(false);
    expect(shouldStartOnboarding({ welcome: "skipped" }, "coach")).toBe(false);
  });

  it("admins are never sent anywhere", () => {
    expect(shouldStartOnboarding(NEW, "admin")).toBe(false);
  });

  it("unknown state (a failed read, an unapplied migration) never redirects", () => {
    expect(shouldStartOnboarding(null, "client")).toBe(false);
    expect(shouldStartOnboarding(null, "coach")).toBe(false);
  });
});

describe("setup steps: completing, skipping, resuming", () => {
  it("a fresh client starts at step 1 of 4 with nothing done", () => {
    const p = setupProgress("client", {}, NEW);
    expect(p).toMatchObject({ done: 0, total: 4, resumeAt: 0, answered: false });
  });

  it("marks move the resume point forward", () => {
    const p = setupProgress("client", {}, { welcome: "done", "step:photo": "done", "step:units": "skipped" });
    expect(p.steps.map((s) => s.status)).toEqual(["done", "skipped", "todo", "todo"]);
    expect(p.done).toBe(1);
    expect(p.resumeAt).toBe(2); // the first unanswered step, not the skipped one
  });

  it("with everything answered, it resumes at the first skipped step", () => {
    const state = { "step:photo": "skipped", "step:units": "done", "step:goal": "skipped", "step:training": "done" } as const;
    const p = setupProgress("client", {}, state);
    expect(p).toMatchObject({ answered: true, resumeAt: 0, done: 2 });
  });

  it("a skipped step can be completed later", () => {
    expect(stepStatus("goal", {}, { "step:goal": "skipped" })).toBe("skipped");
    expect(stepStatus("goal", {}, { "step:goal": "done" })).toBe("done");
    // …or completed elsewhere: the data itself says so
    expect(stepStatus("goal", { goal: true }, { "step:goal": "skipped" })).toBe("done");
  });

  it("all done: no resume point", () => {
    const p = setupProgress("coach", { photo: true, public_profile: true, invite: true, program: true }, EXISTING);
    expect(p).toMatchObject({ done: 4, resumeAt: -1, answered: true });
  });
});

describe("a profile that is already complete", () => {
  it("is never asked again: facts from the data count as done whatever the marks say", () => {
    const facts = { photo: true, units: true, goal: true, training: true };
    const p = setupProgress("client", facts, NEW);
    expect(p.done).toBe(4);
    expect(p.steps.every((s) => s.status === "done")).toBe(true);
  });

  it("gets no setup card", () => {
    const p = setupProgress("coach", { photo: true, public_profile: true, invite: true, program: true }, EXISTING);
    expect(showSetupCard(EXISTING, p)).toBe(false);
  });
});

describe("the Finish setting up card", () => {
  const open = setupProgress("client", { photo: true }, EXISTING);

  it("shows while a step is open", () => {
    expect(showSetupCard(EXISTING, open)).toBe(true);
    // skipped steps keep it — it is the way back to them
    const skipped = setupProgress("client", { photo: true }, { ...EXISTING, "step:units": "skipped" });
    expect(showSetupCard(EXISTING, skipped)).toBe(true);
  });

  it("hides once finished or hidden, before the welcome cards, for admins, and when state is unknown", () => {
    expect(showSetupCard({ ...EXISTING, setup: "done" }, open)).toBe(false);
    expect(showSetupCard({ ...EXISTING, setup: "dismissed" }, open)).toBe(false);
    expect(showSetupCard(NEW, open)).toBe(false);
    expect(showSetupCard(EXISTING, open, "admin")).toBe(false);
    expect(showSetupCard(null, open)).toBe(false);
  });
});

describe("opening step", () => {
  const p = setupProgress("client", {}, { "step:photo": "done" });

  it("?step= wins when it names a step of this audience", () => {
    expect(openingStep("client", p, "goal")).toBe(2);
    expect(parseStepParam("client", ["training"])).toBe(3);
  });

  it("a step of the other role, or junk, falls back to where the person left off", () => {
    expect(parseStepParam("client", "public_profile")).toBeNull();
    expect(openingStep("client", p, "public_profile")).toBe(1);
    expect(openingStep("client", p, "../../etc")).toBe(1);
    expect(openingStep("client", p, undefined)).toBe(1);
  });
});

describe("page tours", () => {
  it("open by themselves once, for someone past the welcome cards", () => {
    expect(shouldAutoOpenTour(EXISTING, "today")).toBe(true);
    expect(shouldAutoOpenTour(NEW, "today")).toBe(false);
  });

  it("never again once finished or closed", () => {
    expect(shouldAutoOpenTour({ ...EXISTING, "tour:today": "done" }, "today")).toBe(false);
    expect(shouldAutoOpenTour({ ...EXISTING, "tour:today": "dismissed" }, "today")).toBe(false);
    // one tour's mark leaves the others alone
    expect(shouldAutoOpenTour({ ...EXISTING, "tour:today": "done" }, "food")).toBe(true);
  });

  it("not when tips are switched off, on this device or for the account, nor when state is unknown", () => {
    expect(shouldAutoOpenTour({ ...EXISTING, tips: "dismissed" }, "food")).toBe(false);
    expect(shouldAutoOpenTour(EXISTING, "food", true)).toBe(false);
    expect(shouldAutoOpenTour(null, "food")).toBe(false);
  });

  it("closing early is remembered as dismissed, reaching the end as done", () => {
    expect(tourEndMark(0, 3)).toBe("dismissed");
    expect(tourEndMark(2, 3)).toBe("done");
    expect(tourEndMark(0, 1)).toBe("done");
  });

  it("every tour id makes a key the database accepts", () => {
    for (const id of TOUR_IDS) expect(isOnboardingKey(tourKey(id))).toBe(true);
  });
});

describe("stored state: parsing, refresh, new session, failed writes", () => {
  it("keeps valid marks and drops anything else", () => {
    expect(parseOnboardingState({
      welcome: "done", "tour:today": "dismissed", "step:goal": "skipped",
      role: "admin", "tour:Today": "done", "step:goal2": "maybe", tips: 3,
    })).toEqual({ welcome: "done", "tour:today": "dismissed", "step:goal": "skipped" });
  });

  it("never throws on junk", () => {
    for (const junk of [null, undefined, "x", 42, [], ["welcome"], true]) {
      expect(parseOnboardingState(junk)).toEqual({});
    }
  });

  it("round-trips through JSON, as after a refresh or on a new device", () => {
    const state = { welcome: "done", "step:photo": "done", "tour:food": "dismissed" } as const;
    expect(parseOnboardingState(JSON.parse(JSON.stringify(state)))).toEqual(state);
  });

  it("the key pattern matches the database's", () => {
    expect(ONBOARDING_KEY.source).toBe("^(welcome|setup|tips|step:[a-z_]{1,32}|tour:[a-z_]{1,32})$");
    expect(isOnboardingKey(`step:${"a".repeat(33)}`)).toBe(false);
  });

  it("a mark that never reached the server still counts on this device", () => {
    const server = { welcome: "done" } as const;
    const local = { "tour:today": "dismissed" } as const;
    expect(mergeStates(server, local)).toEqual({ welcome: "done", "tour:today": "dismissed" });
    expect(pendingSync(server, local)).toEqual([["tour:today", "dismissed"]]);
  });

  it("the server's copy wins a disagreement, and an unreadable server leaves the device's marks", () => {
    expect(mergeStates({ "step:goal": "done" }, { "step:goal": "skipped" })).toEqual({ "step:goal": "done" });
    expect(mergeStates(null, { "tour:today": "done" })).toEqual({ "tour:today": "done" });
    expect(mergeStates(null, {})).toBeNull();
  });

  it("nothing to send again once the server has it", () => {
    expect(pendingSync({ "tour:today": "dismissed" }, { "tour:today": "dismissed" })).toEqual([]);
  });
});

describe("tour card placement", () => {
  const viewport = { width: 390, height: 844 };
  const card = { width: 352, height: 180 };

  it("goes below the target when it fits, clamped into the gutter", () => {
    const p = placePopover({ top: 100, left: 300, width: 80, height: 40 }, card, viewport);
    expect(p.side).toBe("below");
    expect(p.top).toBe(152);
    expect(p.left).toBe(390 - 16 - 352);
  });

  it("goes above when the phone tab bar would cover it below", () => {
    const p = placePopover({ top: 560, left: 20, width: 350, height: 100 }, card, viewport, { bottomInset: 96 });
    expect(p.side).toBe("above");
    expect(p.top + card.height).toBeLessThanOrEqual(560);
  });

  it("never covers the target and never leaves the screen", () => {
    for (const top of [0, 200, 400, 600, 800]) {
      const target = { top, left: 16, width: 358, height: 40 };
      const p = placePopover(target, card, viewport, { bottomInset: 96 });
      expect(p.top).toBeGreaterThanOrEqual(16);
      expect(p.top + card.height).toBeLessThanOrEqual(viewport.height - 96 - 16);
      expect(p.left).toBeGreaterThanOrEqual(16);
      expect(p.left + card.width).toBeLessThanOrEqual(viewport.width - 16 + 0.5);
      const fits = p.side === "below" ? p.top >= top + 40 : p.top + card.height <= top;
      // a target taller than the space either side is the only case allowed to overlap
      if (top >= 200 && top <= 600) expect(fits).toBe(true);
    }
  });
});
