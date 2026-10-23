// The progress report as a PDF — generated on our own server from the
// report model, with no external service: the person's data never leaves
// this app to be typeset.
//
// pdf-lib (+ @pdf-lib/fontkit) writes the file; it is pure JavaScript, has no
// native parts and runs in the Node runtime of a route handler. The text is set
// in DejaVu Sans Condensed (embedded, subset to the glyphs used), which covers
// ă â î ș ț and their capitals — the 14 standard PDF fonts cannot encode ș/ț.
//
// The small layout engine below exists for one reason: a report must not cut
// text or split a table row. Every string is wrapped to its column, a table row
// is measured before it is drawn and moves whole to the next page (the header
// is repeated there), and page numbers are drawn after the last page is known.
import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { GoalMetric, LabelNutrient, LengthUnit, WeightUnit } from "@healthapp/shared";
import { GOAL_METRIC_SPEC } from "@healthapp/shared";
import type { clientAppMessages } from "@healthapp/i18n/messages/client-app";
import type { ProgressReport } from "./report-model";

export type ReportStrings = (typeof clientAppMessages)["en"]["reports"];

export type PdfFonts = { regular: Uint8Array; bold: Uint8Array };

export type PdfContext = {
  strings: ReportStrings;
  /** Goal metric and circumference names, from the Goals strings. */
  goalMetricLabels: Record<GoalMetric, string>;
  measureKeyLabels: Record<string, string>;
  perWeekLabel: string;
  locale: "ro" | "en";
  /** Who the report is for — the display name, never the e-mail. */
  owner: string;
  /** When it was generated (an instant), shown in the person's time zone. */
  generatedAt: Date;
  units: { weight: WeightUnit; length: LengthUnit };
  fonts: PdfFonts;
};

/** A failure to produce the file (fonts missing, a drawing error) — the route answers it with a clear message. */
export class ReportRenderError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "ReportRenderError";
  }
}

// ---------- geometry and colour ----------

const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;
const MARGIN = 42;
const CONTENT_W = PAGE_W - 2 * MARGIN;
const FOOTER_H = 26;
const BOTTOM = MARGIN + FOOTER_H;

const INK = rgb(0.11, 0.11, 0.12);
const SOFT = rgb(0.35, 0.35, 0.38);
const FAINT = rgb(0.55, 0.55, 0.58);
const LINE = rgb(0.85, 0.85, 0.87);
const ZEBRA = rgb(0.965, 0.965, 0.97);
const ACCENT = rgb(0.72, 0.55, 0.13); // Voinic gold, darkened for print contrast
const ACCENT_SOFT = rgb(0.98, 0.95, 0.86);

const LB_PER_KG = 2.2046226218487757;
const CM_PER_IN = 2.54;

// ---------- formatting ----------

