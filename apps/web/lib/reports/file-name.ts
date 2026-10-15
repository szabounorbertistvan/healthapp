// The download's file name: what it is and which days it covers — nothing about
// who it belongs to (a file name travels in share sheets, chat previews and
// download lists), and only ASCII, so every system saves it the same way.
import type { CsvKind } from "./csv-exports";
import type { ReportPeriod } from "./report-model";

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
