import { describe, expect, it } from "vitest";
import {
  addDays, availabilityProblems, bookingMoves, bookingSettingsProblems, DEFAULT_BOOKING_SETTINGS,
  minutesToTime, timeToMinutes, zonedDate, type AvailabilityBlock,
} from "./booking";

const block = (weekday: number, start: string, end: string, active = true): AvailabilityBlock => ({ weekday, start, end, active });

describe("times", () => {
  it("parses HH:MM, the end of day, and nothing else", () => {
    expect(timeToMinutes("09:30")).toBe(570);
    expect(timeToMinutes("24:00")).toBe(1440);
    expect(timeToMinutes("09:30:00")).toBe(570); // Postgres' time text
    expect(timeToMinutes("25:00")).toBeNull();
    expect(timeToMinutes("9:30")).toBeNull();
    expect(minutesToTime(570)).toBe("09:30");
  });
});

describe("weekly availability (mirrors coach_availability's constraints)", () => {
  it("accepts several blocks a day that do not overlap, touching included", () => {
    expect(availabilityProblems([block(1, "09:00", "13:00"), block(1, "13:00", "17:00"), block(2, "09:00", "17:00")]))
      .toEqual([[], [], []]);
  });
  it("refuses an end before or at the start, and a bad time", () => {
    expect(availabilityProblems([block(1, "14:00", "13:00")])).toEqual([["END_BEFORE_START"]]);
    expect(availabilityProblems([block(1, "10:00", "10:00")])).toEqual([["END_BEFORE_START"]]);
    expect(availabilityProblems([block(1, "24:00", "24:00")])).toEqual([["INVALID_TIME"]]);
    expect(availabilityProblems([block(8, "09:00", "10:00")])).toEqual([["INVALID_WEEKDAY"]]);
  });
  it("flags both overlapping active blocks of a weekday", () => {
    expect(availabilityProblems([block(1, "09:00", "13:00"), block(1, "12:00", "14:00")])).toEqual([["OVERLAP"], ["OVERLAP"]]);
  });
  it("lets an inactive block overlap, and other weekdays never clash", () => {
    expect(availabilityProblems([block(1, "09:00", "13:00"), block(1, "10:00", "11:00", false), block(2, "10:00", "11:00")]))
      .toEqual([[], [], []]);
  });
});

describe("booking settings (mirror coach_services' checks)", () => {
  const on = { ...DEFAULT_BOOKING_SETTINGS, bookable: true };
  it("accepts the defaults, bookable", () => {
    expect(bookingSettingsProblems(on, "online")).toEqual([]);
  });
  it("a digital service is never bookable", () => {
    expect(bookingSettingsProblems(on, "digital")).toEqual(["DIGITAL"]);
  });
  it("holds every number to its bounds", () => {
    expect(bookingSettingsProblems({ ...on, durationMinutes: 5 })).toEqual(["DURATION"]);
    expect(bookingSettingsProblems({ ...on, durationMinutes: null })).toEqual(["DURATION"]);
    expect(bookingSettingsProblems({ ...on, bufferAfterMinutes: 300 })).toEqual(["BUFFER"]);
    expect(bookingSettingsProblems({ ...on, minNoticeMinutes: -1 })).toEqual(["NOTICE"]);
    expect(bookingSettingsProblems({ ...on, maxAdvanceDays: 0 })).toEqual(["ADVANCE"]);
  });
  it("switched off, a missing duration is fine", () => {
    expect(bookingSettingsProblems({ ...DEFAULT_BOOKING_SETTINGS, durationMinutes: null })).toEqual([]);
  });
});

describe("moves (mirror respond / cancel / mark_booking)", () => {
  const now = new Date("2026-10-07T12:00:00Z");
  const future = "2026-10-08T09:00:00Z";
  const past = "2026-10-07T09:00:00Z";
  it("the coach answers a pending booking; a started one can only be declined", () => {
    expect(bookingMoves({ status: "pending", start_at: future }, "coach", now)).toEqual(["accept", "decline"]);
    expect(bookingMoves({ status: "pending", start_at: past }, "coach", now)).toEqual(["decline"]);
  });
  it("a confirmed booking is cancelled before it starts, marked after", () => {
    expect(bookingMoves({ status: "confirmed", start_at: future }, "coach", now)).toEqual(["cancel"]);
    expect(bookingMoves({ status: "confirmed", start_at: past }, "coach", now)).toEqual(["complete", "no_show"]);
  });
  it("the client may only cancel, and only before it starts", () => {
    expect(bookingMoves({ status: "pending", start_at: future }, "client", now)).toEqual(["cancel"]);
    expect(bookingMoves({ status: "confirmed", start_at: past }, "client", now)).toEqual([]);
  });
  it("a finished booking takes no move", () => {
    for (const status of ["declined", "cancelled", "completed", "no_show"] as const) {
      expect(bookingMoves({ status, start_at: future }, "coach", now)).toEqual([]);
    }
  });
});

describe("dates in a zone", () => {
  it("reads the coach's calendar date, not the server's", () => {
    // 22:30 UTC on the 7th is already the 8th in Bucharest, still the 7th in New York
    const instant = new Date("2026-10-07T22:30:00Z");
    expect(zonedDate(instant, "Europe/Bucharest")).toBe("2026-10-08");
    expect(zonedDate(instant, "America/New_York")).toBe("2026-10-07");
  });
  it("steps calendar days across a DST change and a month end", () => {
    expect(addDays("2026-10-24", 2)).toBe("2026-10-26");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
  });
});
