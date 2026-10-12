import { describe, expect, it } from "vitest";
import { diff, localVersions, parseVersions } from "./migration-diff.mjs";

describe("migration diff", () => {
  it("reads versions from a comma list or CLI table output", () => {
    expect(parseVersions("20261116100000,20261115100000")).toEqual(["20261115100000", "20261116100000"]);
    expect(parseVersions("   20261116100000 | 20261116100000 | 2026-11-16 10:00:00\n   20261118100000 |                |")).toEqual(
      ["20261116100000", "20261118100000"]);
  });
  it("finds duplicates among local files and ignores anything else", () => {
    const l = localVersions(["20261116100000_a.sql", "20261116100000_b.sql", "README.md", "20261118100000_c.sql"]);
    expect(l.duplicates).toEqual(["20261116100000"]);
    expect(l.versions).toEqual(["20261116100000", "20261118100000"]);
  });
  it("lists pending, out-of-order and remote-only versions", () => {
    const local = ["20261002110000", "20261116100000", "20261117100000", "20261118100000", "20261119100000"];
    const remote = ["20261002100000", "20261116100000", "20261117100000"];
    expect(diff(local, remote)).toEqual({
      pending: ["20261002110000", "20261118100000", "20261119100000"],
      remoteOnly: ["20261002100000"],
      outOfOrder: ["20261002110000"],
      newestRemote: "20261117100000",
    });
  });
});
