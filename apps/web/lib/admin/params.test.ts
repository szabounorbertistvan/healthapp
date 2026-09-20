import { describe, expect, it } from "vitest";
import { daysOf, intOf, listHref, oneOf, pageOf, paging, searchOf, str, uuidOf, USER_SORTS } from "./params";

describe("admin query params", () => {
  it("takes the first value and trims", () => {
    expect(str({ q: "  bob " }, "q")).toBe("bob");
    expect(str({ q: ["a", "b"] }, "q")).toBe("a");
    expect(str({ q: "   " }, "q")).toBeNull();
    expect(str({}, "q")).toBeNull();
  });

  it("only accepts allow-listed enum values", () => {
    expect(oneOf({ sort: "newest" }, "sort", USER_SORTS)).toBe("newest");
    expect(oneOf({ sort: "1; drop table users" }, "sort", USER_SORTS)).toBeNull();
    expect(oneOf({ sort: "NEWEST" }, "sort", USER_SORTS)).toBeNull();
  });

  it("clamps the page to a positive integer", () => {
    expect(pageOf({ page: "3" })).toBe(3);
    expect(pageOf({ page: "0" })).toBe(1);
    expect(pageOf({ page: "-2" })).toBe(1);
    expect(pageOf({ page: "2.5" })).toBe(1);
    expect(pageOf({ page: "abc" })).toBe(1);
    expect(pageOf({})).toBe(1);
  });

  it("bounds integers and days windows", () => {
    expect(intOf({ d: "7" }, "d", 1, 365)).toBe(7);
    expect(intOf({ d: "9999" }, "d", 1, 365)).toBeNull();
    expect(intOf({ d: "x" }, "d", 1, 365)).toBeNull();
    expect(daysOf({ days: "90" })).toBe(90);
    expect(daysOf({ days: "13" })).toBe(30);
    expect(daysOf({})).toBe(30);
  });

  it("validates ids as UUIDs, lower-cased", () => {
    expect(uuidOf("E1000000-0000-0000-0000-00000000000A")).toBe("e1000000-0000-0000-0000-00000000000a");
    expect(uuidOf("not-an-id")).toBeNull();
    expect(uuidOf("")).toBeNull();
    expect(uuidOf(undefined)).toBeNull();
  });

  it("caps the search term", () => {
    expect(searchOf({ q: "a".repeat(500) })?.length).toBe(120);
    expect(searchOf({})).toBeNull();
  });

  it("builds list URLs, dropping empties and page 1", () => {
    expect(listHref("/admin/users", { q: "bob", role: null, page: 1 })).toBe("/admin/users?q=bob");
    expect(listHref("/admin/users", { q: "bob" }, { page: 2 })).toBe("/admin/users?q=bob&page=2");
    expect(listHref("/admin/users", { q: "bob", page: 3 }, { q: "" })).toBe("/admin/users?page=3");
    expect(listHref("/admin/users", {})).toBe("/admin/users");
  });

  it("computes page bounds", () => {
    expect(paging(0, 1, 25)).toEqual({ pages: 1, first: 0, last: 0, offset: 0 });
    expect(paging(26, 2, 25)).toEqual({ pages: 2, first: 26, last: 26, offset: 25 });
    expect(paging(26, 9, 25)).toEqual({ pages: 2, first: 26, last: 26, offset: 25 });
    expect(paging(10, 1, 25)).toEqual({ pages: 1, first: 1, last: 10, offset: 0 });
  });
});
