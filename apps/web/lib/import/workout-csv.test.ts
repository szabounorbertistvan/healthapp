import { describe, expect, it } from "vitest";
import {
  detectFormat, exerciseNames, instantToLocal, parseClockSeconds, parseCsv, parseDurationMinutes, parseLocalDateTime, parseNumber, parseWorkoutCsv,
} from "./workout-csv";

// The shape of a real Hevy export (Settings → Export data → workouts.csv).
const HEVY = `"title","start_time","end_time","description","exercise_title","superset_id","exercise_notes","set_index","set_type","weight_kg","reps","distance_km","duration_seconds","rpe"
"Push Day","26 Mar 2024, 18:32","26 Mar 2024, 19:40","Felt strong","Bench Press (Barbell)",,"Pause on chest",0,"warmup",40,10,,,
"Push Day","26 Mar 2024, 18:32","26 Mar 2024, 19:40","Felt strong","Bench Press (Barbell)",,"Pause on chest",1,"normal",80,8,,,8
"Push Day","26 Mar 2024, 18:32","26 Mar 2024, 19:40","Felt strong","Bench Press (Barbell)",,"Pause on chest",2,"failure",80,6,,,10
"Push Day","26 Mar 2024, 18:32","26 Mar 2024, 19:40","Felt strong","Plank",,,0,"normal",,,,60,
"Push Day","26 Mar 2024, 18:32","26 Mar 2024, 19:40","Felt strong","Treadmill",,,0,"normal",,,2.5,,
"Legs","28 Mar 2024, 07:05","28 Mar 2024, 08:00","","Squat (Barbell)",,,0,"normal",100,5,,,
`;

// A Strong export (Settings → Export Strong Data), newer layout, no unit column.
const STRONG = `Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE
2023-01-15 08:30:00,"Morning, upper",1h 5m,Bench Press (Barbell),W,95,10,0,0,,,
2023-01-15 08:30:00,"Morning, upper",1h 5m,Bench Press (Barbell),1,185,5,0,0,"felt ""easy""",,8.5
2023-01-15 08:30:00,"Morning, upper",1h 5m,Bench Press (Barbell),Rest Timer,0,0,0,90,,,
2023-01-15 08:30:00,"Morning, upper",1h 5m,Pull Up,1,0,10,0,0,,,
2023-01-15 08:30:00,"Morning, upper",1h 5m,Pull Up,2,0,0,0,0,,,
`;

describe("parseCsv", () => {
  it("handles quotes, doubled quotes, embedded line breaks, CRLF and a BOM", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi""\nthere"\r\n')).toEqual([["a", "b"], ["x, y", 'say "hi"\nthere']]);
  });
  it("uses the header's delimiter", () => {
    expect(parseCsv("a;b\n1,5;2\n")).toEqual([["a", "b"], ["1,5", "2"]]);
  });
});

