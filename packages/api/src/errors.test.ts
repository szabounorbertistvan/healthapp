import { describe, expect, test } from "vitest";
import { RPC_ERRORS, messageKeyFor, rpcErrorCode } from "./errors";

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

describe("messageKeyFor", () => {
  test("gives every known business rule a translation key", () => {
    for (const code of RPC_ERRORS) {
      expect(messageKeyFor(code)).toMatch(/^errors\./);
    }
  });

  test("routes an unknown failure to the generic key", () => {
    expect(messageKeyFor("UNKNOWN")).toBe("errors.unknown");
  });
});
