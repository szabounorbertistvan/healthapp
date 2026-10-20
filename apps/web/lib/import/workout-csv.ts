// Reading a Hevy or Strong CSV export into sessions of working sets.
//
// Pure and synchronous: it runs in the browser on the file the person picked
// (an export of years of training is megabytes — too big for a server action
// body) and in node under Vitest. Nothing here touches the database; the
// import page maps the exercise names and hands the result, a few sessions
// at a time, to importWorkoutChunk() (app/import-actions.ts).
//
// What comes out is stored metric: weights in kg (displayToKg from
// packages/shared, the one conversion the logger uses too), a timed set as
// reps 0 + durationSeconds (logged_sets.duration_seconds), and every set held
// to validateSetEdit() — the same rules and caps a logged or edited set
// meets, so an import cannot put a row in the table the app could not.
//
// Warm-ups are left out. The app marks a warm-up through the program's
// prescription (program_exercises.set_type, read by is_warmup_set() and
// totalVolume()); an imported set has no prescription, so a warm-up written
// as an ordinary set would count as working volume in every total, challenge
// and leaderboard. They are counted and reported instead.
import { displayToKg, validateSetEdit, type WeightUnit } from "@healthapp/shared";

export type ImportFormat = "hevy" | "strong";

export type ImportedSet = {
  /**
   * Position of the source row inside its workout, counting every row (warm-ups
   * and skipped rows included) — so it does not move when a row is left out,
   * and the derived set id stays the same on a re-import.
   */
  ordinal: number;
  /** The exercise name as the other app wrote it. */
  exercise: string;
  weightKg: number;
  /** 0 for a timed set. */
  reps: number;
  durationSeconds: number | null;
  rpe: number | null;
  notes: string | null;
};

export type ImportedSession = {
  /** `${startLocal}|${title}` — unique within one file. */
  key: string;
  title: string;
  /** Wall-clock start as the app wrote it, "YYYY-MM-DDTHH:mm", no zone. */
  startLocal: string;
  durationMinutes: number | null;
  notes: string | null;
  /** Working sets in file order. Never empty. */
  sets: ImportedSet[];
};

export type ImportSkips = {
  /** Warm-up sets, left out on purpose (see the header). */
  warmups: number;
  /** Distance-only rows (a run, a row) — nothing a set can hold. */
  cardio: number;
  /** Rows a logged set could not be: no reps and no time, over the caps, unreadable date. */
  invalid: number;
};

export type ParseOptions = {
  /**
   * The unit for a file that does not say (a Strong export without a
   * "Weight Unit" column is in whatever the person set in Strong).
   */
  weightUnit?: WeightUnit;
};

export type ParseResult =
  | {
      ok: true;
      format: ImportFormat;
      weightUnit: WeightUnit;
      /** False when the unit came from options, not the file — the page asks then. */
      unitFromFile: boolean;
      sessions: ImportedSession[];
      skipped: ImportSkips;
    }
  | { ok: false; error: "empty" | "unknownFormat" | "noSessions" };

/** Above this, the file is refused before parsing (the page says so). */
export const MAX_IMPORT_BYTES = 15 * 1024 * 1024;

// ---------- CSV ----------

/**
 * RFC 4180 rows: quoted fields with doubled quotes and line breaks inside,
 * CRLF or LF, a UTF-8 BOM. The delimiter is the header line's — Strong writes
 * semicolons in locales whose decimal mark is a comma.
 */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const delimiter = detectDelimiter(src);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

function detectDelimiter(src: string): string {
  let commas = 0;
  let semis = 0;
  let quoted = false;
  for (const c of src) {
    if (c === '"') quoted = !quoted;
    else if (!quoted && (c === "\n" || c === "\r")) break;
    else if (!quoted && c === ",") commas++;
    else if (!quoted && c === ";") semis++;
  }
  return semis > commas ? ";" : ",";
}

// ---------- format ----------

const norm = (h: string) => h.trim().toLowerCase();

/** Which app wrote these headers, or null. */
export function detectFormat(headers: readonly string[]): ImportFormat | null {
  const h = new Set(headers.map(norm));
  if (h.has("exercise_title") && h.has("start_time") && h.has("set_type")) return "hevy";
  if (h.has("exercise name") && h.has("date") && h.has("set order")) return "strong";
  return null;
}

// ---------- values ----------

