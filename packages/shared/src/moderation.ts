/**
 * Reports, blocks and mutes — the rules both sides share. The database has
 * the same ones (20261007100000_social_block_mute_report.sql): the reason
 * list and the details cap are check constraints, and social_report()
 * re-validates everything it is sent. This is the first answer, so a bad
 * request is refused before it is spent; it is never the only one.
 */

export const REPORT_REASONS = [
  "spam", "harassment", "hate", "inappropriate", "false_information", "impersonation", "scam", "other",
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_DETAILS_MAX = 500;

/** What can be reported: social_report()'s targets; a coach review since 20261106100000. */
export type ReportTarget = "post" | "comment" | "user" | "review";

export function isReportReason(v: unknown): v is ReportReason {
  return typeof v === "string" && (REPORT_REASONS as readonly string[]).includes(v);
}

/**
 * A report as the database will take it: a listed reason, and details that
 * are either nothing (blank reads as nothing) or 1–500 trimmed characters.
 */
export function validateReport(input: { reason: unknown; details?: unknown }):
  | { ok: true; reason: ReportReason; details: string | null }
  | { ok: false; error: "reason" | "details" } {
  if (!isReportReason(input.reason)) return { ok: false, error: "reason" };
  const raw = typeof input.details === "string" ? input.details.trim() : "";
  if (raw.length > REPORT_DETAILS_MAX) return { ok: false, error: "details" };
  return { ok: true, reason: input.reason, details: raw.length > 0 ? raw : null };
}
