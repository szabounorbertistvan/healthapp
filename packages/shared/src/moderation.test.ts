import { describe, expect, it } from "vitest";
import { REPORT_DETAILS_MAX, isReportReason, validateReport } from "./moderation";

describe("isReportReason — mirrors the check constraint on social_reports.reason", () => {
  it("accepts the listed reasons only", () => {
    expect(isReportReason("spam")).toBe(true);
    expect(isReportReason("false_information")).toBe(true);
    expect(isReportReason("Spam")).toBe(false);
    expect(isReportReason("boring")).toBe(false);
    expect(isReportReason(undefined)).toBe(false);
  });
});

describe("validateReport", () => {
  it("trims details, and blank details are none", () => {
    expect(validateReport({ reason: "other", details: "  ads everywhere  " })).toEqual({ ok: true, reason: "other", details: "ads everywhere" });
    expect(validateReport({ reason: "spam", details: "   " })).toEqual({ ok: true, reason: "spam", details: null });
    expect(validateReport({ reason: "spam" })).toEqual({ ok: true, reason: "spam", details: null });
  });
  it("refuses a reason that is not on the list, whatever the details", () => {
    expect(validateReport({ reason: "boring", details: "x" })).toEqual({ ok: false, error: "reason" });
  });
  it("caps details at 500 characters, counted after trimming", () => {
    expect(validateReport({ reason: "other", details: "x".repeat(REPORT_DETAILS_MAX) }).ok).toBe(true);
    expect(validateReport({ reason: "other", details: `  ${"x".repeat(REPORT_DETAILS_MAX)}  ` }).ok).toBe(true);
    expect(validateReport({ reason: "other", details: "x".repeat(REPORT_DETAILS_MAX + 1) })).toEqual({ ok: false, error: "details" });
  });
  it("ignores details that are not text", () => {
    expect(validateReport({ reason: "spam", details: 42 })).toEqual({ ok: true, reason: "spam", details: null });
  });
});
