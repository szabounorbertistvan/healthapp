import { describe, expect, it } from "vitest";
import type { PostgrestError } from "@supabase/supabase-js";
import { insertOutcome, mutationOutcome } from "./mutation-outcome";

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

describe("insertOutcome", () => {
  it("passes when there is no error", () => {
    expect(insertOutcome(null)).toBe("ok");
  });
  it("reads an RLS refusal (42501) as refused, not as a raw error for the screen", () => {
    expect(insertOutcome(err)).toBe("refused");
  });
  it("keeps every other error an error", () => {
    expect(insertOutcome({ ...err, code: "23505" } as PostgrestError)).toBe("error");
    expect(insertOutcome({ ...err, code: "23514" } as PostgrestError)).toBe("error");
  });
});
