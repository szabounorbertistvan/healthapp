// The download's file name: what it is and which days it covers — nothing about
// who it belongs to (a file name travels in share sheets, chat previews and
// download lists), and only ASCII, so every system saves it the same way.
import type { CsvKind } from "./csv-exports";
import { parseReportPeriod, type ReportPeriod } from "./report-model";

const STEM: Record<CsvKind | "progress", string> = {
  progress: "progress-report",
  workouts: "workouts",
  "exercise-progress": "exercise-performance",
  body: "body-measurements",
  nutrition: "food-diary",
  goals: "goals",
};

export function reportFileName(kind: CsvKind | "progress", format: "pdf" | "csv", period: Pick<ReportPeriod, "from" | "to">): string {
  return `voinic-${STEM[kind]}_${period.from}_${period.to}.${format}`;
}

/** The progress PDF periods a coach can download, in days (the client page and the app's). */
export const COACH_REPORT_RANGES = [30, 90, 365] as const;

/** Each period that parses on the client's calendar (`today`), with its file name. */
export function coachReportOptions(today: string): { days: number; fileName: string }[] {
  return COACH_REPORT_RANGES.flatMap((days) => {
    const parsed = parseReportPeriod({ range: String(days) }, today);
    return parsed.ok ? [{ days, fileName: reportFileName("progress", "pdf", parsed.period) }] : [];
  });
}
