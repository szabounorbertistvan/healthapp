import { afterEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReportExport } from "./report-export";
import { dict, renderWithApp } from "@/test/render";

const r = dict("en").clientApp.reports;

function mount() {
  return renderWithApp(<ReportExport url="/api/reports/progress.pdf" fileName="progress.pdf" type="application/pdf" />);
}

async function clickDownload() {
  await userEvent.setup().click(screen.getByRole("button", { name: r.download }));
}

describe("ReportExport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("offers Download and the plain link, and no Share where the browser cannot share files", () => {
    mount();
    expect(screen.getByRole("button", { name: r.download })).toBeEnabled();
    expect(screen.queryByRole("button", { name: r.share })).toBeNull();
    expect(screen.getByRole("link", { name: r.openInstead })).toHaveAttribute("href", "/api/reports/progress.pdf");
  });

  it("says the person is signed out when the route answers 401 without a JSON body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 401 })));
    mount();
    await clickDownload();
    expect(await screen.findByText(r.errors.REPORT_SIGNED_OUT)).toBeInTheDocument();
  });

  it("treats a redirect to the login page (HTML) as signed out, not as the report", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html></html>", { status: 200, headers: { "Content-Type": "text/html" } })));
    mount();
    await clickDownload();
    expect(await screen.findByText(r.errors.REPORT_SIGNED_OUT)).toBeInTheDocument();
  });

  it("shows the server's own message as is", async () => {
    const message = "Upgrade to export this report.";
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "UPGRADE_REQUIRED", message }, { status: 403 })));
    mount();
    await clickDownload();
    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it("names a dropped connection, and clears the error on the next try", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(new Response("x", { status: 401 }));
    vi.stubGlobal("fetch", fetch);
    mount();
    await clickDownload();
    expect(await screen.findByText(r.errors.network)).toBeInTheDocument();
    await clickDownload();
    expect(await screen.findByText(r.errors.REPORT_SIGNED_OUT)).toBeInTheDocument();
    expect(screen.queryByText(r.errors.network)).toBeNull();
  });
});
