import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PDFDict, PDFDocument, PDFName, PDFString } from "pdf-lib";
import type { FitnessScoreSession, NutritionDay, ProgressSession } from "@healthapp/shared";
import { clientAppMessages } from "../i18n/messages/client-app";
import { CSV_BOM, csvCell, neutralizeFormula, toCsv } from "./csv";
import {
  bodyCsv, exerciseProgressCsv, goalsCsv, isCsvKind, lengthOut, localTime, nutritionCsv, weightOut, workoutsCsv,
  type CsvStrings, type FoodRow,
} from "./csv-exports";
import { renderReportPdf, ReportRenderError, type PdfContext } from "./pdf";
import { reportFileName } from "./file-name";
import {
  buildProgressReport, MAX_REPORT_DAYS, parseReportPeriod, PDF_MAX_SESSION_ROWS, reportReadFrom,
  type ReportInputs, type ReportPeriod, type ReportSession,
} from "./report-model";

const TODAY = "2026-10-15";
const TZ = "Europe/Bucharest";
const en = clientAppMessages.en;
const ro = clientAppMessages.ro;
const FONT_DIR = path.join(__dirname, "fonts");
const fonts = {
  regular: new Uint8Array(readFileSync(path.join(FONT_DIR, "DejaVuSansCondensed.ttf"))),
  bold: new Uint8Array(readFileSync(path.join(FONT_DIR, "DejaVuSansCondensed-Bold.ttf"))),
};

function period(raw: Record<string, string>): ReportPeriod {
  const r = parseReportPeriod(raw, TODAY);
  if (!r.ok) throw new Error(r.code);
  return r.period;
}

function day(daysAgo: number, base = TODAY): string {
  return new Date(Date.parse(`${base}T00:00:00Z`) - daysAgo * 86_400_000).toISOString().slice(0, 10);
}

/** A completed session `daysAgo` local days back, 60 minutes, with sets [weight, reps]. */
function session(id: string, daysAgo: number, sets: [number, number, Partial<ReportSession["sets"][number]>?][], name = "Upper A") {
  const d = day(daysAgo);
  const started = `${d}T07:00:00Z`; // 10:00 in Bucharest (summer)
  const completed = `${d}T08:00:00Z`;
  const report: ReportSession = {
    id, day: d, started_at: started, completed_at: completed, name,
    sets: sets.map(([weight_kg, reps, extra], i) => ({
      exercise_id: "bench", exercise_name: "Împins la piept", set_index: i + 1, weight_kg, reps,
      duration_seconds: null, rpe: null, rir: 2, is_pr: false, warmup: false, ...extra,
    })),
  };
  const volume = report.sets.filter((x) => !x.warmup).reduce((n, x) => n + x.weight_kg * x.reps, 0);
  const progress: ProgressSession = {
    id, day: d, load: 50, volume_kg: volume, sets: report.sets.length, prs: report.sets.filter((x) => x.is_pr).length,
    lifts: report.sets.map((x) => ({ exercise_id: "bench", weight_kg: x.weight_kg, reps: x.reps })), duration_min: 60, from_program: true,
  };
  const fitness: FitnessScoreSession = { started_at: started, completed_at: completed, load: 50, volume_kg: volume };
  return { report, progress, fitness };
}

function inputs(over: Partial<ReportInputs> & { built?: ReturnType<typeof session>[] } = {}): ReportInputs {
  const built = over.built ?? [];
  const { built: _b, ...rest } = over;
  return {
    period: period({ range: "30" }),
    today: TODAY,
    timeZone: TZ,
    progressSessions: built.map((b) => b.progress),
    fitnessSessions: built.map((b) => b.fitness),
    sessions: built.map((b) => b.report),
    firstTrainingDay: built.length ? [...built].map((b) => b.report.day).sort()[0]! : null,
    measurements: [],
    nutritionDays: [],
    nutritionEntries: [],
    nutritionFirstDay: null,
    nutritionTarget: null,
    goals: [],
    photosInPeriod: 0,
    truncated: false,
    ...rest,
  };
}

function nday(d: string, kcal: number, protein = 150): NutritionDay {
  return { day: d, kcal, protein, carbs: 200, fat: 70, entries: 4, meals: 3 };
}

