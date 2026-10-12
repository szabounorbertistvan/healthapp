import { describe, expect, it } from "vitest";
import {
  checkCandidate, checkOrphan, fileHandle, makePlan, parseArgs, projectRefOf, run, safeMessage,
} from "./coach-documents-core.mjs";

const U1 = "11111111-2222-3333-4444-555555555555";
const U2 = "99999999-2222-3333-4444-555555555555";
const path = (u, name) => `voinic/coach-docs/${u}/${name}`;
const DAY = 24 * 3600 * 1000;
const NOW = Date.parse("2026-11-30T12:00:00Z");

/** An in-memory database + storage, recording every call in order. */
function world({ rows = [], files = [], failDelete = new Set(), purgeChanges = new Set() } = {}) {
  const state = { rows: rows.map((r) => ({ ...r })), files: new Map(files.map((f) => [f.public_id, f])), calls: [] };
  return {
    state,
    deps: {
      now: () => NOW,
      async candidates(mode, days) {
        state.calls.push(["candidates", mode, days]);
        return state.rows.filter((r) => r.mode === mode).map(({ mode: _m, ...r }) => r);
      },
      async purgeRow(id, publicId, mode) {
        state.calls.push(["purgeRow", id]);
        if (purgeChanges.has(id)) return false;
        const i = state.rows.findIndex((r) => r.document_id === id && r.storage_public_id === publicId && r.mode === mode);
        if (i < 0) return false;
        state.rows.splice(i, 1);
        return true;
      },
      async storageIds() { state.calls.push(["storageIds"]); return state.rows.map((r) => r.storage_public_id); },
      async listFiles() { state.calls.push(["listFiles"]); return [...state.files.values()]; },
      async fileExists(id) { state.calls.push(["fileExists"]); return state.files.has(id); },
      async deleteFile(id) {
        state.calls.push(["deleteFile", id]);
        if (failDelete.has(id)) throw Object.assign(new Error(`boom for ${id} at https://api.cloudinary.com/x?signature=abcdefghijklmnopqrstuvwxyz`), { status: 500 });
        return state.files.delete(id) ? "deleted" : "not_found";
      },
    },
  };
}

const identityRow = (id, u, name) => ({ mode: "identity", document_id: id, coach_user_id: u, storage_public_id: path(u, name), reason: "identity_document" });

describe("arguments", () => {
  it("defaults to a dry run and validates every option", () => {
    expect(parseArgs(["identity"])).toMatchObject({ command: "identity", execute: false, confirm: null });
    expect(parseArgs(["retention"], { COACH_DOCUMENT_RETENTION_DAYS: "400" }).days).toBe(400);
    expect(() => parseArgs(["everything"])).toThrow(/command must be/);
    expect(() => parseArgs(["identity", "--execute"])).toThrow(/--confirm/);
    expect(() => parseArgs(["retention", "--days=7"])).toThrow(/at least 30/);
    expect(() => parseArgs(["orphans", "--min-age-hours=1"])).toThrow(/at least 24/);
    expect(() => parseArgs(["identity", "--force"])).toThrow(/unknown option/);
    expect(parseArgs(["identity", "--execute", "--confirm=3", "--project-ref=abcdefghijklmnopqrst"]))
      .toMatchObject({ execute: true, confirm: 3, projectRef: "abcdefghijklmnopqrst" });
  });
  it("reads a hosted project ref and nothing else", () => {
    expect(projectRefOf("https://caiaretlxiljiiuoirtp.supabase.co")).toBe("caiaretlxiljiiuoirtp");
    expect(projectRefOf("http://127.0.0.1:54321")).toBeNull();
  });
});

