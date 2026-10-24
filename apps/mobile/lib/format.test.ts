import { describe, expect, it } from "vitest";
import { percent } from "./format";

describe("percent", () => {
  it("shows an adherence share the way the web does", () => {
    expect(percent(0.15)).toBe("15%");
    expect(percent(0.8)).toBe("80%");
    expect(percent(1)).toBe("100%");
    expect(percent(0)).toBe("0%");
    expect(percent(Number.NaN)).toBe("0%");
  });
});
