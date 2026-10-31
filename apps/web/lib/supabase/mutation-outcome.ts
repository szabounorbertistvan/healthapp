import type { PostgrestError } from "@supabase/supabase-js";

export type MutationResult = { error: PostgrestError | null; count: number | null };

/**
 * Pure core of `mutated()` (see ./mutate.ts). Kept free of Next imports so the
 * root Vitest run can load it without an `@/` alias or a request context.
 */
export function mutationOutcome(result: MutationResult): "error" | "no_rows" | "ok" {
  if (result.error) return "error";
  // A null count means the caller forgot { count: "exact" }: fail loudly
  // rather than let that silently reintroduce the bug this guard exists for.
  if (result.count === null || result.count === 0) return "no_rows";
  return "ok";
}

/**
 * Pure core of `inserted()` (see ./mutate.ts). RLS refuses an insert outright
 * — SQLSTATE 42501, "new row violates row-level security policy" — where it
 * filters an update or delete to zero rows. To the person both mean the same:
 * the thing is no longer theirs to change (a coaching that was paused or
 * ended, a program they do not own). Any other error stays an error.
 */
/**
 * An error that says the database was busy or unreachable, not that the write
 * was wrong: a statement timeout (57014), a lost or refused connection (class
 * 08, 57P0x), the server out of resources (53, 58, XX), a serialization or
 * deadlock retry (40001, 40P01), PostgREST unable to reach Postgres or get a
 * pooled connection (PGRST000–PGRST003), or a fetch that never got an answer
 * (no code at all). Its text is Postgres's own English ("canceling statement
 * due to statement timeout") and must never reach a screen.
 */
export function isTransientDbError(error: Pick<PostgrestError, "code"> | null | undefined): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  if (code === "") return true;
  if (code === "57014" || code === "40001" || code === "40P01") return true;
  if (/^PGRST00[0-3]$/.test(code)) return true;
  if (/^57P0\d$/.test(code)) return true;
  return /^(08|53|58|XX)/.test(code);
}

export function insertOutcome(error: PostgrestError | null): "ok" | "refused" | "error" {
  if (!error) return "ok";
  return error.code === "42501" ? "refused" : "error";
}