describe("what may be touched", () => {
  it("a candidate must carry the job's reason and live in its owner's own coach-document folder", () => {
    expect(checkCandidate("identity", identityRow("d1", U1, "idcard00001"))).toBeNull();
    expect(checkCandidate("identity", { ...identityRow("d1", U1, "idcard00001"), reason: "not_accepted" })).toBe("wrong_reason");
    expect(checkCandidate("retention", identityRow("d1", U1, "idcard00001"))).toBe("wrong_reason");
    expect(checkCandidate("identity", { ...identityRow("d1", U1, "x"), storage_public_id: `voinic/avatars/${U1}/avatar` })).toBe("bad_path");
    expect(checkCandidate("identity", { ...identityRow("d1", U1, "x"), storage_public_id: `voinic/coach-docs/${U1}/../avatars/a1234567` })).toBe("bad_path");
    expect(checkCandidate("identity", { ...identityRow("d1", U1, "x"), storage_public_id: path(U2, "idcard00001") })).toBe("not_owner_folder");
  });
  it("an orphan is an old, unrecorded coach-document file — never a photo, never a recorded one, never a fresh upload", () => {
    const recorded = new Set([path(U1, "recorded01")]);
    const old = new Date(NOW - 3 * DAY).toISOString();
    expect(checkOrphan({ public_id: path(U1, "lonely0001"), created_at: old }, recorded, 48, NOW)).toBeNull();
    expect(checkOrphan({ public_id: path(U1, "recorded01"), created_at: old }, recorded, 48, NOW)).toBe("recorded");
    expect(checkOrphan({ public_id: path(U1, "fresh00001"), created_at: new Date(NOW - 3600_000).toISOString() }, recorded, 48, NOW)).toBe("too_recent");
    expect(checkOrphan({ public_id: `voinic/progress/${U1}/p0000001`, created_at: old }, recorded, 48, NOW)).toBe("bad_path");
    expect(checkOrphan({ public_id: path(U1, "noage00001") }, recorded, 48, NOW)).toBe("unknown_age");
  });
});

describe("dry run", () => {
  it("lists counts and ids, changes nothing, and prints no file name, user id or URL", async () => {
    const w = world({ rows: [identityRow("d1", U1, "idcard00001"), identityRow("d2", U2, "idcard00002")],
                      files: [{ public_id: path(U1, "idcard00001") }] });
    const lines = [];
    const s = await run(w.deps, { ...parseArgs(["identity", "--check-files"]) }, (l) => lines.push(l));
    expect(s).toMatchObject({ planned: 2, filesPresent: 1, executed: false, rowsDeleted: 0, filesDeleted: 0 });
    expect(w.state.calls.some(([c]) => c === "deleteFile" || c === "purgeRow")).toBe(false);
    const out = lines.join("\n");
    expect(out).toContain("document d1");
    expect(out).toContain(`file #${fileHandle(path(U1, "idcard00001"))}`);
    expect(out).not.toMatch(/coach-docs|https?:|11111111|99999999/);
    expect(out).toContain("--confirm=2");
  });
});

