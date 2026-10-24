import { describe, expect, it } from "vitest";
import { percent, timeAgo } from "./format";

describe("percent", () => {
  it("shows an adherence share the way the web does", () => {
    expect(percent(0.15)).toBe("15%");
    expect(percent(0.8)).toBe("80%");
    expect(percent(1)).toBe("100%");
    expect(percent(0)).toBe("0%");
    expect(percent(Number.NaN)).toBe("0%");
  });
});

describe("timeAgo", () => {
  const now = Date.parse("2026-10-24T12:00:00Z");
  it("uses the web's words in both languages", () => {
    expect(timeAgo(null, "en", now)).toBe("never");
    expect(timeAgo("2026-10-24T08:00:00Z", "en", now)).toBe("today");
    expect(timeAgo("2026-10-23T08:00:00Z", "en", now)).toBe("1d ago");
    expect(timeAgo("2026-10-20T12:00:00Z", "ro", now)).toBe("acum 4 zile");
    expect(timeAgo("2026-10-23T08:00:00Z", "ro", now)).toBe("acum 1 zi");
  });
});
