import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-next";

const BACKSLASH = String.fromCharCode(92);

describe("safeNext", () => {
  it("keeps same-site paths", () => {
    expect(safeNext("/reset-password")).toBe("/reset-password");
    expect(safeNext("/workout/abc?x=1#top")).toBe("/workout/abc?x=1#top");
  });
  it("refuses everything that leaves the site", () => {
    const bad = [
      "//evil.com", `/${BACKSLASH}evil.com`, "/\t/evil.com", "/%5Cevil.com/..", "https://evil.com", "evil.com", "", null,
    ];
    for (const raw of bad) {
      const out = safeNext(raw);
      expect(new URL(out, "https://voinic.fit").origin).toBe("https://voinic.fit");
    }
    // The two shapes a prefix check let through (QA SEC-1).
    expect(safeNext(`/${BACKSLASH}evil.com`)).toBe("/dashboard");
    expect(safeNext("/\t/evil.com")).toBe("/dashboard");
  });
});
