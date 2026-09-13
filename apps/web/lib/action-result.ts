/**
 * Shared action return values that are not themselves server actions.
 *
 * A `"use server"` file may only export async functions (Next.js turns each
 * export into a callable endpoint). `notSignedIn` is a plain object, so it
 * lives here rather than next to `createInvite`.
 */
export const notSignedIn = { ok: false, message: "Not signed in" } as const;
