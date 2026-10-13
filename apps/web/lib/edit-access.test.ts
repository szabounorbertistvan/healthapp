import { afterEach, describe, expect, it, vi } from "vitest";
import { checkEditAccess, editAccessFrom } from "./edit-access";

describe("editAccessFrom — only an explicit yes opens the editor", () => {
  it("granted: true → edit", () => {
    expect(editAccessFrom({ data: true, error: null })).toBe("edit");
  });

  it("refused (coaching ended or paused — can_edit_* answers false) → read-only", () => {
    expect(editAccessFrom({ data: false, error: null })).toBe("read-only");
  });

  it("an RPC error → unverified, never edit — even when data looks like a yes", () => {
    expect(editAccessFrom({ data: null, error: { code: "PGRST202", message: "function not found" } })).toBe("unverified");
    expect(editAccessFrom({ data: true, error: { code: "57014", message: "statement timeout" } })).toBe("unverified");
  });

  it.each([
    ["null", null], ["undefined", undefined], ["the string 'true'", "true"], ["1", 1], ["an object", { ok: true }], ["an array", [true]],
  ])("a missing or invalid result (%s) → unverified", (_, data) => {
    expect(editAccessFrom({ data, error: null })).toBe("unverified");
  });

  it("no answer object at all → unverified", () => {
    expect(editAccessFrom(null)).toBe("unverified");
    expect(editAccessFrom(undefined)).toBe("unverified");
  });
});

describe("checkEditAccess — the call itself failing", () => {
  afterEach(() => vi.useRealTimers());

  it("passes a definite answer through", async () => {
    await expect(checkEditAccess(async () => ({ data: true, error: null }))).resolves.toBe("edit");
    await expect(checkEditAccess(async () => ({ data: false, error: null }))).resolves.toBe("read-only");
  });

  it("a rejected or throwing call → unverified", async () => {
    await expect(checkEditAccess(() => Promise.reject(new Error("fetch failed")))).resolves.toBe("unverified");
    await expect(checkEditAccess(() => { throw new Error("no client"); })).resolves.toBe("unverified");
  });

  it("no answer within the time limit → unverified, and a late yes changes nothing", async () => {
    vi.useFakeTimers();
    let answer!: (v: { data: unknown; error: unknown }) => void;
    const pending = checkEditAccess(() => new Promise((resolve) => { answer = resolve; }), 1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(pending).resolves.toBe("unverified");
    answer({ data: true, error: null });
    await expect(pending).resolves.toBe("unverified");
  });
});