describe("values", () => {
  it("reads both apps' dates as wall time", () => {
    expect(parseLocalDateTime("26 Mar 2024, 18:32")).toBe("2024-03-26T18:32");
    expect(parseLocalDateTime("2023-01-15 08:30:00")).toBe("2023-01-15T08:30");
    expect(parseLocalDateTime("2023-01-15T8:30")).toBe("2023-01-15T08:30");
    expect(parseLocalDateTime("31 Apr 2024, 10:00")).toBeNull();
    expect(parseLocalDateTime("yesterday")).toBeNull();
  });
  it("reads spreadsheet dates day first, and a date alone only with a fallback time", () => {
    expect(parseLocalDateTime("26.03.2024", "12:00")).toBe("2024-03-26T12:00");
    expect(parseLocalDateTime("26/03/2024 18:05")).toBe("2024-03-26T18:05");
    expect(parseLocalDateTime("03/26/2024", "12:00")).toBe("2024-03-26T12:00"); // 26 cannot be a month
    expect(parseLocalDateTime("2024-03-26", "12:00")).toBe("2024-03-26T12:00");
    expect(parseLocalDateTime("2024-03-26")).toBeNull();
  });
  it("turns a zoned instant into the person's wall time", () => {
    expect(instantToLocal("2021-03-07 15:20:33 +0000", "Europe/Bucharest")).toBe("2021-03-07T17:20");
    expect(instantToLocal("2021-07-07T15:20:00Z", "Europe/Bucharest")).toBe("2021-07-07T18:20");
    expect(instantToLocal("2021-03-07 15:20:33", "Europe/Bucharest")).toBeNull();
  });
  it("reads clock durations", () => {
    expect(parseClockSeconds("0:01:30")).toBe(90);
    expect(parseClockSeconds("1:30")).toBe(90);
    expect(parseClockSeconds("45")).toBe(45);
    expect(parseClockSeconds("")).toBeNull();
  });
  it("reads Strong durations", () => {
    expect(parseDurationMinutes("1h 5m")).toBe(65);
    expect(parseDurationMinutes("45m")).toBe(45);
    expect(parseDurationMinutes("3600")).toBe(60);
    expect(parseDurationMinutes("")).toBeNull();
  });
  it("reads a decimal comma", () => {
    expect(parseNumber("62,5")).toBe(62.5);
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("abc")).toBeNull();
  });
  it("detects the format from the headers", () => {
    expect(detectFormat(["title", "start_time", "exercise_title", "set_type"])).toBe("hevy");
    expect(detectFormat(["Date", "Workout Name", "Exercise Name", "Set Order"])).toBe("strong");
    expect(detectFormat(["Date", "Exercise", "Reps", "Weight(kg)", "Duration(s)", "Distance(m)", "isWarmup", "Note"])).toBe("fitbod");
    expect(detectFormat(["Date", "Exercise", "Category", "Weight (kgs)", "Reps", "Distance", "Distance Unit", "Time"])).toBe("fitnotes");
    expect(detectFormat(["data", "exercițiu", "greutate", "repetări"])).toBe("voinic");
    expect(detectFormat(["date", "exercise", "weight", "reps"])).toBe("voinic");
    expect(detectFormat(["foo"])).toBeNull();
  });
});

describe("parseWorkoutCsv — Hevy", () => {
  const r = parseWorkoutCsv(HEVY);
  if (!r.ok) throw new Error("expected a parse");

  it("groups rows into sessions, oldest first, with the duration from end − start", () => {
    expect(r.format).toBe("hevy");
    expect(r.weightUnit).toBe("kg");
    expect(r.unitFromFile).toBe(true);
    expect(r.sessions.map((s) => [s.title, s.startLocal, s.durationMinutes])).toEqual([
      ["Push Day", "2024-03-26T18:32", 68],
      ["Legs", "2024-03-28T07:05", 55],
    ]);
    expect(r.sessions[0]!.notes).toBe("Felt strong");
  });

  it("leaves warm-ups out, keeps failure sets, stores a hold as a timed set, skips distance-only cardio", () => {
    const push = r.sessions[0]!;
    expect(push.sets.map((s) => [s.exercise, s.weightKg, s.reps, s.durationSeconds, s.rpe])).toEqual([
      ["Bench Press (Barbell)", 80, 8, null, 8],
      ["Bench Press (Barbell)", 80, 6, null, 10],
      ["Plank", 0, 0, 60, null],
    ]);
    expect(r.skipped).toEqual({ warmups: 1, cardio: 1, invalid: 0 });
  });

  it("numbers sets by their row in the workout, warm-ups counted, so ids survive a re-import", () => {
    expect(r.sessions[0]!.sets.map((s) => s.ordinal)).toEqual([1, 2, 3]);
  });

  it("keeps Hevy's per-exercise note once, not on every set", () => {
    expect(r.sessions[0]!.sets.map((s) => s.notes)).toEqual(["Pause on chest", null, null]);
  });

  it("converts a pounds export to kilograms", () => {
    const lbs = parseWorkoutCsv(HEVY.replace('"weight_kg"', '"weight_lbs"'));
    if (!lbs.ok) throw new Error("expected a parse");
    expect(lbs.weightUnit).toBe("lb");
    expect(lbs.sessions[0]!.sets[0]!.weightKg).toBe(36.29); // 80 lb
  });

  it("lists exercise names most-used first", () => {
    expect(exerciseNames(r.sessions)).toEqual([
      { name: "Bench Press (Barbell)", sets: 2 },
      { name: "Plank", sets: 1 },
      { name: "Squat (Barbell)", sets: 1 },
    ]);
  });
});

