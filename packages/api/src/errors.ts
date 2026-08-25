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

const MESSAGE_KEYS: Record<RpcErrorCode, string> = {
  INVALID_CODE: "errors.invite.invalidCode",
  EXPIRED: "errors.invite.expired",
  ALREADY_HAS_COACH: "errors.invite.alreadyHasCoach",
  CLIENT_LIMIT_REACHED: "errors.invite.clientLimitReached",
  UNKNOWN: "errors.unknown",
};

/** i18next key for the code — RO/EN copy lives in the locale files, not here. */
export function messageKeyFor(code: RpcErrorCode): string {
  return MESSAGE_KEYS[code];
}
