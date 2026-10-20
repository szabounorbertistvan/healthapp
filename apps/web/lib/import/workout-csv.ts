// Reading a workout export into sessions of working sets: Hevy, Strong,
// Fitbod, FitNotes, and Voinic's own template for a spreadsheet kept by hand
// (public/import/ — the people this app replaces Excel for).
//
// Pure and synchronous: it runs in the browser on the file the person picked
// (an export of years of training is megabytes — too big for a server action
// body) and in node under Vitest. Nothing here touches the database; the
// import page maps the exercise names and hands the result, a few sessions
// at a time, to importWorkoutChunk() (app/import-actions.ts).
//
// Each format is one reader that turns a row into a RawRow; grouping into
// workouts, validation and units are shared below it. Hevy and Strong were
// checked against real exports' layout; the Fitbod and FitNotes readers follow
// their documented export columns and match headers loosely — verify them
// against a real file when one turns up (docs/GAPS.md).
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

export type ImportFormat = "hevy" | "strong" | "fitbod" | "fitnotes" | "voinic";

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
  /**
   * The person's zone, for a file that stamps instants rather than wall
   * times (Fitbod writes "+0000"). Defaults to the app's.
   */
  timeZone?: string;
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

/** When a file has dates but no times: midday, so no zone shift moves the day. */
const NO_TIME = "12:00";

// ---------- CSV ----------

/**
 * RFC 4180 rows: quoted fields with doubled quotes and line breaks inside,
 * CRLF or LF, a UTF-8 BOM. The delimiter is the header line's — Strong and a
 * Romanian Excel write semicolons where the decimal mark is a comma.
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
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  for (const c of src) {
    if (c === '"') quoted = !quoted;
    else if (!quoted && (c === "\n" || c === "\r")) break;
    else if (!quoted && c in counts) counts[c]!++;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]![0];
}

// ---------- format ----------

/** A header as compared: lower case, no accents, no spaces around it. */
const norm = (h: string) => h.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

/**
 * The template's columns, in English or Romanian (public/import/), each to
 * one name. A spreadsheet kept by hand may say "kg" for the weight column or
 * "repetari" for reps; all of those land here.
 */
const TEMPLATE_COLUMNS: Record<string, string> = {
  date: "date", data: "date", day: "date", zi: "date", ziua: "date",
  time: "time", ora: "time",
  workout: "workout", antrenament: "workout", session: "workout",
  exercise: "exercise", exercitiu: "exercise", exercitiul: "exercise",
  weight: "weight", greutate: "weight", kg: "weight", greutate_kg: "weight",
  unit: "unit", unitate: "unit",
  reps: "reps", repetari: "reps", repetitii: "reps", rep: "reps",
  seconds: "seconds", secunde: "seconds", sec: "seconds", time_s: "seconds",
  rpe: "rpe",
  warmup: "warmup", "warm-up": "warmup", incalzire: "warmup",
  notes: "notes", note: "notes", notite: "notes", comentariu: "notes",
  duration: "duration", durata: "duration",
};

/** Which app wrote these headers, or null. */
export function detectFormat(headers: readonly string[]): ImportFormat | null {
  const h = new Set(headers.map(norm));
  const has = (re: RegExp) => [...h].some((x) => re.test(x));
  if (h.has("exercise_title") && h.has("start_time") && h.has("set_type")) return "hevy";
  if (h.has("exercise name") && h.has("date") && h.has("set order")) return "strong";
  if (h.has("exercise") && h.has("iswarmup") && has(/^weight\s*\((kg|lbs?)\)$/)) return "fitbod";
  if (h.has("exercise") && h.has("category") && has(/^weight\s*\((kgs?|lbs?)\)$/)) return "fitnotes";
  const template = new Set([...h].map((x) => TEMPLATE_COLUMNS[x]));
  if (template.has("date") && template.has("exercise") && (template.has("reps") || template.has("seconds"))) return "voinic";
  return null;
}

// ---------- values ----------

/** A number as the apps and spreadsheets write it; "1,5" too. Blank → null. */
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

function wallTime(y: number, mo: number, d: number, h: number, mi: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  // Day 31 of a 30-day month and the like.
  if (new Date(Date.UTC(y, mo - 1, d)).getUTCMonth() !== mo - 1) return null;
  return `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}`;
}