/** A number as either app writes it; "1,5" too in a semicolon file. Blank → null. */
export function parseNumber(raw: string | undefined): number | null {
  const s = (raw ?? "").trim();
  if (s === "") return null;
  const n = Number(/^-?\d+,\d+$/.test(s) ? s.replace(",", ".") : s);
  return Number.isFinite(n) ? n : null;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * "26 Mar 2024, 18:32" (Hevy), "2024-03-26 18:32:00" (Strong), an ISO stamp
 * → "2024-03-26T18:32", the wall time the app showed. Null when unreadable.
 */
export function parseLocalDateTime(raw: string | undefined): string | null {
  const s = (raw ?? "").trim();
  let y: number, mo: number, d: number, h: number, mi: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})/.exec(s);
  const hevy = /^(\d{1,2})\s+([A-Za-z]{3,4})\.?\s+(\d{4}),?\s+(\d{1,2}):(\d{2})/.exec(s);
  if (iso) {
    [y, mo, d, h, mi] = iso.slice(1).map(Number) as [number, number, number, number, number];
  } else if (hevy) {
    const month = MONTHS[hevy[2]!.toLowerCase()];
    if (!month) return null;
    [d, y, h, mi] = [Number(hevy[1]), Number(hevy[3]), Number(hevy[4]), Number(hevy[5])];
    mo = month;
  } else return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  // Day 31 of a 30-day month and the like.
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCMonth() !== mo - 1) return null;
  return `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}`;
}

/** Strong's "1h 5m" / "45m" / "30s"; a bare number is seconds. Minutes, or null. */
export function parseDurationMinutes(raw: string | undefined): number | null {
  const s = (raw ?? "").trim().toLowerCase();
  if (s === "") return null;
  const bare = parseNumber(s);
  if (bare !== null) return bare > 0 ? Math.round(bare / 60) : null;
  const part = (unit: string) => Number(new RegExp(`(\\d+)\\s*${unit}`).exec(s)?.[1] ?? 0);
  const minutes = part("h") * 60 + part("m") + Math.round(part("s") / 60);
  return minutes > 0 ? minutes : null;
}

/** Minutes between two wall times, or null. */
function minutesBetween(start: string, end: string | null): number | null {
  if (!end) return null;
  const ms = Date.parse(`${end}:00Z`) - Date.parse(`${start}:00Z`);
  return ms > 0 && ms <= 24 * 60 * 60 * 1000 ? Math.round(ms / 60000) : null;
}

const text = (raw: string | undefined, max: number) => (raw ?? "").trim().slice(0, max) || null;

// ---------- rows → sessions ----------

/** One source row, already read in either format. */
type RawRow = {
  title: string;
  start: string | null;
  durationMinutes: number | null;
  sessionNotes: string | null;
  exercise: string;
  /** "warmup" / "set" / "skip" (Strong's rest-timer and note rows). */
  kind: "warmup" | "set" | "skip";
  weight: number | null;
  reps: number | null;
  seconds: number | null;
  distance: number | null;
  rpe: number | null;
  notes: string | null;
};