describe("execution", () => {
  const rows = () => [identityRow("d1", U1, "idcard00001"), identityRow("d2", U2, "idcard00002")];
  const files = () => [{ public_id: path(U1, "idcard00001") }, { public_id: path(U2, "idcard00002") }];

  it("refuses without the confirmed count", async () => {
    const w = world({ rows: rows(), files: files() });
    await expect(run(w.deps, parseArgs(["identity", "--execute", "--confirm=5"]), () => {})).rejects.toThrow(/--confirm=5 but 2/);
    expect(w.state.calls.some(([c]) => c === "deleteFile")).toBe(false);
  });

  it("deletes each file before its row, and only identity rows", async () => {
    const w = world({ rows: [...rows(), { mode: "retention", document_id: "q1", coach_user_id: U1, storage_public_id: path(U1, "cert000001"), reason: "not_accepted" }],
                      files: [...files(), { public_id: path(U1, "cert000001") }] });
    const s = await run(w.deps, parseArgs(["identity", "--execute", "--confirm=2"]), () => {});
    expect(s).toMatchObject({ rowsDeleted: 2, filesDeleted: 2, failed: 0 });
    const order = w.state.calls.filter(([c]) => c === "deleteFile" || c === "purgeRow").map(([c, x]) => `${c}:${x}`);
    expect(order).toEqual([`deleteFile:${path(U1, "idcard00001")}`, "purgeRow:d1", `deleteFile:${path(U2, "idcard00002")}`, "purgeRow:d2"]);
    expect(w.state.files.has(path(U1, "cert000001"))).toBe(true);
    expect(w.state.rows.map((r) => r.document_id)).toEqual(["q1"]);
  });

  it("a failed file delete keeps the row, and a second run finishes the job", async () => {
    const failDelete = new Set([path(U2, "idcard00002")]);
    const w = world({ rows: rows(), files: files(), failDelete });
    const lines = [];
    const first = await run(w.deps, parseArgs(["identity", "--execute", "--confirm=2"]), (l) => lines.push(l));
    expect(first).toMatchObject({ rowsDeleted: 1, failed: 1 });
    expect(w.state.rows.map((r) => r.document_id)).toEqual(["d2"]);
    expect(lines.join("\n")).not.toMatch(/coach-docs|https?:|signature|abcdefghijklmnop/);
    failDelete.clear();
    const second = await run(w.deps, parseArgs(["identity", "--execute", "--confirm=1"]), () => {});
    expect(second).toMatchObject({ rowsDeleted: 1, failed: 0 });
    const third = await run(w.deps, parseArgs(["identity", "--execute", "--confirm=0"]), () => {});
    expect(third).toMatchObject({ planned: 0, rowsDeleted: 0, filesDeleted: 0 });
  });

  it("a file already gone still lets the row go (idempotent after a crash between the two steps)", async () => {
    const w = world({ rows: rows(), files: [] });
    const s = await run(w.deps, parseArgs(["identity", "--execute", "--confirm=2"]), () => {});
    expect(s).toMatchObject({ filesAlreadyGone: 2, rowsDeleted: 2 });
  });

  it("an unconfirmed storage answer is a failure, not a success", async () => {
    const w = world({ rows: rows().slice(0, 1), files: files() });
    w.deps.deleteFile = async () => null;
    const s = await run(w.deps, parseArgs(["identity", "--execute", "--confirm=1"]), () => {});
    expect(s).toMatchObject({ failed: 1, rowsDeleted: 0 });
    expect(w.state.rows).toHaveLength(1);
  });

  it("a row that stopped being a candidate is left alone", async () => {
    const w = world({ rows: rows(), files: files() });
    const original = w.deps.candidates;
    let calls = 0;
    w.deps.candidates = async (...a) => { calls += 1; const r = await original(...a); return calls === 1 ? r : r.filter((x) => x.document_id !== "d2"); };
    const s = await run(w.deps, parseArgs(["identity", "--execute", "--confirm=2"]), () => {});
    expect(s).toMatchObject({ rowsDeleted: 1, changedSincePlan: 1 });
    expect(w.state.files.has(path(U2, "idcard00002"))).toBe(true);
  });

  it("a candidate outside its owner's folder is never planned, so never deleted", async () => {
    const bad = { ...identityRow("d9", U1, "x"), storage_public_id: path(U2, "idcard00009") };
    const w = world({ rows: [bad], files: [{ public_id: path(U2, "idcard00009") }] });
    const plan = await makePlan(w.deps, parseArgs(["identity"]));
    expect(plan).toMatchObject({ items: [], skipped: { not_owner_folder: 1 } });
  });

  it("orphans: deletes old unrecorded files only, re-checking the record first", async () => {
    const old = new Date(NOW - 5 * DAY).toISOString();
    const w = world({
      rows: [{ mode: "identity", document_id: "r1", coach_user_id: U1, storage_public_id: path(U1, "recorded01"), reason: "identity_document" }],
      files: [
        { public_id: path(U1, "recorded01"), created_at: old },
        { public_id: path(U1, "lonely0001"), created_at: old },
        { public_id: path(U2, "fresh00001"), created_at: new Date(NOW - 3600_000).toISOString() },
        { public_id: `voinic/avatars/${U1}/avatar`, created_at: old },
      ],
    });
    const s = await run(w.deps, parseArgs(["orphans", "--execute", "--confirm=1"]), () => {});
    expect(s).toMatchObject({ planned: 1, filesDeleted: 1, skipped: { recorded: 1, too_recent: 1, bad_path: 1 } });
    expect([...w.state.files.keys()].sort()).toEqual([path(U1, "recorded01"), path(U2, "fresh00001"), `voinic/avatars/${U1}/avatar`].sort());
  });
});

describe("messages", () => {
  it("strip URLs, file names and anything key-like", () => {
    const m = safeMessage(Object.assign(new Error(`failed https://api.cloudinary.com/v1_1/c/x?api_key=123 for ${path(U1, "idcard00001")} token AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`), { status: 401 }));
    expect(m).toMatch(/^HTTP 401/);
    expect(m).not.toMatch(/cloudinary|coach-docs|AAAAAAAA/);
  });
});
