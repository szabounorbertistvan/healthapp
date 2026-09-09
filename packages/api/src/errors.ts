// Business rules raised by Postgres functions (PRODUCT_SPEC §5).
//
// The DB is the enforcement point — "one active coach per client" and the
// tier client limit are rules the UI must never be able to talk around. What
// the UI owns is turning the raised code into something a human understands.

export const RPC_ERRORS = [
  "INVALID_CODE",
  "EXPIRED",
  "ALREADY_HAS_COACH",
  "CLIENT_LIMIT_REACHED",
] as const;

export type RpcErrorCode = (typeof RPC_ERRORS)[number] | "UNKNOWN";

/** Extract the business code from a Supabase/PostgREST error, if there is one. */
export function rpcErrorCode(error: { message: string } | null): RpcErrorCode | null {
  if (!error) return null;
  return RPC_ERRORS.find((code) => error.message.includes(code)) ?? "UNKNOWN";
}

/**
 * Copy for every business rule, supplied by the caller already localized.
 *
 * A `Record` rather than a lookup by key path: this repo's i18n is a typed
 * nested dictionary, not i18next, so there is nothing to resolve a dotted key
 * against. Keying on the union instead means a new entry in RPC_ERRORS breaks
 * the build at every screen that has not written copy for it.
 */
export type InviteCopy = Record<RpcErrorCode, string>;

/** Pick the line for a raised code; a failure without one gets the generic line. */
export function inviteMessage(copy: InviteCopy, code: RpcErrorCode | null | undefined): string {
  return copy[code ?? "UNKNOWN"];
}
