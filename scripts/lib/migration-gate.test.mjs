import { describe, expect, it } from "vitest";
import { checkHistory, checkNames, checkRemote, parseNameStatus } from "./migration-gate.mjs";

describe("migration gate · names", () => {
  it("passes well-named, unique files and ignores what is not SQL", () => {
    expect(checkNames(["20261127100000_a.sql", "20261129100000_b_c.sql", "README.md"])).toEqual([]);
  });
  it("refuses a malformed name and a shared version", () => {
    const errors = checkNames(["2026112710_short.sql", "20261127100000_Upper.sql", "20261129100000_a.sql", "20261129100000_b.sql"]);
    expect(errors).toHaveLength(3);
    expect(errors.join("\n")).toMatch(/2026112710_short\.sql/);
    expect(errors.join("\n")).toMatch(/20261127100000_Upper\.sql/);
    expect(errors.join("\n")).toMatch(/20261129100000: two files/);
  });
});

describe("migration gate · history against the base", () => {
  const base = ["20261125100000", "20261127100000"];
  const changes = (text) => parseNameStatus(text);

  it("passes a new migration newer than the base", () => {
    expect(checkHistory(changes("A\tsupabase/migrations/20261129100000_warmup_volume.sql"), base)).toEqual([]);
  });
  it("refuses an edit, a deletion and a rename of a migration already on the base", () => {
    const errors = checkHistory(changes([
      "M\tsupabase/migrations/20261125100000_program_activation.sql",
      "D\tsupabase/migrations/20261127100000_client_food_daily_totals.sql",
    ].join("\n")), base);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/modified/);
    expect(errors[1]).toMatch(/deleted/);
    const renamed = checkHistory(changes("R100\tsupabase/migrations/20261125100000_a.sql\tsupabase/migrations/20261130100000_a.sql"), base);
    expect(renamed[0]).toMatch(/renamed to/);
  });
  it("refuses a new migration older than the newest on the base", () => {
    expect(checkHistory(changes("A\tsupabase/migrations/20261126110000_late.sql"), base)[0]).toMatch(/--include-all/);
  });
  it("lets an allowed version through, and only that one", () => {
    const text = "M\tsupabase/migrations/20261125100000_a.sql\nM\tsupabase/migrations/20261127100000_b.sql";
    expect(checkHistory(changes(text), base, { "20261125100000": "renamed before it was applied" })).toHaveLength(1);
  });
  it("ignores files that are not migrations", () => {
    expect(checkHistory(changes("M\tsupabase/migrations/README.md"), base)).toEqual([]);
  });
});

describe("migration gate · remote ledger", () => {
  it("passes when the repository and the remote agree", () => {
    expect(checkRemote(["20261127100000"], ["20261127100000"]).errors).toEqual([]);
  });
  it("flags a version the remote ran without a file here, and one the remote lacks", () => {
    const r = checkRemote(["20261127100000", "20261129100000"], ["20261127100000", "20261128100000"]);
    expect(r.remoteOnly).toEqual(["20261128100000"]);
    expect(r.pending).toEqual(["20261129100000"]);
    expect(r.errors).toHaveLength(2);
    expect(r.errors[0]).toMatch(/no file/);
    expect(r.errors[1]).toMatch(/not applied/);
  });
});