describe("parseWorkoutCsv — Strong", () => {
  it("uses the unit the person picks when the file has none, skips rest-timer rows and empty sets", () => {
    const r = parseWorkoutCsv(STRONG, { weightUnit: "lb" });
    if (!r.ok) throw new Error("expected a parse");
    expect(r.format).toBe("strong");
    expect(r.unitFromFile).toBe(false);
    expect(r.weightUnit).toBe("lb");
    const [s] = r.sessions;
    expect(s!.title).toBe("Morning, upper");
    expect(s!.durationMinutes).toBe(65);
    expect(s!.sets.map((x) => [x.exercise, x.weightKg, x.reps, x.rpe, x.notes])).toEqual([
      ["Bench Press (Barbell)", 83.91, 5, 8.5, 'felt "easy"'],
      ["Pull Up", 0, 10, null, null],
    ]);
    expect(r.skipped).toEqual({ warmups: 1, cardio: 0, invalid: 1 });
  });

  it("reads the unit column of an older export and a semicolon file with decimal commas", () => {
    const old = `"Date";"Workout Name";"Exercise Name";"Set Order";"Weight";"Weight Unit";"Reps";"RPE";"Distance";"Distance Unit";"Seconds";"Notes";"Workout Notes";"Workout Duration"
"2022-05-01 18:00:00";"A";"Deadlift (Barbell)";"1";"142,5";"kg";"3";"";"";"";"";"";"";"50m"
`;
    const r = parseWorkoutCsv(old, { weightUnit: "lb" });
    if (!r.ok) throw new Error("expected a parse");
    expect(r.unitFromFile).toBe(true);
    expect(r.weightUnit).toBe("kg");
    expect(r.sessions[0]!.sets[0]!.weightKg).toBe(142.5);
    expect(r.sessions[0]!.durationMinutes).toBe(50);
  });

  it("refuses rows the logger would refuse", () => {
    const bad = `Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE
2023-01-15 08:30:00,A,1h,Squat (Barbell),1,1500,5,0,0,,,
2023-01-15 08:30:00,A,1h,Squat (Barbell),2,100,500,0,0,,,
2023-01-15 08:30:00,A,1h,Squat (Barbell),3,100,5,0,0,,,14
`;
    const r = parseWorkoutCsv(bad);
    if (!r.ok) throw new Error("expected a parse");
    expect(r.skipped.invalid).toBe(2);
    // An RPE outside 1..10 is dropped, not the set.
    expect(r.sessions[0]!.sets).toEqual([expect.objectContaining({ weightKg: 100, reps: 5, rpe: null })]);
  });
});

describe("parseWorkoutCsv — Fitbod", () => {
  // Rows newest first, each set stamped in UTC, as Fitbod exports them.
  const FITBOD = `Date,Exercise,Reps,Weight(kg),Duration(s),Distance(m),Incline,Resistance,isWarmup,Note,multiplier
2021-03-07 16:05:00 +0000,Dumbbell Bench Press,10,30,0,0,0,0,false,,2
2021-03-07 15:50:00 +0000,Plank,0,0,45,0,0,0,false,,1
2021-03-07 15:30:00 +0000,Back Squat,5,100,0,0,0,0,false,heavy,1
2021-03-07 15:20:00 +0000,Back Squat,8,60,0,0,0,0,true,,1
2021-03-09 06:00:00 +0000,Running,0,0,0,3000,0,0,false,,1
`;
  it("groups a local day's sets into one workout, in time order, timed and warm-up sets handled", () => {
    const r = parseWorkoutCsv(FITBOD, { timeZone: "Europe/Bucharest" });
    if (!r.ok) throw new Error("expected a parse");
    expect(r.format).toBe("fitbod");
    expect(r.unitFromFile).toBe(true);
    expect(r.sessions).toHaveLength(1);
    const [s] = r.sessions;
    expect([s!.startLocal, s!.durationMinutes, s!.title]).toEqual(["2021-03-07T17:20", 45, "Fitbod"]);
    expect(s!.sets.map((x) => [x.ordinal, x.exercise, x.weightKg, x.reps, x.durationSeconds, x.notes])).toEqual([
      [1, "Back Squat", 100, 5, null, "heavy"],
      [2, "Plank", 0, 0, 45, null],
      [3, "Dumbbell Bench Press", 30, 10, null, null],
    ]);
    expect(r.skipped).toEqual({ warmups: 1, cardio: 1, invalid: 0 });
  });
});