function full(): ReportInputs {
  const built = [
    session("s-prev", 40, [[80, 8]]), // previous period
    session("s1", 25, [[40, 10, { warmup: true }], [80, 8], [80, 8]]),
    session("s2", 18, [[82.5, 8], [82.5, 7]]),
    session("s3", 11, [[85, 8, { is_pr: true }], [85, 6]]),
    session("s4", 4, [[87.5, 6, { is_pr: true }]]),
  ];
  return inputs({
    built,
    measurements: [
      { day: day(28), weight_kg: 82, circumferences: { waist: 90 } },
      { day: day(14), weight_kg: 80.5, circumferences: { waist: 88.5, hips: 100 } },
      { day: day(2), weight_kg: 79.25, circumferences: { waist: 87 } },
    ],
    nutritionDays: [nday(day(40), 2100), nday(day(20), 2000), nday(day(10), 2200), nday(day(3), 1800)],
    nutritionFirstDay: day(40),
    nutritionTarget: { kcal: 2000, protein: 160, carbs: 220, fat: 70 },
    photosInPeriod: 2,
  });
}

function pdfCtx(locale: "ro" | "en" = "ro", over: Partial<PdfContext> = {}): PdfContext {
  const t = locale === "ro" ? ro : en;
  return {
    strings: t.reports,
    goalMetricLabels: t.goals.metric,
    measureKeyLabels: t.goals.measureKey,
    perWeekLabel: t.goals.perWeek,
    locale,
    owner: "Ștefan Țăranu",
    generatedAt: new Date("2026-10-15T06:30:00Z"),
    units: { weight: "kg", length: "cm" },
    fonts,
    ...over,
  };
}

const CSV_EN: CsvStrings = { ...en.reports.csv, metrics: en.goals.metric, measureKeys: en.goals.measureKey };

// ---------- 4. the period ----------

describe("report period", () => {
  it("a preset ends today on the person's calendar and runs that many days", () => {
    const p = period({ range: "7" });
    expect(p).toMatchObject({ from: "2026-10-09", to: TODAY, days: 7, preset: 7 });
    expect(p.previous).toEqual({ start: "2026-10-02", end: "2026-10-08" });
  });

  it("no period is the last 30 days, as on the Progress page", () => {
    expect(period({})).toMatchObject({ days: 30, preset: 30 });
  });

  it("a custom period is inclusive, and the previous one has the same length", () => {
    const p = period({ from: "2026-09-01", to: "2026-09-30" });
    expect(p).toMatchObject({ days: 30, preset: "custom" });
    expect(p.previous).toEqual({ start: "2026-08-02", end: "2026-08-31" });
  });

  it("refuses an unknown preset, bad or reversed dates, a future end and a too-long span", () => {
    expect(parseReportPeriod({ range: "14" }, TODAY)).toEqual({ ok: false, code: "REPORT_RANGE" });
    expect(parseReportPeriod({ from: "2026-02-30", to: "2026-03-10" }, TODAY)).toEqual({ ok: false, code: "REPORT_DATES" });
    expect(parseReportPeriod({ from: "2026-10-10", to: "2026-10-01" }, TODAY)).toEqual({ ok: false, code: "REPORT_DATES" });
    expect(parseReportPeriod({ from: "2026-10-01" }, TODAY)).toEqual({ ok: false, code: "REPORT_DATES" });
    expect(parseReportPeriod({ from: "2026-10-01", to: "2026-10-16" }, TODAY)).toEqual({ ok: false, code: "REPORT_FUTURE" });
    expect(parseReportPeriod({ from: "2020-01-01", to: TODAY }, TODAY)).toEqual({ ok: false, code: "REPORT_TOO_LONG" });
    expect(parseReportPeriod({ from: day(MAX_REPORT_DAYS - 1), to: TODAY }, TODAY).ok).toBe(true);
  });

  it("reads far enough back for the previous period and the Fitness Score's 28 days", () => {
    expect(reportReadFrom(period({ range: "7" }))).toBe(day(27)); // the score needs more than the 7+7 days
    expect(reportReadFrom(period({ range: "90" }))).toBe(day(179));
  });
});

// ---------- 1, 2, 3, 5. the report ----------