/**
 * A date and time as written → "2024-03-26T18:32", the wall time the app
 * showed. Reads "26 Mar 2024, 18:32" (Hevy), "2024-03-26 18:32:00" (Strong),
 * an ISO stamp, and the spreadsheet forms "26.03.2024", "26/03/2024 18:32"
 * (day first, unless the second number cannot be a month). A date alone
 * takes `fallbackTime`; without one it is unreadable. Null when unreadable.
 */
export function parseLocalDateTime(raw: string | undefined, fallbackTime?: string): string | null {
  const s = (raw ?? "").trim();
  const time = (h?: string, m?: string) => {
    if (h !== undefined) return [Number(h), Number(m)] as const;
    if (!fallbackTime) return null;
    const [fh, fm] = fallbackTime.split(":").map(Number);
    return [fh ?? 12, fm ?? 0] as const;
  };
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/.exec(s);
  if (iso) {
    const t = time(iso[4], iso[5]);
    return t ? wallTime(Number(iso[1]), Number(iso[2]), Number(iso[3]), t[0], t[1]) : null;
  }
  const hevy = /^(\d{1,2})\s+([A-Za-z]{3,4})\.?\s+(\d{4}),?\s+(\d{1,2}):(\d{2})/.exec(s);
  if (hevy) {
    const month = MONTHS[hevy[2]!.toLowerCase()];
    return month ? wallTime(Number(hevy[3]), month, Number(hevy[1]), Number(hevy[4]), Number(hevy[5])) : null;
  }
  const sheet = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:,?\s+(\d{1,2}):(\d{2}))?/.exec(s);
  if (sheet) {
    let [d, mo] = [Number(sheet[1]), Number(sheet[2])];
    if (mo > 12 && d <= 12) [d, mo] = [mo, d];
    const t = time(sheet[4], sheet[5]);
    return t ? wallTime(Number(sheet[3]), mo, d, t[0], t[1]) : null;
  }
  return null;
}

/**
 * An instant with a zone ("2021-03-07 15:20:33 +0000", "…Z") → the wall time
 * it was in `timeZone`. Null when the text carries no zone or is unreadable.
 */
