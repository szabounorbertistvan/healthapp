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