describe("progress report model", () => {
  it("a complete period: every section available, with figures from the existing functions", () => {
    const r = buildProgressReport(full());
    expect(r.summary.training.current.workouts).toBe(4);
    expect(r.summary.hasPrevious).toBe(true);
    expect(r.training.available).toBe(true);
    if (!r.training.available) return;
    expect(r.training.sessions.map((x) => x.day)).toEqual([day(25), day(18), day(11), day(4)]);
    // the warm-up in s1 is not a working set and adds no volume
    expect(r.training.sessions[0]).toMatchObject({ working_sets: 2, volume_kg: 1280 });
    const bench = r.training.exercises[0]!;
    expect(bench).toMatchObject({ name: "Împins la piept", sessions: 4, working_sets: 7, top_weight_kg: 87.5 });
    expect(bench.one_rm_change_pct).toBeGreaterThan(0);
    expect(r.training.prs).toEqual([
      { day: day(11), exercise: "Împins la piept", weight_kg: 85, reps: 8, estimated_1rm: 107.7 },
      { day: day(4), exercise: "Împins la piept", weight_kg: 87.5, reps: 6, estimated_1rm: 105 },
    ]);
    expect(r.fitness.available).toBe(true);
    expect(r.body.available).toBe(true);
    expect(r.nutrition.available).toBe(true);
    expect(r.photos.count).toBe(2);
  });

  it("an empty period: nothing invented — every section says it has no data", () => {
    const r = buildProgressReport(inputs());
    expect(r.summary.training.current.workouts).toBe(0);
    expect(r.summary.training.current.avg_load).toBeNull();
    expect(r.training).toEqual({ available: false, reason: "no_data" });
    expect(r.fitness).toEqual({ available: false, reason: "not_enough_data" });
    expect(r.body).toEqual({ available: false, reason: "no_data" });
    expect(r.nutrition).toEqual({ available: false, reason: "no_data" });
    expect(r.goals).toEqual({ available: false, reason: "no_data" });
  });

  it("missing pieces stay missing: a failed goals read, unlogged days, a single weigh-in", () => {
    const base = full();
    const r = buildProgressReport({ ...base, goals: null, measurements: [{ day: day(5), weight_kg: 80, circumferences: {} }] });
    expect(r.goals).toEqual({ available: false, reason: "read_failed" });
    if (!r.body.available || !r.nutrition.available) throw new Error("expected sections");
    expect(r.body.comparison).toBeNull(); // one weigh-in is not a comparison
    // 3 logged days in the period: averages are over those 3, not over 30
    expect(r.nutrition.current.days_logged).toBe(3);
    expect(r.nutrition.current.avg!.kcal).toBeCloseTo((2000 + 2200 + 1800) / 3, 6);
    expect(r.nutrition.current.unlogged_days).toBeGreaterThan(0);
  });

  it("only rows inside the period count; the previous period is compared, not mixed in", () => {
    const r = buildProgressReport(full());
    if (!r.training.available || !r.body.available) throw new Error("expected sections");
    expect(r.training.sessions.some((s) => s.day === day(40))).toBe(false);
    expect(r.body.rows.map((m) => m.day)).toEqual([day(28), day(14), day(2)]);
    expect(r.summary.training.previous?.workouts).toBe(1);
    expect(r.summary.training.changes?.workouts).toMatchObject({ current: 4, previous: 1, delta: 3, pct: 300 });
  });

  it("no previous comparison when the person started inside the period", () => {
    const built = [session("a", 10, [[80, 5]]), session("b", 3, [[82, 5]])];
    const r = buildProgressReport(inputs({ built }));
    expect(r.summary.hasPrevious).toBe(false);
    expect(r.summary.training.changes).toBeNull();
  });

  it("body: start vs end compares only what both days recorded", () => {
    const r = buildProgressReport(full());
    if (!r.body.available) throw new Error("expected body");
    expect(r.body.comparison!.deltas.map((d) => d.key)).toEqual(["weight", "waist"]);
    expect(r.body.comparison!.deltas[0]!.change.delta).toBeCloseTo(-2.75, 6);
    expect(r.body.keys).toEqual(["hips", "waist"]);
  });

  it("nutrition: compared with the target only when one is set; label nutrients only with enough coverage", () => {
    const withTarget = buildProgressReport(full());
    if (!withTarget.nutrition.available) throw new Error("expected nutrition");
    expect(withTarget.nutrition.current.adherence?.kcal.target).toBe(2000);
    expect(withTarget.nutrition.labels).toEqual([]); // no entries carried label values
    const noTarget = buildProgressReport({ ...full(), nutritionTarget: null });
    if (!noTarget.nutrition.available) throw new Error("expected nutrition");
    expect(noTarget.nutrition.current.adherence).toBeNull();
  });

  it("caps the PDF's session list and says how many were left for the CSV", () => {
    const built = Array.from({ length: PDF_MAX_SESSION_ROWS + 15 }, (_, i) => session(`x${i}`, i % 360, [[60, 10]]));
    const r = buildProgressReport(inputs({ built, period: period({ range: "365" }) }));
    if (!r.training.available) throw new Error("expected training");
    expect(r.training.sessions).toHaveLength(PDF_MAX_SESSION_ROWS);
    expect(r.training.sessionsOmitted).toBe(15);
  });
});

