import { expect, test, type Browser, type Page } from "@playwright/test";
import { prepare } from "../../e2e/accounts";
import { fence } from "../fixtures";
import { rows, userId } from "../backend";
import { SOAK_USERNAMES, soakAuth, type SoakWho } from "./accounts";

/** A page signed in as one of the trio, in a context of its own (two people, two browsers). */
export async function soakAs(browser: Browser, who: SoakWho): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ storageState: soakAuth(who) });
  const violations = await fence(context);
  await prepare(context);
  const page = await context.newPage();
  return {
    page,
    close: async () => {
      for (const p of context.pages()) await noteOrphans(p);
      await context.close();
      expect(violations(), `requests from ${who}'s page that tried to leave this machine`).toEqual([]);
    },
  };
}

export const idOf = (who: SoakWho) => userId(SOAK_USERNAMES[who]);

/** The coach ↔ client conversation the seed made. */
export async function conversationId(): Promise<string> {
  const [c] = await rows<{ id: string }>("conversations", `coach_id=eq.${await idOf("coach")}&client_id=eq.${await idOf("client")}&select=id`);
  if (!c) throw new Error("no soak conversation");
  return c.id;
}

/** No error boundary, crash page or 404 on screen. */
export async function expectHealthy(page: Page) {
  await expect(page.getByText("Something went wrong on this screen")).toHaveCount(0);
  await expect(page.getByText("Application error")).toHaveCount(0);
  await expect(page.getByText("This page could not be found.")).toHaveCount(0);
}

/** Today in Bucharest (the trio's time zone), as the app keys a diary day. */
export function todayIso(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Bucharest" }).format(new Date());
}

/**
 * A streamed Suspense segment React never revealed: a hidden copy of the page's
 * content left in `<div hidden id="S:n">` beside the rendered one (docs/GAPS.md,
 * "Streamed page content left behind"). Nobody sees it, so it is recorded as a
 * finding — counted in e2e-local/.soak/summary.md — rather than failing the test.
 */
export async function noteOrphans(page: Page) {
  const found = await page.evaluate(() => [...document.querySelectorAll("div[hidden][id^='S:']")].map((d) => d.id)).catch(() => []);
  if (found.length) {
    test.info().annotations.push({ type: "finding", description: `orphaned streamed segment on ${new URL(page.url()).pathname.replace(/[0-9a-f-]{36}/g, ":id")}` });
  }
}
