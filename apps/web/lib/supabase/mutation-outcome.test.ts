import { describe, expect, it } from "vitest";
import type { PostgrestError } from "@supabase/supabase-js";
import { insertOutcome, isTransientDbError, mutationOutcome } from "./mutation-outcome";

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

describe("isTransientDbError", () => {
  const code = (c: string) => ({ code: c });
  it("flags a busy or unreachable database, whose text must not reach a screen", () => {
    for (const c of ["57014", "40001", "40P01", "08006", "53300", "57P01", "58000", "XX000", "PGRST000", "PGRST003", ""]) {
      expect(isTransientDbError(code(c))).toBe(true);
    }
  });
  it("leaves real refusals alone: RLS, constraints and the schema's own raised codes", () => {
    for (const c of ["42501", "23505", "23514", "P0001", "22023", "PGRST116"]) {
      expect(isTransientDbError(code(c))).toBe(false);
    }
    expect(isTransientDbError(null)).toBe(false);
  });
});
