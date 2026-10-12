import { expect, test, type Browser } from "@playwright/test";
import { prepare } from "./accounts";

/**
 * Coach Discovery on the landing page (components/coach-discovery/landing.tsx).
 * Read-only and anonymous: the section is there, high on the page, its calls
 * to action go where the directory's own do, and every coach it shows opens a
 * real public profile. Which coaches appear is the live directory's business —
 * with nobody published the section shows the three steps instead, and the
 * card checks skip.
 */

async function anonymousPage(browser: Browser, viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport });
  await prepare(context);
  return { context, page: await context.newPage() };
}

test.describe("landing: Coach Discovery", () => {
  test("sits right after the pillars and leads into the directory", async ({ browser }) => {
    const { context, page } = await anonymousPage(browser);
    await page.goto("/");
    const section = page.getByTestId("landing-coaches");
    await expect(section.getByRole("heading", { level: 2, name: "The right coach can change your whole journey." })).toBeVisible();
    // the hero keeps its own h1 and calls to action
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("link", { name: "Start free" })).toBeVisible();
    // high on the page: after the pillars, before the audience band
    const order = await section.evaluate((el) => {
      const pillar = [...document.querySelectorAll("p")].find((p) => p.textContent === "Progress");
      const forYou = [...document.querySelectorAll("h2")].find((h) => h.textContent === "For you");
      const follows = (a: Node | undefined, b: Node) => Boolean(a && a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      return { afterPillars: follows(pillar, el), beforeAudiences: follows(el, forYou!) };
    });
    expect(order).toEqual({ afterPillars: true, beforeAudiences: true });

    // cards or the steps, never an empty box
    await expect(section.getByTestId("landing-coaches-picks").or(section.getByTestId("landing-coaches-steps"))).toBeVisible();

    // a coach is invited to sign in, then lands on the "become a coach" card
    await expect(section.getByTestId("landing-coaches-for-coaches")).toHaveAttribute("href", "/login?next=%2Faccount");

    await section.getByTestId("landing-coaches-cta").click();
    await expect(page).toHaveURL(/\/coaches$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText("Something went wrong on this screen")).toHaveCount(0);
    await context.close();
  });

  test("every coach card opens that coach's public profile", async ({ browser }) => {
    const { context, page } = await anonymousPage(browser);
    await page.goto("/");
    const cards = page.getByTestId("landing-coach-card");
    await expect(page.getByTestId("landing-coaches-picks").or(page.getByTestId("landing-coaches-steps"))).toBeVisible();
    const n = await cards.count();
    test.skip(n === 0, "no published coach on this database");
    expect(n).toBeLessThanOrEqual(3);

    const link = cards.first().getByRole("link").first();
    const href = await link.getAttribute("href");
    expect(href).toMatch(/^\/coaches\/[^/?#]+$/);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expect(page.getByText("Something went wrong on this screen")).toHaveCount(0);
    await context.close();
  });

  test("on a phone: no sideways scroll, the directory call to action is full width", async ({ browser }) => {
    const { context, page } = await anonymousPage(browser, { width: 390, height: 844 });
    await page.goto("/");
    const cta = page.getByTestId("landing-coaches-cta");
    await expect(cta).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const [box, section] = await Promise.all([cta.boundingBox(), page.getByTestId("landing-coaches").boundingBox()]);
    expect(box!.width).toBeGreaterThan(section!.width * 0.75);
    // the reading order is button → coaches → the coach invitation: the second
    // audience never sits between the main call to action and its proof
    const proof = page.getByTestId("landing-coaches-picks").or(page.getByTestId("landing-coaches-steps"));
    const [proofBox, invite] = await Promise.all([proof.boundingBox(), page.getByTestId("landing-coaches-for-coaches").boundingBox()]);
    expect(proofBox!.y).toBeGreaterThan(box!.y + box!.height);
    expect(invite!.y).toBeGreaterThan(proofBox!.y + proofBox!.height);
    await context.close();
  });
});