// ---------- 6. the PDF ----------

describe("PDF export", () => {
  it("renders a complete report as a valid, paginated A4 PDF with its fonts embedded", async () => {
    const bytes = await renderReportPdf(buildProgressReport(full()), pdfCtx("ro"));
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(Math.round(width)).toBe(595);
    expect(Math.round(height)).toBe(842);
    expect(doc.getTitle()).toContain("Raport de progres");
    expect((doc.catalog.get(PDFName.of("Lang")) as PDFString).decodeText()).toBe("ro-RO");
    // the subset font is embedded (the standard fonts cannot encode ș / ț)
    const baseFonts = doc.context.enumerateIndirectObjects()
      .map(([, o]) => (o instanceof PDFDict ? o.get(PDFName.of("BaseFont")) : undefined))
      .filter((x) => x !== undefined)
      .map(String);
    expect(baseFonts.some((n) => n.includes("DejaVuSansCondensed"))).toBe(true);
    expect(baseFonts.some((n) => /Helvetica|Times|Courier/.test(n))).toBe(false);
  });

  it("renders an empty period too — a short file that says so, not an error", async () => {
    const bytes = await renderReportPdf(buildProgressReport(inputs()), pdfCtx("en"));
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it("long history: many workouts break across pages instead of running off the page", async () => {
    const built = Array.from({ length: PDF_MAX_SESSION_ROWS }, (_, i) => session(`p${i}`, i * 3, [[60 + (i % 5), 10]], `Ziua ${i} — un nume foarte lung de antrenament, care trebuie împărțit pe mai multe rânduri fără să fie tăiat`));
    const bytes = await renderReportPdf(buildProgressReport(inputs({ built, period: period({ range: "365" }) })), pdfCtx("ro"));
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(3);
  });

  it("fails with a ReportRenderError — never a half file — when the fonts are missing", async () => {
    await expect(renderReportPdf(buildProgressReport(full()), pdfCtx("ro", { fonts: { regular: new Uint8Array(), bold: new Uint8Array() } })))
      .rejects.toBeInstanceOf(ReportRenderError);
    await expect(renderReportPdf(buildProgressReport(full()), pdfCtx("ro", { fonts: { regular: new Uint8Array([1, 2, 3]), bold: new Uint8Array([4]) } })))
      .rejects.toBeInstanceOf(ReportRenderError);
  });

  it("pounds and inches: the same report renders in the reader's units", async () => {
    const bytes = await renderReportPdf(buildProgressReport(full()), pdfCtx("en", { units: { weight: "lb", length: "in" } }));
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThanOrEqual(1);
  });
});

// ---------- 7, 8. CSV ----------

describe("CSV encoding", () => {
  it("starts with a UTF-8 BOM and keeps Romanian diacritics as they are", () => {
    const out = toCsv(["Exercițiu"], [["Împins înclinat — ș, ț, ă, â, î"]]);
    expect(out.startsWith(CSV_BOM)).toBe(true);
    expect(out).toContain("Exercițiu");
    expect(out).toContain('"Împins înclinat — ș, ț, ă, â, î"'); // quoted because of the commas
  });

  it("quotes commas, quotes and line breaks, and doubles inner quotes", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell("cr\rhere")).toBe('"cr\rhere"');
    expect(csvCell("plain")).toBe("plain");
  });

  it("empty for missing, plain dot numbers, no float noise", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(0)).toBe("0");
    expect(csvCell(82.5)).toBe("82.5");
    expect(csvCell(0.1 + 0.2)).toBe("0.3");
    expect(csvCell(Number.NaN)).toBe("");
    expect(csvCell(-2.5)).toBe("-2.5"); // a number is never "neutralised"
  });

  it("neutralises text that a spreadsheet would run as a formula", () => {
    for (const evil of ["=HYPERLINK(\"http://x\")", "+1+2", "-2+3", "@SUM(A1)", "\t=1", "\r=1"]) {
      expect(neutralizeFormula(evil).startsWith("'")).toBe(true);
    }
    expect(csvCell('=HYPERLINK("http://evil","x")')).toBe(`"'=HYPERLINK(""http://evil"",""x"")"`);
    expect(neutralizeFormula("Ovăz 50 g")).toBe("Ovăz 50 g");
  });

  it("every row must match the header — a misaligned row is a bug, not a silent shift", () => {
    expect(() => toCsv(["a", "b"], [["1"]])).toThrow();
  });

  it("CRLF line ends, as RFC 4180 asks", () => {
    expect(toCsv(["a"], [["1"], ["2"]])).toBe(`${CSV_BOM}a\r\n1\r\n2\r\n`);
  });
});