export function parseWorkoutCsv(input: string, options: ParseOptions = {}): ParseResult {
  const rows = parseCsv(input);
  if (rows.length === 0) return { ok: false, error: "empty" };
  const headers = rows[0]!.map(norm);
  const format = detectFormat(headers);
  if (!format) return { ok: false, error: "unknownFormat" };
  const col = (name: string) => headers.indexOf(name);
  const body = rows.slice(1);

  let weightUnit: WeightUnit;
  let unitFromFile: boolean;
  let read: (r: string[]) => RawRow;

  if (format === "hevy") {
    // Hevy names the weight column after the account's unit.
    const lbs = col("weight_lbs") >= 0 && col("weight_kg") < 0;
    weightUnit = lbs ? "lb" : "kg";
    unitFromFile = col("weight_lbs") >= 0 || col("weight_kg") >= 0;
    const at = {
      title: col("title"), start: col("start_time"), end: col("end_time"), description: col("description"),
      exercise: col("exercise_title"), notes: col("exercise_notes"), type: col("set_type"),
      weight: lbs ? col("weight_lbs") : col("weight_kg"), reps: col("reps"),
      distance: Math.max(col("distance_km"), col("distance_miles")), seconds: col("duration_seconds"), rpe: col("rpe"),
    };
    read = (r) => {
      const start = parseLocalDateTime(r[at.start]);
      return {
        title: (r[at.title] ?? "").trim(),
        start,
        durationMinutes: start ? minutesBetween(start, parseLocalDateTime(r[at.end])) : null,
        sessionNotes: text(r[at.description], 500),
        exercise: (r[at.exercise] ?? "").trim(),
        kind: norm(r[at.type] ?? "") === "warmup" ? "warmup" : "set",
        weight: parseNumber(r[at.weight]),
        reps: parseNumber(r[at.reps]),
        seconds: parseNumber(r[at.seconds]),
        distance: parseNumber(r[at.distance]),
        rpe: parseNumber(r[at.rpe]),
        notes: text(r[at.notes], 500),
      };
    };
  } else {
    // Older Strong exports carry a unit column per row; newer ones do not, and
    // the weights are in the unit the person chose in Strong.
    const unitCol = col("weight unit");
    const fileUnit = unitCol >= 0 ? body.map((r) => norm(r[unitCol] ?? "")).find((u) => u !== "") : undefined;
    unitFromFile = fileUnit !== undefined;
    weightUnit = fileUnit ? (fileUnit.startsWith("lb") ? "lb" : "kg") : (options.weightUnit ?? "kg");
    const at = {
      date: col("date"), title: col("workout name"), duration: Math.max(col("duration"), col("workout duration")),
      exercise: col("exercise name"), order: col("set order"), weight: col("weight"), reps: col("reps"),
      distance: col("distance"), seconds: col("seconds"), notes: col("notes"), workoutNotes: col("workout notes"), rpe: col("rpe"),
    };
    read = (r) => {
      const order = norm(r[at.order] ?? "");
      return {
        title: (r[at.title] ?? "").trim(),
        start: parseLocalDateTime(r[at.date]),
        durationMinutes: parseDurationMinutes(r[at.duration]),
        sessionNotes: text(r[at.workoutNotes], 500),
        exercise: (r[at.exercise] ?? "").trim(),
        // "1", "2"… a working set; "W" a warm-up; "D"/"F" drop and failure sets
        // are working sets; "Rest Timer" and "Note" rows are not sets at all.
        kind: order === "w" ? "warmup" : /^\d+$/.test(order) || order === "d" || order === "f" ? "set" : "skip",
        weight: parseNumber(r[at.weight]),
        reps: parseNumber(r[at.reps]),
        seconds: parseNumber(r[at.seconds]),
        distance: parseNumber(r[at.distance]),
        rpe: parseNumber(r[at.rpe]),
        notes: text(r[at.notes], 500),
      };
    };
  }

  const skipped: ImportSkips = { warmups: 0, cardio: 0, invalid: 0 };
  const sessions = new Map<string, ImportedSession & { rows: number }>();

  for (const r of body) {
    const row = read(r);
    if (row.kind === "skip") continue;
    if (!row.start || !row.exercise) {
      skipped.invalid++;
      continue;
    }
    const title = row.title || "Workout";
    const key = `${row.start}|${title}`;
    let session = sessions.get(key);
    if (!session) {
      session = { key, title, startLocal: row.start, durationMinutes: row.durationMinutes, notes: row.sessionNotes, sets: [], rows: 0 };
      sessions.set(key, session);
    }
    const ordinal = session.rows++;
    if (row.kind === "warmup") {
      skipped.warmups++;
      continue;
    }
    const set = toSet(row, ordinal, weightUnit);
    if (set === "cardio") skipped.cardio++;
    else if (set === null) skipped.invalid++;
    else {
      // Hevy repeats the exercise's note on every set row: keep it on the first.
      if (format === "hevy" && set.notes && session.sets.some((x) => x.exercise === set.exercise && x.notes === set.notes)) {
        set.notes = null;
      }
      session.sets.push(set);
    }
  }

  const out = [...sessions.values()]
    .filter((s) => s.sets.length > 0)
    .map(({ rows: _rows, ...s }) => s)
    .sort((a, b) => a.startLocal.localeCompare(b.startLocal) || a.title.localeCompare(b.title));
  if (out.length === 0) return { ok: false, error: "noSessions" };
  return { ok: true, format, weightUnit, unitFromFile, sessions: out, skipped };
}

/** One working row → a set the app can store, "cardio", or null (unusable). */
function toSet(row: RawRow, ordinal: number, unit: WeightUnit): ImportedSet | "cardio" | null {
  const reps = row.reps !== null && row.reps > 0 ? row.reps : 0;
  const seconds = row.seconds !== null && row.seconds > 0 ? Math.round(row.seconds) : 0;
  if (reps === 0 && seconds === 0) return row.distance !== null && row.distance > 0 ? "cardio" : null;
  // Kilograms with the two decimals logged_sets.weight_kg keeps. A negative
  // load (an assisted lift in some exports) is stored as bodyweight.
  const weightKg = Math.round(displayToKg(Math.max(0, row.weight ?? 0), unit) * 100) / 100;
  // A set with reps is a rep set even when a time came with it (a tempo set);
  // only a set with no reps is timed, as the logger stores a hold.
  const durationSeconds = reps > 0 ? null : seconds;
  const rpe = row.rpe !== null && row.rpe >= 1 && row.rpe <= 10 ? row.rpe : null;
  const set = { weight_kg: weightKg, reps, rpe, rir: null, notes: row.notes, duration_seconds: durationSeconds };
  if (validateSetEdit(set)) return null;
  return { ordinal, exercise: row.exercise, weightKg, reps, durationSeconds, rpe, notes: row.notes };
}

/** The distinct exercise names of a parse, most-used first — what the review step maps. */
export function exerciseNames(sessions: readonly ImportedSession[]): { name: string; sets: number }[] {
  const counts = new Map<string, number>();
  for (const s of sessions) for (const set of s.sets) counts.set(set.exercise, (counts.get(set.exercise) ?? 0) + 1);
  return [...counts].map(([name, sets]) => ({ name, sets })).sort((a, b) => b.sets - a.sets || a.name.localeCompare(b.name));
}
