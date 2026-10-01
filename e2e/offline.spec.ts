import { expect, test } from "@playwright/test";
import { authFile } from "./accounts";

// The service worker (apps/web/app/sw.ts) only caches in a production build,
// so this runs against `next start`:
//   E2E_BASE_URL=http://localhost:3100 npx playwright test offline
// Against the dev server it skips itself.
test.use({ storageState: authFile("client") });

test("a page that cannot load offline shows the offline screen, and no one's data", async ({ page, context, request }) => {
  const worker = await (await request.get("/serwist/sw.js")).text();
  // a production worker carries the build's chunks in its precache manifest
  test.skip(!worker.includes("/_next/static/chunks/"), "dev worker: no precache, nothing to test");

  await page.goto("/today");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }));
    }
  });
  // install has precached the offline page before the worker took control
  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    const urls: string[] = [];
    for (const name of names) for (const r of await (await caches.open(name)).keys()) urls.push(new URL(r.url).pathname);
    return urls;
  });
  expect(cached).toContain("/offline");
  // only the shell: no screen with someone's data is ever stored
  expect(cached.filter((u) => /^\/(today|food|progress|workout|habits)/.test(u))).toEqual([]);

  await context.setOffline(true);
  try {
    await page.goto("/progress");
    await expect(page.getByRole("heading", { name: "You're offline" })).toBeVisible();
    await expect(page).toHaveURL(/\/progress$/);
  } finally {
    await context.setOffline(false);
  }
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "Progress" }).first()).toBeVisible();
});
