import { describe, expect, it } from "vitest";
import { detectFormat, exerciseNames, parseCsv, parseDurationMinutes, parseLocalDateTime, parseNumber, parseWorkoutCsv } from "./workout-csv";

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

describe("parseWorkoutCsv — refusals", () => {
  it("names what is wrong", () => {
    expect(parseWorkoutCsv("")).toEqual({ ok: false, error: "empty" });
    expect(parseWorkoutCsv("a,b\n1,2\n")).toEqual({ ok: false, error: "unknownFormat" });
    expect(parseWorkoutCsv(HEVY.split("\n")[0]!)).toEqual({ ok: false, error: "noSessions" });
  });
});
