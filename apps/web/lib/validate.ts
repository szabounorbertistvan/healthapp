import { z } from "zod";
import type { ActionResult } from "@/app/actions";
import { getI18n } from "@/lib/i18n/server";

/**
 * Runtime shape checks for server-action arguments.
 *
 * Every export of a `"use server"` file is a public POST endpoint: the
 * TypeScript signature only binds our own screens, and anyone with a session
 * can call it with whatever JSON they like. RLS still decides *whose* rows a
 * write may touch; this decides that the arguments are the kind of thing the
 * action takes — ids are ids, numbers are finite, enums are members — before a
 * query is built from them.
 *
 * Shape only. Business rules with a user-facing message (a name that is
 * blank, sets outside 1..20 via `validateTargets`) stay where they were, after
 * the parse, so their copy does not change.
 */

/** Any 8-4-4-4-12 hex id. Not `z.uuid()`: that one checks the RFC version nibble, and seeds use the nil uuid. */
export const id = z.guid();
export const step = z.union([z.literal(-1), z.literal(1)]);
export const intensityMode = z.enum(["rpe", "rir", "simple"]);
/** A name as typed: trimmed and checked for blank by the action itself. */
export const text = (max = 200) => z.string().max(max);
/**
 * A number, NaN included: an emptied form field arrives as NaN, and the
 * action's own range check is what answers it with a sentence ("Weight must
 * be zero or more"). Rejecting it here would swap that for a generic error.
 */
export const num = z.union([z.number(), z.nan()]);

export type Parsed<T> = { ok: true; data: T } | { ok: false; result: ActionResult };

/**
 * `const parsed = await parseInput(schema, input); if (!parsed.ok) return parsed.result;`
 *
 * Several positional arguments are checked as one `z.tuple([...])`. The
 * offending path goes to the server log, never to the screen.
 */
export async function parseInput<S extends z.ZodType>(schema: S, input: unknown): Promise<Parsed<z.output<S>>> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };
  console.warn("action input rejected:", z.prettifyError(parsed.error));
  const { t } = await getI18n();
  return { ok: false, result: { ok: false, errorCode: "INVALID_INPUT", message: t.common.actions.invalidInput } };
}
