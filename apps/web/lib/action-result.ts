/**
 * Shared action return values that are not themselves server actions.
 *
 * A `"use server"` file may only export async functions (Next.js turns each
 * export into a callable endpoint). `notSignedIn` is a plain object, so it
 * lives here rather than next to `createInvite`.
 */
export const notSignedIn = { ok: false, message: "Not signed in" } as const;

/**
 * A write refused by the person's plan: a limit the database enforces
 * (PLAN_LIMIT_REACHED from enforce_plan_limit / claim_barcode_scan) or a
 * feature their tier does not include (UPGRADE_REQUIRED, checked in the
 * action). Screens show the upgrade hint for both rather than the message.
 */
export type PlanErrorCode = "PLAN_LIMIT_REACHED" | "UPGRADE_REQUIRED";
export const planLimitReached = { ok: false, message: "PLAN_LIMIT_REACHED", errorCode: "PLAN_LIMIT_REACHED" } as const;
export const upgradeRequired = { ok: false, message: "UPGRADE_REQUIRED", errorCode: "UPGRADE_REQUIRED" } as const;
