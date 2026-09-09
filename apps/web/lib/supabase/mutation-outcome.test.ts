import { describe, expect, it } from "vitest";
import type { PostgrestError } from "@supabase/supabase-js";
import { mutationOutcome } from "./mutation-outcome";

const err = { message: "boom", details: "", hint: "", code: "42501", name: "PostgrestError" } as PostgrestError;

describe("mutationOutcome", () => {
  it("treats a PostgREST error as an error", () => {
    expect(mutationOutcome({ error: err, count: 1 })).toBe("error");
  });
  it("treats zero matched rows as a failure, not a success", () => {
    expect(mutationOutcome({ error: null, count: 0 })).toBe("no_rows");
  });
  it("treats a missing count as a failure (caller forgot count: exact)", () => {
    expect(mutationOutcome({ error: null, count: null })).toBe("no_rows");
  });
  it("passes when at least one row changed", () => {
    expect(mutationOutcome({ error: null, count: 1 })).toBe("ok");
    expect(mutationOutcome({ error: null, count: 3 })).toBe("ok");
  });
});
