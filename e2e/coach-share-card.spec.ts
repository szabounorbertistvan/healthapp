import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { authFile, prepare } from "./accounts";

/**
 * Coach share cards (/marketplace/share). Read-only: the generator makes
 * images in the browser and writes nothing anywhere. With the seeded coach's
 * profile not published, the page explains why there is no card and the
 * generator checks skip.
 */

const PATH = "/marketplace/share";

/** Width and height from a PNG's IHDR chunk; throws if the bytes are not a PNG. */
function pngSize(bytes: Buffer): { width: number; height: number } {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  sig.forEach((b, i) => { if (bytes[i] !== b) throw new Error("not a PNG"); });
  if (bytes.subarray(12, 16).toString("ascii") !== "IHDR") throw new Error("no IHDR");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

async function generator(page: Page): Promise<boolean> {
  await page.goto(PATH);
  const gen = page.getByTestId("share-generator");
  const notPublic = page.getByTestId("share-not-public");
  await expect(gen.or(notPublic).first()).toBeVisible();
  if (await notPublic.isVisible()) {
    await expect(notPublic.getByRole("link")).toHaveAttribute("href", "/settings/coach-profile");
    return false;
  }
  await expect(page.getByTestId("share-preview")).toBeVisible();
  return true;
}

async function rendered(page: Page) {
  await expect(page.getByText("Creating the image…")).toHaveCount(0);
  await expect(page.getByTestId("share-download")).toBeEnabled();
}

test.describe("access", () => {
  test("an anonymous visitor is sent to sign in, and back here after", async ({ browser }) => {
    const context = await browser.newContext();
    await prepare(context);
    const page = await context.newPage();
    await page.goto(PATH);
    await expect(page).toHaveURL(/\/login\?next=%2Fmarketplace%2Fshare/);
    await context.close();
  });
  test.describe("client", () => {
    test.use({ storageState: authFile("client") });
    test("the generator is coach-only: a client lands on Today", async ({ page }) => {
      await page.goto(PATH);
      await expect(page).toHaveURL(/\/today$/);
    });
  });
});

test.describe("coach", () => {
  test.use({ storageState: authFile("coach") });

  test("reachable from the marketplace tabs", async ({ page }) => {
    await page.goto("/marketplace");
    const tab = page.getByTestId("marketplace-tabs").getByRole("link", { name: "Share card" });
    await expect(tab).toHaveAttribute("href", PATH);
    await tab.click();
    await expect(page).toHaveURL(new RegExp(`${PATH}$`));
    await expect(page.getByRole("heading", { level: 1, name: "Create share card" })).toBeVisible();
    await expect(page.getByTestId("marketplace-tabs").locator('[aria-current="page"]')).toHaveText("Share card");
  });

  test("the card links to the coach's own canonical public page", async ({ page }) => {
    test.skip(!(await generator(page)), "the seeded coach's profile is not published");
    const url = await page.getByTestId("share-link").inputValue();
    expect(url).toMatch(/^https:\/\/[^/]+\/coaches\/[a-z0-9]+(-[a-z0-9]+)*$/);
    // the page cannot be pointed at someone else: there is no slug in its address to change
    await page.goto(`${PATH}?slug=someone-else`);
    await expect(page.getByTestId("share-link")).toHaveValue(url);
    // and the link opens a live public page
    const res = await page.goto(new URL(url).pathname);
    expect(res?.status()).toBe(200);
    await expect(page.getByText("Something went wrong on this screen")).toHaveCount(0);
  });

  test("every template, both sizes: a real PNG at the exact pixel size", async ({ page }) => {
    test.skip(!(await generator(page)), "the seeded coach's profile is not published");
    for (const template of ["signature", "minimal", "athletic"]) {
      await page.getByTestId(`share-template-${template}`).check({ force: true });
      for (const [format, w, h] of [["square", 1080, 1080], ["story", 1080, 1920]] as const) {
        await page.getByTestId(`share-format-${format}`).check({ force: true });
        await expect(page.getByTestId("share-preview-box")).toHaveAttribute("data-format", format);
        await rendered(page);
        const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("share-download").click()]);
        expect(download.suggestedFilename()).toMatch(new RegExp(`^voinic-[a-z0-9-]+-${template}-${format}\\.png$`));
        const path = await download.path();
        expect(pngSize(readFileSync(path!))).toEqual({ width: w, height: h });
      }
    }
    await expect(page.getByTestId("share-status")).toHaveText("Image saved.");
  });

  test("without a photo the card still renders", async ({ page }) => {
    test.skip(!(await generator(page)), "the seeded coach's profile is not published");
    await page.getByRole("button", { name: "No photo (your initials)" }).click();
    await rendered(page);
    await expect(page.getByTestId("share-photo-failed")).toHaveCount(0);
  });

  test("copy link puts the profile URL on the clipboard", async ({ page, context }) => {
    test.skip(!(await generator(page)), "the seeded coach's profile is not published");
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const url = await page.getByTestId("share-link").inputValue();
    await page.getByTestId("share-copy").click();
    await expect(page.getByTestId("share-status")).toHaveText("Link copied.");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
  });

  test("no native share sheet: the page says so and offers the download", async ({ page }) => {
    await page.addInitScript(() => { Object.defineProperty(navigator, "share", { value: undefined, configurable: true }); });
    test.skip(!(await generator(page)), "the seeded coach's profile is not published");
    await expect(page.getByTestId("share-share")).toHaveCount(0);
    await expect(page.getByTestId("share-unsupported")).toBeVisible();
    await expect(page.getByTestId("share-download")).toBeVisible();
  });

  test("a share sheet that takes files gets the image itself", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __shared: unknown[] }).__shared = [];
      Object.defineProperty(navigator, "canShare", { value: (d: ShareData) => Boolean(d?.files), configurable: true });
      Object.defineProperty(navigator, "share", {
        value: async (d: ShareData) => { (window as unknown as { __shared: unknown[] }).__shared.push({ files: (d.files ?? []).map((f) => f.type), text: d.text }); },
        configurable: true,
      });
    });
    test.skip(!(await generator(page)), "the seeded coach's profile is not published");
    await rendered(page);
    await page.getByTestId("share-share").click();
    await expect(page.getByTestId("share-status")).toHaveText("Sent to the share sheet.");
    const shared = await page.evaluate(() => (window as unknown as { __shared: { files: string[]; text: string }[] }).__shared[0]);
    expect(shared?.files).toEqual(["image/png"]);
    expect(shared?.text).toBe(await page.getByTestId("share-link").inputValue());
  });

  test("Romanian UI", async ({ page, context }) => {
    await context.addCookies([{ name: "bg-locale", value: "ro", url: process.env.E2E_BASE_URL ?? "http://localhost:3000" }]);
    await page.goto(PATH);
    await expect(page.getByRole("heading", { level: 1, name: "Creează card de promovare" })).toBeVisible();
  });
});