export function instantToLocal(raw: string | undefined, timeZone: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)\s*(Z|[+-]\d{2}:?\d{2})$/.exec((raw ?? "").trim());
  if (!m) return null;
  const zone = m[3] === "Z" ? "Z" : m[3]!.replace(/^([+-]\d{2})(\d{2})$/, "$1:$2");
  const at = new Date(`${m[1]}T${m[2]!.length === 5 ? `${m[2]}:00` : m[2]}${zone}`);
  if (Number.isNaN(at.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(at);
  const get = (k: string) => parts.find((p) => p.type === k)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
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

/** A clock duration "0:01:30" / "1:30" / "90" → seconds, or null. */
export function parseClockSeconds(raw: string | undefined): number | null {
  const s = (raw ?? "").trim();
  if (s === "") return null;
  if (!s.includes(":")) return parseNumber(s);
  const parts = s.split(":").map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

/** Minutes between two wall times, or null. */
function minutesBetween(start: string, end: string | null): number | null {
  if (!end) return null;
  const ms = Date.parse(`${end}:00Z`) - Date.parse(`${start}:00Z`);
  return ms > 0 && ms <= 24 * 60 * 60 * 1000 ? Math.round(ms / 60000) : null;
}

const text = (raw: string | undefined, max: number) => (raw ?? "").trim().slice(0, max) || null;
const truthy = (raw: string | undefined) => /^(1|true|yes|y|da|x|w)$/i.test((raw ?? "").trim());
const unitOf = (raw: string | undefined): WeightUnit | null => {
  const u = norm(raw ?? "");
  return u.startsWith("lb") ? "lb" : u.startsWith("kg") ? "kg" : null;
};

// ---------- rows → sessions ----------

/** One source row, already read in whichever format. */
type RawRow = {
  /** Rows with the same group are one workout. */
  group: string;
  title: string;
  start: string | null;
  /** Fitbod: each set's own time, which the workout's start and length come from. */
  setTime?: string | null;
  durationMinutes: number | null;
  sessionNotes: string | null;
  exercise: string;
  /** "warmup" / "set" / "skip" (Strong's rest-timer and note rows). */
  kind: "warmup" | "set" | "skip";
  weight: number | null;
  /** The row's own unit, when the file gives one per row. */
  unit?: WeightUnit | null;
  reps: number | null;
  seconds: number | null;
  distance: number | null;
  rpe: number | null;
  notes: string | null;
};

type Reader = { weightUnit: WeightUnit; unitFromFile: boolean; read: (r: string[]) => RawRow; byTime?: boolean };

function readerFor(format: ImportFormat, headers: string[], body: string[][], options: ParseOptions): Reader {
  const col = (name: string) => headers.indexOf(name);
  const colMatching = (re: RegExp) => headers.findIndex((h) => re.test(h));

  if (format === "hevy") {
    // Hevy names the weight column after the account's unit.
    const lbs = col("weight_lbs") >= 0 && col("weight_kg") < 0;
    const at = {
      title: col("title"), start: col("start_time"), end: col("end_time"), description: col("description"),
      exercise: col("exercise_title"), notes: col("exercise_notes"), type: col("set_type"),
      weight: lbs ? col("weight_lbs") : col("weight_kg"), reps: col("reps"),
      distance: Math.max(col("distance_km"), col("distance_miles")), seconds: col("duration_seconds"), rpe: col("rpe"),
    };
    return {
      weightUnit: lbs ? "lb" : "kg",
      unitFromFile: col("weight_lbs") >= 0 || col("weight_kg") >= 0,
      read: (r) => {
        const start = parseLocalDateTime(r[at.start]);
        const title = (r[at.title] ?? "").trim();
        return {
          group: `${start}|${title}`,
          title,
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
      },
    };
  }

  if (format === "strong") {
    // Older Strong exports carry a unit column per row; newer ones do not, and
    // the weights are in the unit the person chose in Strong.
    const unitCol = col("weight unit");
    const fileUnit = unitCol >= 0 ? body.map((r) => unitOf(r[unitCol])).find((u) => u !== null) : undefined;
    const at = {
      date: col("date"), title: col("workout name"), duration: Math.max(col("duration"), col("workout duration")),
      exercise: col("exercise name"), order: col("set order"), weight: col("weight"), reps: col("reps"),
      distance: col("distance"), seconds: col("seconds"), notes: col("notes"), workoutNotes: col("workout notes"), rpe: col("rpe"),
    };
    return {
      weightUnit: fileUnit ?? options.weightUnit ?? "kg",
      unitFromFile: !!fileUnit,
      read: (r) => {
        const order = norm(r[at.order] ?? "");
        const start = parseLocalDateTime(r[at.date]);
        const title = (r[at.title] ?? "").trim();
        return {
          group: `${start}|${title}`,
          title,
          start,
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
      },
    };
  }

  if (format === "fitbod") {
    // One row per set, each stamped with its own instant in UTC; a workout is
    // the sets of one local day, from the first set to the last.
    const weightCol = colMatching(/^weight\s*\((kg|lbs?)\)$/);
    const lbs = /lb/.test(headers[weightCol] ?? "");
    const timeZone = options.timeZone ?? "Europe/Bucharest";
    const at = {
      date: col("date"), exercise: col("exercise"), reps: col("reps"), weight: weightCol,
      seconds: colMatching(/^duration\s*\(s\)$/), distance: colMatching(/^distance\s*\(/), warmup: col("iswarmup"), notes: col("note"),
    };
    return {
      weightUnit: lbs ? "lb" : "kg",
      unitFromFile: true,
      byTime: true,
      read: (r) => {
        const when = instantToLocal(r[at.date], timeZone) ?? parseLocalDateTime(r[at.date], NO_TIME);
        return {
          group: when?.slice(0, 10) ?? "",
          title: "Fitbod",
          start: when,
          setTime: when,
          durationMinutes: null,
          sessionNotes: null,
          exercise: (r[at.exercise] ?? "").trim(),
          kind: truthy(r[at.warmup]) ? "warmup" : "set",
          weight: parseNumber(r[at.weight]),
          reps: parseNumber(r[at.reps]),
          seconds: parseNumber(r[at.seconds]),
          distance: parseNumber(r[at.distance]),
          rpe: null,
          notes: text(r[at.notes], 500),
        };
      },
    };
  }

  if (format === "fitnotes") {
    // Dates without times, one workout a day; the unit is in the weight
    // column's name, "Weight (kgs)" or "Weight (lbs)".
    const weightCol = colMatching(/^weight\s*\((kgs?|lbs?)\)$/);
    const lbs = /lb/.test(headers[weightCol] ?? "");
    const at = {
      date: col("date"), exercise: col("exercise"), weight: weightCol, reps: col("reps"),
      distance: col("distance"), seconds: col("time"), notes: col("comment"),
    };
    return {
      weightUnit: lbs ? "lb" : "kg",
      unitFromFile: weightCol >= 0,
      read: (r) => {
        const start = parseLocalDateTime(r[at.date], NO_TIME);
        return {
          group: start ?? "",
          title: "FitNotes",
          start,
          durationMinutes: null,
          sessionNotes: null,
          exercise: (r[at.exercise] ?? "").trim(),
          kind: "set",
          weight: parseNumber(r[at.weight]),
          reps: parseNumber(r[at.reps]),
          seconds: parseClockSeconds(r[at.seconds]),
          distance: parseNumber(r[at.distance]),
          rpe: null,
          notes: text(r[at.notes], 500),
        };
      },
    };
  }

  // The Voinic template: one row per set, English or Romanian column names.
  const named = (name: string) => headers.findIndex((h) => TEMPLATE_COLUMNS[h] === name);
  const at = {
    date: named("date"), time: named("time"), workout: named("workout"), exercise: named("exercise"),
    weight: named("weight"), unit: named("unit"), reps: named("reps"), seconds: named("seconds"),
    rpe: named("rpe"), warmup: named("warmup"), notes: named("notes"), duration: named("duration"),
  };
  const fileUnit = at.unit >= 0 ? body.map((r) => unitOf(r[at.unit])).find((u) => u !== null) : undefined;
  return {
    weightUnit: fileUnit ?? options.weightUnit ?? "kg",
    unitFromFile: !!fileUnit,
    read: (r) => {
      const time = /^\d{1,2}:\d{2}/.exec((r[at.time] ?? "").trim())?.[0];
      const start = parseLocalDateTime(time ? `${(r[at.date] ?? "").trim()} ${time}` : r[at.date], NO_TIME);
      const title = (r[at.workout] ?? "").trim();
      return {
        group: `${start?.slice(0, 10)}|${title}`,
        title,
        start,
        durationMinutes: parseNumber(r[at.duration]),
        sessionNotes: null,
        exercise: (r[at.exercise] ?? "").trim(),
        kind: truthy(r[at.warmup]) ? "warmup" : "set",
        weight: parseNumber(r[at.weight]),
        unit: unitOf(r[at.unit]),
        reps: parseNumber(r[at.reps]),
        seconds: parseNumber(r[at.seconds]),
        distance: null,
        rpe: parseNumber(r[at.rpe]),
        notes: text(r[at.notes], 500),
      };
    },
  };
}

export function parseWorkoutCsv(input: string, options: ParseOptions = {}): ParseResult {
  const rows = parseCsv(input);
  if (rows.length === 0) return { ok: false, error: "empty" };
  const headers = rows[0]!.map(norm);
  const format = detectFormat(headers);
  if (!format) return { ok: false, error: "unknownFormat" };
  const body = rows.slice(1);
  const { weightUnit, unitFromFile, read, byTime } = readerFor(format, headers, body, options);

  let raws = body.map(read);
  // A file stamped per set (Fitbod) is ordered by those stamps, so a set's
  // position — and the id derived from it — does not depend on export order.
  if (byTime) raws = raws.map((r, i) => ({ r, i })).sort((a, b) => (a.r.setTime ?? "").localeCompare(b.r.setTime ?? "") || a.i - b.i).map((x) => x.r);

  const skipped: ImportSkips = { warmups: 0, cardio: 0, invalid: 0 };
  type Building = ImportedSession & { rows: number; last: string };
  const sessions = new Map<string, Building>();

  for (const row of raws) {
    if (row.kind === "skip") continue;
    if (!row.start || !row.exercise) {
      skipped.invalid++;
      continue;
    }
    let session = sessions.get(row.group);
    if (!session) {
      session = {
        key: "", title: row.title || "Workout", startLocal: row.start, durationMinutes: row.durationMinutes,
        notes: row.sessionNotes, sets: [], rows: 0, last: row.start,
      };
      sessions.set(row.group, session);
    }
    if (row.start > session.last) session.last = row.start;
    const ordinal = session.rows++;
    if (row.kind === "warmup") {
      skipped.warmups++;
      continue;
    }
    const set = toSet(row, ordinal, row.unit ?? weightUnit);
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
    .map(({ rows: _rows, last, ...s }) => ({
      ...s,
      key: `${s.startLocal}|${s.title}`,
      // Per-set stamps (Fitbod): the workout lasted from its first set to its last.
      durationMinutes: s.durationMinutes ?? (byTime ? minutesBetween(s.startLocal, last) : null),
    }))
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
