import { describe, expect, test } from "vitest";
import { RPC_ERRORS, inviteMessage, rpcErrorCode } from "./errors";

// Postgres functions signal business rules with `raise exception 'CODE'`
// (PRODUCT_SPEC §5). Both surfaces must turn the same code into the same
// message, so the mapping lives here rather than in each screen.

describe("rpcErrorCode", () => {
  test("recognises a known business rule raised by Postgres", () => {
    expect(rpcErrorCode({ message: "ALREADY_HAS_COACH" })).toBe("ALREADY_HAS_COACH");
  });

  test("finds the code inside a wrapped Postgres message", () => {
    expect(
      rpcErrorCode({ message: 'unexpected: EXPIRED (SQLSTATE P0001)' }),
    ).toBe("EXPIRED");
  });

  test("falls back to UNKNOWN for anything else", () => {
    expect(rpcErrorCode({ message: "connection reset" })).toBe("UNKNOWN");
  });

  test("returns null when the call succeeded", () => {
    expect(rpcErrorCode(null)).toBeNull();
  });
});

describe("inviteMessage", () => {
  // The caller passes copy it has already localized; this decides which line.
  const copy = {
    INVALID_CODE: "invalid",
    EXPIRED: "expired",
    ALREADY_HAS_COACH: "has coach",
    CLIENT_LIMIT_REACHED: "limit",
    UNKNOWN: "generic",
  };

  test("picks the line written for the raised code", () => {
    expect(inviteMessage(copy, "EXPIRED")).toBe("expired");
  });

  test("gives every business rule a line of its own", () => {
    const lines = RPC_ERRORS.map((code) => inviteMessage(copy, code));
    expect(new Set(lines).size).toBe(RPC_ERRORS.length);
  });

  test("falls back to the generic line when the failure carried no code", () => {
    expect(inviteMessage(copy, undefined)).toBe("generic");
  });
});