function formatters(ctx: PdfContext) {
  const tag = ctx.locale === "ro" ? "ro-RO" : "en-GB";
  const n0 = new Intl.NumberFormat(tag, { maximumFractionDigits: 0 });
  const n1 = new Intl.NumberFormat(tag, { maximumFractionDigits: 1 });
  const day = new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const shortDay = new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", timeZone: "UTC" });
  /** A local yyyy-mm-dd, formatted without letting any time zone move it. */
  const d = (iso: string) => {
    const [y = 1970, m = 1, dd = 1] = iso.slice(0, 10).split("-").map(Number);
    return day.format(new Date(Date.UTC(y, m - 1, dd)));
  };
  const sd = (iso: string) => {
    const [y = 1970, m = 1, dd = 1] = iso.slice(0, 10).split("-").map(Number);
    return shortDay.format(new Date(Date.UTC(y, m - 1, dd)));
  };
  const w = (kg: number) => n1.format(ctx.units.weight === "kg" ? kg : kg * LB_PER_KG);
  const wBig = (kg: number) => n0.format(ctx.units.weight === "kg" ? kg : kg * LB_PER_KG);
  const len = (cm: number) => n1.format(ctx.units.length === "cm" ? cm : cm / CM_PER_IN);
  const pct = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${n1.format(Math.abs(v))}%`;
  const signedW = (kg: number) => `${kg > 0 ? "+" : kg < 0 ? "−" : ""}${w(Math.abs(kg))}`;
  const signedLen = (cm: number) => `${cm > 0 ? "+" : cm < 0 ? "−" : ""}${len(Math.abs(cm))}`;
  return { n0, n1, d, sd, w, wBig, len, pct, signedW, signedLen };
}

/** Fill {placeholders}; a missing one stays visible rather than vanishing. */
function fillIn(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
}

/** Control characters and runs of whitespace collapse to one space: a note typed with line breaks stays one cell. */
function clean(text: string | null | undefined): string {
  return (text ?? "").replace(/[\u0000-\u001f\u007f\s]+/g, " ").trim();
}

// ---------- the page engine ----------

type Align = "left" | "right";
type Column = { label: string; width: number; align?: Align };

class Layout {
  pages: PDFPage[] = [];
  page!: PDFPage;
  y = 0;

  constructor(readonly doc: PDFDocument, readonly regular: PDFFont, readonly bold: PDFFont) {
    this.newPage();
  }

  newPage() {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.pages.push(this.page);
    this.y = PAGE_H - MARGIN;
  }

  /** Room for `h` points below the cursor, else a new page. */
  ensure(h: number): boolean {
    if (this.y - h < BOTTOM) {
      this.newPage();
      return true;
    }
    return false;
  }

  wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
    const words = clean(text).split(" ").filter(Boolean);
    if (words.length === 0) return [""];
    const lines: string[] = [];
    let line = "";
    const fits = (t: string) => font.widthOfTextAtSize(t, size) <= maxWidth;
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (fits(candidate)) { line = candidate; continue; }
      if (line) lines.push(line);
      if (fits(word)) { line = word; continue; }
      // a single word wider than the column is broken by characters, never clipped
      let part = "";
      for (const ch of word) {
        if (fits(part + ch)) part += ch;
        else { lines.push(part); part = ch; }
      }
      line = part;
    }
    if (line) lines.push(line);
    return lines;
  }

  text(text: string, opts: { size?: number; bold?: boolean; color?: RGB; indent?: number; width?: number; gapAfter?: number } = {}) {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.bold : this.regular;
    const lineH = size * 1.35;
    const width = opts.width ?? CONTENT_W - (opts.indent ?? 0);
    for (const line of this.wrap(text, font, size, width)) {
      this.ensure(lineH);
      this.page.drawText(line, { x: MARGIN + (opts.indent ?? 0), y: this.y - size, size, font, color: opts.color ?? INK });
      this.y -= lineH;
    }
    this.y -= opts.gapAfter ?? 0;
  }

  heading(text: string) {
    // a heading never sits alone at the foot of a page: keep room for it and a couple of lines
    this.ensure(70);
    this.y -= 8;
    this.page.drawText(clean(text), { x: MARGIN, y: this.y - 15, size: 15, font: this.bold, color: INK });
    this.y -= 21;
    this.page.drawRectangle({ x: MARGIN, y: this.y, width: 36, height: 2.2, color: ACCENT });
    this.y -= 10;
  }

  subheading(text: string) {
    this.ensure(48);
    this.y -= 4;
    this.text(text, { size: 11, bold: true, gapAfter: 3 });
  }

  /** Figures in tiles, three per row; each tile is measured, a row moves whole. */
  tiles(items: { label: string; value: string; note?: string }[]) {
    const cols = 3;
    const gap = 8;
    const w = (CONTENT_W - gap * (cols - 1)) / cols;
    for (let i = 0; i < items.length; i += cols) {
      const row = items.slice(i, i + cols);
      const heights = row.map((it) => {
        const labelLines = this.wrap(it.label, this.regular, 8, w - 16).length;
        const valueLines = this.wrap(it.value, this.bold, 14, w - 16).length;
        const noteLines = it.note ? this.wrap(it.note, this.regular, 7.5, w - 16).length : 0;
        return 12 + labelLines * 10.5 + valueLines * 17 + noteLines * 10 + 8;
      });
      const h = Math.max(...heights);
      this.ensure(h + gap);
      row.forEach((it, j) => {
        const x = MARGIN + j * (w + gap);
        this.page.drawRectangle({ x, y: this.y - h, width: w, height: h, color: ACCENT_SOFT });
        let y = this.y - 10;
        for (const l of this.wrap(it.label, this.regular, 8, w - 16)) { this.page.drawText(l, { x: x + 8, y: y - 8, size: 8, font: this.regular, color: SOFT }); y -= 10.5; }
        y -= 2;
        for (const l of this.wrap(it.value, this.bold, 14, w - 16)) { this.page.drawText(l, { x: x + 8, y: y - 14, size: 14, font: this.bold, color: INK }); y -= 17; }
        if (it.note) for (const l of this.wrap(it.note, this.regular, 7.5, w - 16)) { this.page.drawText(l, { x: x + 8, y: y - 7.5, size: 7.5, font: this.regular, color: FAINT }); y -= 10; }
      });
      this.y -= h + gap;
    }
  }

  /** A table whose rows never split; the header repeats on every page it continues onto. */
  table(columns: Column[], rows: string[][], continuedLabel: string) {
    const size = 8.5;
    const lineH = size * 1.3;
    const pad = 4;
    const total = columns.reduce((s, c) => s + c.width, 0);
    const widths = columns.map((c) => (c.width / total) * CONTENT_W);
    // A header word wider than its column is set smaller (down to 6.5 pt) rather
    // than broken mid-word: "Încărcare" stays one word in a narrow column.
    const headerSizes = columns.map((c, j) => {
      const longest = clean(c.label).split(" ").reduce((m, word) => Math.max(m, this.bold.widthOfTextAtSize(word, size)), 0);
      const room = widths[j]! - 2 * pad;
      return longest <= room ? size : Math.max(6.5, (size * room) / longest);
    });
    const cellLines = (cells: string[], font: PDFFont, sizes?: number[]) =>
      cells.map((c, j) => this.wrap(c, font, sizes?.[j] ?? size, widths[j]! - 2 * pad));
    const drawRow = (lines: string[][], font: PDFFont, fill: RGB | null, color: RGB, sizes?: number[]) => {
      const h = Math.max(...lines.map((l) => l.length)) * lineH + 2 * pad;
      if (fill) this.page.drawRectangle({ x: MARGIN, y: this.y - h, width: CONTENT_W, height: h, color: fill });
      let x = MARGIN;
      lines.forEach((cell, j) => {
        const col = columns[j]!;
        const sz = sizes?.[j] ?? size;
        cell.forEach((line, k) => {
          const tw = font.widthOfTextAtSize(line, sz);
          const tx = col.align === "right" ? x + widths[j]! - pad - tw : x + pad;
          this.page.drawText(line, { x: tx, y: this.y - pad - sz - k * lineH + 1.5, size: sz, font, color });
        });
        x += widths[j]!;
      });
      this.y -= h;
      return h;
    };
    const header = cellLines(columns.map((c) => c.label), this.bold, headerSizes);
    const headerH = Math.max(...header.map((l) => l.length)) * lineH + 2 * pad;
    const drawHeader = (continued: boolean) => {
      if (continued) this.text(continuedLabel, { size: 7.5, color: FAINT });
      drawRow(header, this.bold, null, SOFT, headerSizes);
      this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: MARGIN + CONTENT_W, y: this.y }, thickness: 0.6, color: LINE });
    };
    this.ensure(headerH + lineH + 2 * pad + 4);
    drawHeader(false);
    rows.forEach((row, i) => {
      const lines = cellLines(row, this.regular);
      const h = Math.max(...lines.map((l) => l.length)) * lineH + 2 * pad;
      if (this.ensure(h)) drawHeader(true);
      drawRow(lines, this.regular, i % 2 === 1 ? ZEBRA : null, INK);
    });
    this.y -= 8;
  }

  /** A line chart of real points (dates on x by their real spacing). Only drawn with two points or more. */
  lineChart(title: string, points: { day: string; value: number }[], format: (v: number) => string, dayLabel: (d: string) => string) {
    if (points.length < 2) return;
    const h = 130;
    this.ensure(h + 30);
    this.text(title, { size: 9.5, bold: true, gapAfter: 2 });
    const top = this.y;
    const left = MARGIN + 40;
    const width = CONTENT_W - 50;
    const plotH = h - 28;
    const t = points.map((p) => Date.parse(`${p.day}T00:00:00Z`));
    const tMin = Math.min(...t);
    const tMax = Math.max(...t);
    const vs = points.map((p) => p.value);
    let vMin = Math.min(...vs);
    let vMax = Math.max(...vs);
    if (vMax - vMin < 1e-9) { vMin -= 1; vMax += 1; }
    const padV = (vMax - vMin) * 0.12;
    vMin -= padV; vMax += padV;
    const xOf = (ti: number) => left + (tMax === tMin ? width / 2 : ((ti - tMin) / (tMax - tMin)) * width);
    const yOf = (v: number) => top - 6 - (1 - (v - vMin) / (vMax - vMin)) * plotH;
    for (const v of [vMin + padV, (vMin + vMax) / 2, vMax - padV]) {
      const y = yOf(v);
      this.page.drawLine({ start: { x: left, y }, end: { x: left + width, y }, thickness: 0.4, color: LINE });
      const label = format(v);
      this.page.drawText(label, { x: left - 6 - this.regular.widthOfTextAtSize(label, 7), y: y - 2.5, size: 7, font: this.regular, color: FAINT });
    }
    for (let i = 1; i < points.length; i++) {
      this.page.drawLine({ start: { x: xOf(t[i - 1]!), y: yOf(vs[i - 1]!) }, end: { x: xOf(t[i]!), y: yOf(vs[i]!) }, thickness: 1.4, color: ACCENT });
    }
    for (let i = 0; i < points.length; i++) this.page.drawCircle({ x: xOf(t[i]!), y: yOf(vs[i]!), size: 1.8, color: ACCENT });
    const firstLabel = dayLabel(points[0]!.day);
    const lastLabel = dayLabel(points.at(-1)!.day);
    const baseY = top - 6 - plotH - 12;
    this.page.drawText(firstLabel, { x: left, y: baseY, size: 7, font: this.regular, color: FAINT });
    this.page.drawText(lastLabel, { x: left + width - this.regular.widthOfTextAtSize(lastLabel, 7), y: baseY, size: 7, font: this.regular, color: FAINT });
    this.y = baseY - 10;
  }

  /** Bars per bucket — empty buckets kept, as the app's own chart does. */
  barChart(title: string, items: { label: string; value: number }[]) {
    if (items.length === 0 || items.every((i) => i.value === 0)) return;
    const h = 120;
    this.ensure(h + 30);
    this.text(title, { size: 9.5, bold: true, gapAfter: 2 });
    const top = this.y;
    const plotH = h - 34;
    const max = Math.max(...items.map((i) => i.value));
    const slot = CONTENT_W / items.length;
    const barW = Math.max(2, Math.min(28, slot * 0.6));
    items.forEach((it, i) => {
      const bh = max === 0 ? 0 : (it.value / max) * plotH;
      const x = MARGIN + i * slot + (slot - barW) / 2;
      if (bh > 0) this.page.drawRectangle({ x, y: top - 8 - plotH, width: barW, height: bh, color: ACCENT });
      if (items.length <= 16 && it.value > 0) {
        const v = String(it.value);
        this.page.drawText(v, { x: x + barW / 2 - this.regular.widthOfTextAtSize(v, 7) / 2, y: top - 8 - plotH + bh + 2, size: 7, font: this.regular, color: SOFT });
      }
    });
    this.page.drawLine({ start: { x: MARGIN, y: top - 8 - plotH }, end: { x: MARGIN + CONTENT_W, y: top - 8 - plotH }, thickness: 0.5, color: LINE });
    const first = items[0]!.label;
    const last = items.at(-1)!.label;
    const baseY = top - 8 - plotH - 12;
    this.page.drawText(first, { x: MARGIN, y: baseY, size: 7, font: this.regular, color: FAINT });
    this.page.drawText(last, { x: MARGIN + CONTENT_W - this.regular.widthOfTextAtSize(last, 7), y: baseY, size: 7, font: this.regular, color: FAINT });
    this.y = baseY - 10;
  }
}

// ---------- the document ----------

export async function renderReportPdf(report: ProgressReport, ctx: PdfContext): Promise<Uint8Array> {
  if (!ctx.fonts?.regular?.length || !ctx.fonts?.bold?.length) throw new ReportRenderError("report fonts are missing");
  try {
    return await render(report, ctx);
  } catch (e) {
    if (e instanceof ReportRenderError) throw e;
    throw new ReportRenderError(`could not render the report: ${e instanceof Error ? e.message : String(e)}`, e);
  }
}

async function render(report: ProgressReport, ctx: PdfContext): Promise<Uint8Array> {
  const s = ctx.strings.pdf;
  const f = formatters(ctx);
  const wu = ctx.units.weight;
  const lu = ctx.units.length;

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(ctx.fonts.regular, { subset: true });
  const bold = await doc.embedFont(ctx.fonts.bold, { subset: true });
  const periodText = `${f.d(report.period.from)} – ${f.d(report.period.to)}`;
  doc.setTitle(`${s.title} · ${periodText}`);
  doc.setCreator("Voinic");
  doc.setProducer("Voinic");
  doc.setLanguage(ctx.locale === "ro" ? "ro-RO" : "en-GB");
  doc.setCreationDate(ctx.generatedAt);

  const L = new Layout(doc, regular, bold);
  const generated = new Intl.DateTimeFormat(ctx.locale === "ro" ? "ro-RO" : "en-GB", {
    dateStyle: "long", timeStyle: "short", timeZone: report.timeZone,
  }).format(ctx.generatedAt);

  // ---- title block ----
  L.page.drawRectangle({ x: 0, y: PAGE_H - 8, width: PAGE_W, height: 8, color: ACCENT });
  L.y -= 6;
  L.text("VOINIC", { size: 9, bold: true, color: ACCENT, gapAfter: 2 });
  L.text(s.title, { size: 22, bold: true, gapAfter: 6 });
  L.text(`${s.owner}: ${clean(ctx.owner)}`, { size: 10.5 });
  L.text(`${s.period}: ${periodText} (${report.period.days})`, { size: 10.5 });
  L.text(`${s.generated}: ${generated}`, { size: 10.5, gapAfter: 4 });
  L.text(`${fillIn(s.timezone, { zone: report.timeZone })} ${fillIn(s.units, { weight: wu, length: lu })}`, { size: 8.5, color: FAINT, gapAfter: 4 });
  if (report.truncated) L.text(s.truncated, { size: 8.5, color: SOFT, gapAfter: 4 });

  // ---- A. summary ----
  const tr = report.summary.training;
  const cur = tr.current;
  const chg = tr.changes;
  const vs = (c: { pct: number | null } | null | undefined) =>
    c && c.pct !== null ? `${f.pct(c.pct)} ${fillIn(s.vsPrevious, { days: report.period.days })}` : undefined;
  L.heading(s.summary);
  L.tiles([
    { label: s.workouts, value: f.n0.format(cur.workouts), note: vs(chg?.workouts) },
    { label: s.perWeek, value: f.n1.format(cur.workouts_per_week), note: vs(chg?.workouts_per_week) },
    { label: s.activeDays, value: f.n0.format(cur.active_days) },
    { label: `${s.volume} (${wu})`, value: cur.volume_kg > 0 ? f.wBig(cur.volume_kg) : "—", note: vs(chg?.volume_kg) },
    { label: s.sets, value: f.n0.format(cur.sets), note: vs(chg?.sets) },
    { label: s.prs, value: f.n0.format(cur.prs) },
    ...(cur.avg_load !== null ? [{ label: s.avgLoad, value: f.n0.format(cur.avg_load), note: vs(chg?.avg_load) }] : []),
  ]);
  if (!report.summary.hasPrevious) L.text(s.noPrevious, { size: 8.5, color: FAINT, gapAfter: 4 });

  // ---- goals ----
  L.subheading(s.goals);
  if (!report.goals.available) {
    L.text(report.goals.reason === "read_failed" ? s.readFailed : s.unavailable, { size: 9, color: FAINT });
  } else {
    const goalValue = (metric: GoalMetric, v: number) => {
      const unit = GOAL_METRIC_SPEC[metric].unit;
      return unit === "kg" ? `${f.w(v)} ${wu}` : unit === "cm" ? `${f.len(v)} ${lu}` : unit === "pct" ? `${f.n0.format(v)}%` : unit === "per_week" ? `${f.n1.format(v)} ${ctx.perWeekLabel}` : `${f.n0.format(v)} g`;
    };
    L.table(
      [
        { label: s.goals, width: 3 },
        { label: s.goalCurrent, width: 1.6, align: "right" },
        { label: s.goalTarget, width: 1.6, align: "right" },
        { label: s.goalProgress, width: 1.4, align: "right" },
      ],
      report.goals.active.map((g) => [
        [g.title, ctx.goalMetricLabels[g.metric], g.exercise_name, g.measure_key ? (ctx.measureKeyLabels[g.measure_key] ?? g.measure_key) : null].filter(Boolean).join(" · "),
        g.progress.current ? goalValue(g.metric, g.progress.current.value) : "—",
        goalValue(g.metric, g.target_value),
        g.progress.pct !== null ? `${g.progress.pct}%` : s.goalNoPct,
      ]),
      s.continued,
    );
    L.text(s.goalsAsOf, { size: 8, color: FAINT });
  }

  // ---- B. training ----
  L.heading(s.training);
  if (!report.training.available) {
    L.text(s.unavailable, { size: 9.5, color: FAINT });
  } else {
    const t = report.training;
    L.barChart(
      t.buckets.unit === "week" ? s.weeklyChart : s.monthlyChart,
      t.buckets.items.map((b) => ({ label: f.sd(b.start), value: b.workouts })),
    );
    L.subheading(s.sessionsTitle);
    if (t.sessionsOmitted > 0) L.text(fillIn(s.sessionsOmitted, { count: t.sessionsOmitted }), { size: 8, color: FAINT, gapAfter: 2 });
    L.table(
      [
        { label: s.date, width: 1.6 },
        { label: s.workout, width: 2.8 },
        { label: s.workingSets, width: 1.2, align: "right" },
        { label: `${s.volume} (${wu})`, width: 1.4, align: "right" },
        { label: s.duration, width: 1, align: "right" },
        { label: s.load, width: 0.9, align: "right" },
        { label: s.prs, width: 0.9, align: "right" },
      ],
      t.sessions.map((r) => [
        f.d(r.day), r.name ?? "—", f.n0.format(r.working_sets), r.volume_kg > 0 ? f.wBig(r.volume_kg) : "—",
        r.duration_min !== null ? f.n0.format(r.duration_min) : "—", f.n0.format(r.load), r.prs > 0 ? f.n0.format(r.prs) : "",
      ]),
      s.continued,
    );
    L.subheading(s.exercisesTitle);
    L.table(
      [
        { label: s.exercise, width: 2.5 },
        { label: s.sessions, width: 1.45, align: "right" },
        { label: s.workingSets, width: 1.1, align: "right" },
        { label: s.reps, width: 1.05, align: "right" },
        { label: `${s.topWeight} (${wu})`, width: 1.4, align: "right" },
        { label: `${s.best1rm} (${wu})`, width: 1.5, align: "right" },
        { label: s.change1rm, width: 1.2, align: "right" },
      ],
      t.exercises.map((e) => [
        e.name, f.n0.format(e.sessions), f.n0.format(e.working_sets), f.n0.format(e.reps),
        e.top_weight_kg > 0 ? f.w(e.top_weight_kg) : "—",
        e.best_1rm !== null ? f.w(e.best_1rm) : "—",
        e.one_rm_change_pct !== null ? f.pct(e.one_rm_change_pct) : "—",
      ]),
      s.continued,
    );
    L.subheading(s.prsTitle);
    if (t.prs.length === 0) L.text(s.noPrs, { size: 9, color: FAINT });
    else L.table(
      [
        { label: s.date, width: 1.5 },
        { label: s.exercise, width: 3.2 },
        { label: `${s.set} (${wu} × ${s.reps.toLowerCase()})`, width: 1.8, align: "right" },
        { label: `${s.best1rm} (${wu})`, width: 1.6, align: "right" },
      ],
      t.prs.map((p) => [f.d(p.day), p.exercise, `${f.w(p.weight_kg)} × ${p.reps}`, f.w(p.estimated_1rm)]),
      s.continued,
    );
    L.text(s.definitions, { size: 7.5, color: FAINT, gapAfter: 4 });
  }

  // ---- Fitness Score ----
  L.subheading(s.fitness);
  if (!report.fitness.available) {
    L.text(s.notEnough, { size: 9, color: FAINT });
  } else {
    const fs = report.fitness.score;
    L.text(fillIn(s.fitnessBody, {
      score: fs.score ?? 0, day: f.d(fs.period.end), workouts: fs.completedWorkouts, days: fs.activeWorkoutDays,
    }) + (fs.band ? ` (${s.fitnessBand[fs.band]})` : ""), { size: 9.5 });
  }

  // ---- C. body ----
  L.heading(s.body);
  if (!report.body.available) {
    L.text(s.unavailable, { size: 9.5, color: FAINT });
  } else {
    const b = report.body;
    L.lineChart(`${s.weightChart} (${wu})`, b.weightPoints, (v) => f.w(v), f.sd);
    if (b.comparison && b.comparison.deltas.length > 0) {
      L.subheading(`${s.startEnd}: ${f.d(b.comparison.from)} → ${f.d(b.comparison.to)}`);
      L.table(
        [
          { label: "", width: 2.4 },
          { label: s.from, width: 1.4, align: "right" },
          { label: s.toCol, width: 1.4, align: "right" },
          { label: s.changeCol, width: 1.4, align: "right" },
        ],
        b.comparison.deltas.map((dlt) => {
          const isW = dlt.key === "weight";
          const name = isW ? `${s.weight} (${wu})` : `${ctx.measureKeyLabels[dlt.key] ?? dlt.key} (${lu})`;
          return [name, isW ? f.w(dlt.from) : f.len(dlt.from), isW ? f.w(dlt.to) : f.len(dlt.to), isW ? f.signedW(dlt.change.delta) : f.signedLen(dlt.change.delta)];
        }),
        s.continued,
      );
      if (b.comparison.oneSided.length > 0) {
        L.text(fillIn(s.oneSided, { keys: b.comparison.oneSided.map((k) => (k === "weight" ? s.weight : ctx.measureKeyLabels[k] ?? k)).join(", ") }), { size: 8, color: FAINT, gapAfter: 3 });
      }
    }
    L.subheading(s.measurementsTitle);
    L.table(
      [
        { label: s.date, width: 1.6 },
        { label: `${s.weight} (${wu})`, width: 1.3, align: "right" },
        ...b.keys.map((k) => ({ label: `${ctx.measureKeyLabels[k] ?? k} (${lu})`, width: 1.2, align: "right" as const })),
      ],
      b.rows.map((r) => [
        f.d(r.day), r.weight_kg !== null ? f.w(r.weight_kg) : "—",
        ...b.keys.map((k) => (typeof r.circumferences[k] === "number" ? f.len(r.circumferences[k]!) : "—")),
      ]),
      s.continued,
    );
  }
  if (report.photos.count !== null) L.text(fillIn(s.photos, { count: report.photos.count }), { size: 8, color: FAINT, gapAfter: 3 });

  // ---- D. nutrition ----
  L.heading(s.nutrition);
  if (!report.nutrition.available) {
    L.text(s.unavailable, { size: 9.5, color: FAINT });
  } else {
    const n = report.nutrition;
    const c = n.current;
    L.tiles([
      { label: s.daysLogged, value: fillIn(s.daysLoggedValue, { logged: c.days_logged, tracked: c.tracked_days }) },
      ...(c.avg ? [{ label: `${s.avgPerDay} — ${s.kcal}`, value: `${f.n0.format(c.avg.kcal)} ${s.kcalUnit}` }] : []),
      ...(c.avg ? [{ label: `${s.avgPerDay} — ${s.protein}`, value: `${f.n0.format(c.avg.protein)} ${s.gUnit}` }] : []),
    ]);
    if (c.avg) {
      const keys = ["kcal", "protein", "carbs", "fat"] as const;
      const label = { kcal: s.kcal, protein: s.protein, carbs: s.carbs, fat: s.fat };
      const unit = (k: (typeof keys)[number]) => (k === "kcal" ? s.kcalUnit : s.gUnit);
      const hasTarget = n.target !== null && keys.some((k) => (n.target as Record<string, number>)[k] > 0);
      L.table(
        [
          { label: s.nutrientCol, width: 2 },
          { label: s.avgPerDay, width: 2, align: "right" },
          ...(hasTarget ? [{ label: s.target, width: 1.4, align: "right" as const }, { label: s.vsTarget, width: 1.2, align: "right" as const }] : []),
          ...(n.previous?.avg ? [{ label: fillIn(s.previousAvg, { days: report.period.days }), width: 2, align: "right" as const }] : []),
        ],
        keys.map((k) => {
          const avg = c.avg![k];
          const target = n.target ? n.target[k] : 0;
          const line = c.adherence?.[k];
          return [
            `${label[k]} (${unit(k)})`,
            f.n0.format(avg),
            ...(hasTarget ? [target > 0 ? f.n0.format(target) : "—", line && line.pct !== null ? `${f.n0.format(line.pct)}%` : "—"] : []),
            ...(n.previous?.avg ? [f.n0.format(n.previous.avg[k])] : []),
          ];
        }),
        s.continued,
      );
      L.text(hasTarget ? s.targetNote : s.noTarget, { size: 8, color: FAINT });
      L.text(s.unloggedNote, { size: 8, color: FAINT, gapAfter: 4 });
    }
    L.subheading(s.labelsTitle);
    if (n.labelsMissing === "failed") L.text(s.labelsFailed, { size: 8.5, color: FAINT });
    else if (n.labelsMissing === "incomplete") L.text(s.labelsIncomplete, { size: 8.5, color: FAINT });
    else if (n.labels.length === 0) L.text(s.labelsNone, { size: 8.5, color: FAINT });
    else L.table(
      [{ label: s.nutrientCol, width: 3 }, { label: s.avgPerDay, width: 2, align: "right" }],
      n.labels.map((l) => [s.labels[l.key as LabelNutrient], l.stats.avg_known !== null ? `${f.n1.format(l.stats.avg_known)} ${s.gUnit}` : "—"]),
      s.continued,
    );
  }

  // ---- footer on every page, now that the count is known ----
  const pages = L.pages.length;
  L.pages.forEach((p, i) => {
    const label = fillIn(s.page, { page: i + 1, pages });
    p.drawLine({ start: { x: MARGIN, y: MARGIN + 14 }, end: { x: PAGE_W - MARGIN, y: MARGIN + 14 }, thickness: 0.5, color: LINE });
    p.drawText(`Voinic · ${s.title} · ${periodText}`, { x: MARGIN, y: MARGIN, size: 7.5, font: regular, color: FAINT });
    p.drawText(label, { x: PAGE_W - MARGIN - regular.widthOfTextAtSize(label, 7.5), y: MARGIN, size: 7.5, font: regular, color: FAINT });
  });

  return doc.save();
}
