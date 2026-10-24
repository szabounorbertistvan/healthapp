import { describe, expect, it } from "vitest";
import { capitalize, parseDay, weekDaysOf } from "./week";

describe("weekDaysOf", () => {
  it("runs Monday to Sunday around any day of the week", () => {
    const week = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"];
    expect(weekDaysOf("2026-10-24")).toEqual(week);
    expect(weekDaysOf("2026-10-19")).toEqual(week);
    expect(weekDaysOf("2026-10-25")).toEqual(week);
  });

  it("crosses a month and a year", () => {
    expect(weekDaysOf("2027-01-01")).toEqual(["2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02", "2027-01-03"]);
  });
});

describe("helpers", () => {
  it("reads an ISO day as that calendar day", () => {
    expect(parseDay("2026-10-24").getDate()).toBe(24);
  });
  it("capitalizes like the web's first-letter:uppercase", () => {
    expect(capitalize("sâmbătă")).toBe("Sâmbătă");
  });
});
