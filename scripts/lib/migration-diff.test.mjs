import { describe, expect, it } from "vitest";
import { diff, localVersions, parseVersions } from "./migration-diff.mjs";

describe("migration diff", () => {
  it("reads versions from a comma list or CLI table output", () => {
    expect(parseVersions("20261116100000,20261115100000")).toEqual(["20261115100000", "20261116100000"]);
    // Local | Remote | Time: the second row exists only locally — it is not on the remote.
    expect(parseVersions("   20261116100000 | 20261116100000 | 2026-11-16 10:00:00\n   20261118100000 |                |")).toEqual(
      ["20261116100000"]);
    // …and a remote-only row has an empty Local column.
    expect(parseVersions("   20261116100000 | 20261116100000 | 2026-11-16 10:00:00\n                  | 20261128100000 | 2026-11-28 10:00:00")).toEqual(
      ["20261116100000", "20261128100000"]);
  });
  it("reads only the remote side of `supabase migration list` JSON", () => {
    const out = 'Initialising login role...\n{"migrations":[{"local":"20261127100000","remote":"20261127100000","time":"2026-11-27 10:00:00"},' +
      '{"local":"","remote":"20261128100000","time":"2026-11-28 10:00:00"},{"local":"20261129100000","remote":"","time":"2026-11-29 10:00:00"}],"message":"Migrations listed"}\n' +
      "A new version of Supabase CLI is available: v2.121.0";
    expect(parseVersions(out)).toEqual(["20261127100000", "20261128100000"]);
  });
  it("still reports a pending version when the CLI listed it beside the remote ones", () => {
    // Before: every number of the CLI output counted as remote, so this one never showed as pending.
    const remote = parseVersions("   20261127100000 | 20261127100000 | 2026-11-27 10:00:00\n   20261129100000 |                | 2026-11-29 10:00:00");
    expect(diff(["20261127100000", "20261129100000"], remote).pending).toEqual(["20261129100000"]);
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