describe("CSV exports", () => {
  const p = period({ range: "30" });
  const sessions = full().sessions;

  it("knows its five kinds and nothing else", () => {
    expect(["workouts", "exercise-progress", "body", "nutrition", "goals"].every(isCsvKind)).toBe(true);
    expect(isCsvKind("all")).toBe(false);
  });

  it("workouts: one row per set in the period, local date and time, units in the headers", () => {
    const t = workoutsCsv(sessions, p, CSV_EN, { weight: "kg", length: "cm" }, TZ);
    expect(t.headers[0]).toBe("Date (Europe/Bucharest)");
    expect(t.headers[5]).toBe("Weight (kg)");
    expect(t.rows).toHaveLength(3 + 2 + 2 + 1); // the previous-period session is out
    expect(t.rows[0]!.slice(0, 2)).toEqual([day(25), "10:00"]);
    expect(t.rows[0]![10]).toBe("yes"); // the warm-up is marked
  });

  it("a session late in the evening UTC belongs to the next local day", () => {
    expect(localTime("2026-10-14T22:30:00Z", TZ)).toBe("01:30");
  });

  it("weights are exact in kg and converted only for lb readers; lengths likewise", () => {
    expect(weightOut(21.25, "kg")).toBe(21.25);
    expect(weightOut(100, "lb")).toBe(220.46);
    expect(weightOut(null, "kg")).toBeNull();
    expect(lengthOut(90, "in")).toBe(35.43);
    const lb = workoutsCsv(sessions, p, CSV_EN, { weight: "lb", length: "in" }, TZ);
    expect(lb.headers[5]).toBe("Weight (lb)");
    expect(lb.rows[1]![5]).toBe(176.37); // 80 kg
  });

  it("exercise performance: working sets only, best 1RM rounded once at the end", () => {
    const t = exerciseProgressCsv(sessions, p, CSV_EN, { weight: "kg", length: "cm" }, TZ);
    expect(t.rows[0]).toEqual([day(25), "Împins la piept", 2, 80, 8, 101.3, 1280]);
  });

  it("body: a column per measurement recorded, empty where a day did not record it", () => {
    const t = bodyCsv(full().measurements, p, CSV_EN, { weight: "kg", length: "cm" }, TZ);
    expect(t.headers).toEqual(["Date (Europe/Bucharest)", "Body weight (kg)", "Hips (cm)", "Waist (cm)"]);
    expect(t.rows[0]).toEqual([day(28), 82, null, 90]);
    expect(toCsv(t.headers, t.rows)).toContain(`${day(28)},82,,90`);
  });

  it("nutrition: diary rows in the period, meal names translated, food names escaped", () => {
    const foods: FoodRow[] = [
      { day: day(3), slot: "dinner", food_name: "Paste, cu sos \"bolognese\"", grams: 250, kcal: 410.5, protein: 18, carbs: 60, fat: 9 },
      { day: day(3), slot: "breakfast", food_name: "=cmd|' /C calc'!A0", grams: 50, kcal: 190, protein: 6.5, carbs: 33, fat: 3.5 },
      { day: day(45), slot: "lunch", food_name: "out of period", grams: 1, kcal: 1, protein: 0, carbs: 0, fat: 0 },
    ];
    const t = nutritionCsv(foods, p, CSV_EN, TZ);
    expect(t.rows.map((r) => r[1])).toEqual(["Breakfast", "Dinner"]);
    const out = toCsv(t.headers, t.rows);
    expect(out).toContain(`"'=cmd|' /C calc'!A0"`.replace(/^"|"$/g, "")); // neutralised (no quote needed: no comma)
    expect(out).toContain('"Paste, cu sos ""bolognese"""');
    expect(out).not.toContain("out of period");
  });

  it("goals: those alive during the period, values in the reader's units, missing progress left empty", () => {
    const goal = (over: Record<string, unknown>) => ({
      id: "g", title: "Weigh 76", metric: "body_weight", direction: "decrease", target_value: 76, start_value: 82,
      start_date: day(60), target_date: null, status: "active", exercise_id: null, exercise_name: null, measure_key: null,
      achieved_at: null, closed_at: null, points: [],
      progress: { state: "in_progress", current: { day: day(2), value: 79 }, baseline: 82, baselineFrom: "set", pct: 50, change: -3, remaining: 3, daysLeft: null, overdue: false, missing: null },
      ...over,
    }) as never;
    const t = goalsCsv([
      goal({}),
      goal({ title: "Old", status: "achieved", closed_at: `${day(90)}T10:00:00Z`, start_date: day(200) }),
      goal({ title: "Protein", metric: "protein_avg", direction: "increase", target_value: 140, start_value: null, progress: { state: "no_data", current: null, baseline: null, baselineFrom: null, pct: null, change: null, remaining: null, daysLeft: null, overdue: false, missing: "too_few_logged_days" } }),
    ], p, CSV_EN, { weight: "lb", length: "cm" }, TZ);
    expect(t.rows.map((r) => r[0])).toEqual(["Weigh 76", "Protein"]); // the goal closed before the period is out
    expect(t.rows[0]!.slice(3, 8)).toEqual([180.78, 167.55, 174.17, "lb", 50]);
    expect(t.rows[1]!.slice(3, 8)).toEqual([null, 140, null, "g", null]);
  });
});