describe("parseWorkoutCsv — FitNotes", () => {
  const FITNOTES = `Date,Exercise,Category,Weight (lbs),Reps,Distance,Distance Unit,Time,Comment
2019-03-25,Flat Barbell Bench Press,Chest,135,8,,,,
2019-03-25,Flat Barbell Bench Press,Chest,155,5,,,,last one hard
2019-03-25,Plank,Abs,,,,,0:01:00,
2019-03-27,Treadmill,Cardio,,,5,km,0:30:00,
`;
  it("reads the unit from the weight column, one workout per date at midday, times as clock values", () => {
    const r = parseWorkoutCsv(FITNOTES);
    if (!r.ok) throw new Error("expected a parse");
    expect(r.format).toBe("fitnotes");
    expect(r.weightUnit).toBe("lb");
    expect(r.sessions.map((s) => [s.startLocal, s.title, s.sets.length])).toEqual([
      ["2019-03-25T12:00", "FitNotes", 3],
      // A treadmill row with a time is a timed set, not skipped cardio.
      ["2019-03-27T12:00", "FitNotes", 1],
    ]);
    expect(r.sessions[0]!.sets.map((x) => [x.weightKg, x.reps, x.durationSeconds, x.notes])).toEqual([
      [61.23, 8, null, null],
      [70.31, 5, null, "last one hard"],
      [0, 0, 60, null],
    ]);
  });
});

describe("parseWorkoutCsv — Voinic template", () => {
  it("reads the Romanian template from a Romanian Excel: semicolons, decimal commas, day-first dates, per-row unit", () => {
    const sheet = `﻿data;ora;antrenament;exercițiu;greutate;unitate;repetări;secunde;rpe;încălzire;note
26.03.2024;18:30;Piept;Împins cu bara;40;kg;10;;;da;
26.03.2024;18:30;Piept;Împins cu bara;82,5;kg;5;;8;;bun
26.03.2024;18:30;Piept;Plank;;;;60;;;
27.03.2024;;Spate;Tracțiuni;10;lb;8;;;;
`;
    const r = parseWorkoutCsv(sheet);
    if (!r.ok) throw new Error("expected a parse");
    expect(r.format).toBe("voinic");
    expect(r.unitFromFile).toBe(true);
    expect(r.sessions.map((s) => [s.startLocal, s.title])).toEqual([
      ["2024-03-26T18:30", "Piept"],
      ["2024-03-27T12:00", "Spate"],
    ]);
    expect(r.sessions[0]!.sets.map((x) => [x.exercise, x.weightKg, x.reps, x.durationSeconds, x.rpe, x.notes])).toEqual([
      ["Împins cu bara", 82.5, 5, null, 8, "bun"],
      ["Plank", 0, 0, 60, null, null],
    ]);
    expect(r.sessions[1]!.sets[0]!.weightKg).toBe(4.54); // 10 lb on its own row
    expect(r.skipped.warmups).toBe(1);
  });

  it("asks for the unit when the sheet has no unit column", () => {
    const r = parseWorkoutCsv("date,exercise,weight,reps\n2024-03-26,Squat,100,5\n", { weightUnit: "lb" });
    if (!r.ok) throw new Error("expected a parse");
    expect([r.unitFromFile, r.weightUnit, r.sessions[0]!.sets[0]!.weightKg]).toEqual([false, "lb", 45.36]);
  });
});

describe("parseWorkoutCsv — refusals", () => {
  it("names what is wrong", () => {
    expect(parseWorkoutCsv("")).toEqual({ ok: false, error: "empty" });
    expect(parseWorkoutCsv("a,b\n1,2\n")).toEqual({ ok: false, error: "unknownFormat" });
    expect(parseWorkoutCsv(HEVY.split("\n")[0]!)).toEqual({ ok: false, error: "noSessions" });
  });
});
