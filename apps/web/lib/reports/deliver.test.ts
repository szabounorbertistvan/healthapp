import { describe, expect, it, vi } from "vitest";
import { canShareReport, fetchReport, fileNameFrom, saveReport, shareReport } from "./deliver";

const okResponse = (body: string, type: string, disposition: string) =>
  new Response(body, { status: 200, headers: { "Content-Type": type, "Content-Disposition": disposition } });

describe("fetching a report", () => {
  it("returns the file and the server's file name", async () => {
    const fetcher = vi.fn(async () => okResponse("a,b\r\n", "text/csv", 'attachment; filename="voinic-workouts_2026-09-16_2026-10-15.csv"'));
    const got = await fetchReport("/api/reports/workouts.csv?range=30", "fallback.csv", fetcher as unknown as typeof fetch);
    expect(got.ok && got.fileName).toBe("voinic-workouts_2026-09-16_2026-10-15.csv");
    expect(fetcher).toHaveBeenCalledWith("/api/reports/workouts.csv?range=30", { credentials: "same-origin", cache: "no-store" });
  });

  it("an error body's message is passed through for the page to show", async () => {
    const fetcher = async () => new Response(JSON.stringify({ error: "REPORT_TOO_LARGE", message: "Pick a shorter period." }), { status: 413 });
    expect(await fetchReport("/x", "f", fetcher as unknown as typeof fetch)).toEqual({ ok: false, error: "REPORT_TOO_LARGE", message: "Pick a shorter period." });
  });

  it("a non-JSON failure still has a code; a dropped connection is 'network'", async () => {
    expect(await fetchReport("/x", "f", (async () => new Response("<html>", { status: 401 })) as unknown as typeof fetch))
      .toMatchObject({ ok: false, error: "REPORT_SIGNED_OUT" });
    expect(await fetchReport("/x", "f", (async () => new Response("oops", { status: 502 })) as unknown as typeof fetch))
      .toMatchObject({ ok: false, error: "REPORT_FAILED" });
    expect(await fetchReport("/x", "f", (async () => { throw new TypeError("offline"); }) as unknown as typeof fetch))
      .toEqual({ ok: false, error: "network", message: null });
  });

  it("reads the file name from Content-Disposition, else the fallback", () => {
    expect(fileNameFrom('attachment; filename="a.pdf"', "b.pdf")).toBe("a.pdf");
    expect(fileNameFrom(null, "b.pdf")).toBe("b.pdf");
  });
});

describe("saving and sharing", () => {
  it("saves through a temporary link with the file name, then lets the URL go", () => {
    vi.useFakeTimers();
    const a = { href: "", download: "", rel: "", click: vi.fn() };
    const doc = { createElement: vi.fn(() => a), body: { appendChild: vi.fn(), removeChild: vi.fn() } };
    const urls = { createObjectURL: vi.fn(() => "blob:1"), revokeObjectURL: vi.fn() };
    expect(saveReport(new Blob(["x"]), "r.pdf", doc as never, urls as never)).toBe(true);
    expect(a).toMatchObject({ href: "blob:1", download: "r.pdf" });
    expect(a.click).toHaveBeenCalled();
    vi.runAllTimers();
    expect(urls.revokeObjectURL).toHaveBeenCalledWith("blob:1");
    vi.useRealTimers();
  });

  it("reports when there is no way to save (the page's direct link remains)", () => {
    expect(saveReport(new Blob(["x"]), "r.pdf", undefined, undefined)).toBe(false);
  });

  it("shares only where the browser can share files, and treats closing the sheet as fine", async () => {
    const blob = new Blob(["%PDF"], { type: "application/pdf" });
    expect(await shareReport(blob, "r.pdf", "Report", undefined)).toBe("unsupported");
    const noFiles = { share: vi.fn(), canShare: vi.fn(() => false) };
    expect(await shareReport(blob, "r.pdf", "Report", noFiles)).toBe("unsupported");
    expect(canShareReport("r.pdf", "application/pdf", noFiles)).toBe(false);
    const yes = { share: vi.fn(async () => undefined), canShare: vi.fn(() => true) };
    expect(await shareReport(blob, "r.pdf", "Report", yes)).toBe("shared");
    expect(canShareReport("r.pdf", "application/pdf", yes)).toBe(true);
    const closed = { share: vi.fn(async () => { throw Object.assign(new Error("x"), { name: "AbortError" }); }), canShare: () => true };
    expect(await shareReport(blob, "r.pdf", "Report", closed)).toBe("cancelled");
    const broken = { share: vi.fn(async () => { throw new Error("NotAllowed"); }), canShare: () => true };
    expect(await shareReport(blob, "r.pdf", "Report", broken)).toBe("failed");
  });
});