// ---------- 11. large history ----------

describe("large history", () => {
  it("a year of daily two-a-day training builds, exports and renders in reasonable time", async () => {
    const built = Array.from({ length: 700 }, (_, i) =>
      session(`big${i}`, Math.floor(i / 2), Array.from({ length: 12 }, (_, k) => [60 + (k % 4) * 2.5, 8 + (k % 3)] as [number, number])),
    );
    const t0 = performance.now();
    const r = buildProgressReport(inputs({ built, period: period({ range: "365" }), firstTrainingDay: day(400) }));
    const csv = toCsv(...Object.values(workoutsCsv(built.map((b) => b.report), period({ range: "365" }), CSV_EN, { weight: "kg", length: "cm" }, TZ)) as [string[], never[][]]);
    const pdf = await renderReportPdf(r, pdfCtx("ro"));
    const ms = performance.now() - t0;
    expect(csv.split("\r\n").length).toBeGreaterThan(8000);
    expect(pdf.length).toBeLessThan(1_500_000);
    expect(ms).toBeLessThan(15_000);
  });
});

describe("file names", () => {
  it("say what and when, never who, in plain ASCII", () => {
    const p = period({ from: "2026-09-01", to: "2026-09-30" });
    expect(reportFileName("progress", "pdf", p)).toBe("voinic-progress-report_2026-09-01_2026-09-30.pdf");
    expect(reportFileName("nutrition", "csv", p)).toBe("voinic-food-diary_2026-09-01_2026-09-30.csv");
    expect(reportFileName("exercise-progress", "csv", p)).toMatch(/^[\x20-\x7e]+$/);
  });
});
