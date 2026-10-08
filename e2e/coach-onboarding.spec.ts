import { expect, test, type Page } from "@playwright/test";
import { authFile, prepare } from "./accounts";

/**
 * Coach onboarding (/settings/coach-profile) against the live project.
 *
 * Needs migration 20261020100000 applied there. Every write below is undone in
 * the same test, with one exception that cannot be: the seeded coach's draft
 * profile is created the first time this runs (become_coach() has no inverse
 * in the app). It stays a private draft — nothing public, nothing reviewed.
 */

const PATH = "/settings/coach-profile";

async function saved(page: Page) {
  await expect(page.getByRole("status").filter({ hasText: "Draft saved" })).toBeVisible();
}

/** Open the wizard as the seeded coach, creating the draft on the first run. */
async function openWizard(page: Page, step = 1) {
  await page.goto(`${PATH}?step=${step}`);
  const become = page.getByRole("button", { name: "Become a coach" });
  if (await become.isVisible().catch(() => false)) {
    await become.click();
    await page.waitForURL(new RegExp(`${PATH}$`));
    await page.goto(`${PATH}?step=${step}`);
  }
  const status = page.getByTestId("coach-profile-status");
  if ((await status.count()) > 0 && (await status.getAttribute("data-status")) !== "draft") {
    test.skip(true, "the seeded coach's profile is not a draft; the wizard is read-only");
  }
  await expect(page.getByRole("heading", { name: "Build your coach profile" })).toBeVisible();
}

test.describe("access", () => {
  test("an anonymous visitor is sent to sign in", async ({ browser }) => {
    const context = await browser.newContext();
    await prepare(context);
    const page = await context.newPage();
    await page.goto(PATH);
    await expect(page).toHaveURL(/\/login\?next=/);
    await context.close();
  });

  test.describe("client", () => {
    test.use({ storageState: authFile("client") });
    test("the wizard is coach-only: a client lands on Today", async ({ page }) => {
      await page.goto(PATH);
      await expect(page).toHaveURL(/\/today$/);
    });
    test("a client is offered Become a coach on their account", async ({ page }) => {
      await page.goto("/account");
      await expect(page.getByRole("button", { name: "Become a coach" })).toBeVisible();
    });
    test("the coach's Requests page is coach-only: a client lands on Today", async ({ page }) => {
      await page.goto("/requests");
      await expect(page).toHaveURL(/\/today$/);
    });
    test("the coach review queue is admin-only", async ({ page }) => {
      await page.goto("/admin/coaches");
      await expect(page).toHaveURL(/\/today$/);
    });
  });

  test.describe("coach", () => {
    test.use({ storageState: authFile("coach") });
    test("settings show the coach profile card", async ({ page }) => {
      await page.goto("/settings");
      await expect(page.getByText("Coach profile", { exact: true }).or(page.getByText("Coach on Voinic"))).toBeVisible();
    });
    test("a coach cannot open the review queue or a review page either", async ({ page }) => {
      await page.goto("/admin/coaches");
      await expect(page).toHaveURL(/\/dashboard$/);
      await page.goto("/admin/coaches/00000000-0000-4000-8000-000000000000");
      await expect(page).toHaveURL(/\/dashboard$/);
    });
  });
});

test.describe("wizard", () => {
  test.use({ storageState: authFile("coach") });

  test("renders step 1 of 6 and navigates with Continue and Back", async ({ page }) => {
    await openWizard(page);
    await expect(page.getByText("1 of 6")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Identity" })).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/step=2/);
    await expect(page.getByText("2 of 6")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Expertise" })).toBeVisible();
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page).toHaveURL(/step=1/);
  });

  test("the draft survives leaving and coming back", async ({ page }) => {
    await openWizard(page);
    const headline = page.getByLabel("Professional title");
    const before = await headline.inputValue();
    const marker = `E2E title ${Date.now()}`;
    try {
      await headline.fill(marker);
      await saved(page); // the debounced autosave
      await page.goto("/settings");
      await page.goto(PATH);
      await expect(page.getByLabel("Professional title")).toHaveValue(marker);
    } finally {
      await page.getByLabel("Professional title").fill(before);
      await saved(page);
    }
  });

  test("a headline over the limit blocks Continue", async ({ page }) => {
    await openWizard(page);
    const headline = page.getByLabel("Professional title");
    const before = await headline.inputValue();
    await headline.fill("x".repeat(121));
    await expect(page.getByText("Too long — 120 characters at most.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
    await headline.fill(before);
    await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();
  });

  test("specializations can be added and removed", async ({ page }) => {
    await openWizard(page, 2);
    const chip = page.getByTestId("coach-specializations").getByRole("button", { name: /Mobility/ });
    const before = await chip.getAttribute("aria-pressed");
    const after = before === "true" ? "false" : "true";
    try {
      await chip.click();
      await expect(chip).toHaveAttribute("aria-pressed", after);
      await saved(page);
      await page.reload();
      await expect(page.getByTestId("coach-specializations").getByRole("button", { name: /Mobility/ })).toHaveAttribute("aria-pressed", after);
    } finally {
      const again = page.getByTestId("coach-specializations").getByRole("button", { name: /Mobility/ });
      if ((await again.getAttribute("aria-pressed")) !== before) {
        await again.click();
        await saved(page);
      }
    }
  });

  test("in person asks for a location, online does not", async ({ page }) => {
    await openWizard(page, 3);
    const inPerson = page.getByRole("switch", { name: "In person" });
    const online = page.getByRole("switch", { name: "Online coaching" });
    const before = { inPerson: await inPerson.getAttribute("aria-checked"), online: await online.getAttribute("aria-checked") };
    try {
      if (before.inPerson === "true") await inPerson.click();
      await expect(page.getByText("Locations", { exact: true })).toHaveCount(0);
      await inPerson.click();
      await expect(page.getByText("Locations", { exact: true })).toBeVisible();
      if (await page.getByTestId("coach-locations").count() === 0) {
        await expect(page.getByText("Add at least one location for in-person coaching.")).toBeVisible();
      }
      await saved(page);
    } finally {
      if ((await inPerson.getAttribute("aria-checked")) !== before.inPerson) await inPerson.click();
      if ((await online.getAttribute("aria-checked")) !== before.online) await online.click();
      await saved(page);
    }
  });

  test("a service can be added and deleted", async ({ page }) => {
    await openWizard(page, 5);
    const name = `E2E service ${Date.now()}`;
    await page.getByRole("button", { name: "+ Add service" }).click();
    const form = page.getByTestId("coach-service-form");
    await form.getByLabel("Service name").fill(name);
    await form.getByLabel("Price", { exact: true }).fill("99");
    await form.getByRole("button", { name: "Save service" }).click();
    const list = page.getByTestId("coach-services");
    try {
      await expect(list.getByText(name)).toBeVisible();
      await page.reload();
      await expect(page.getByTestId("coach-services").getByText(name)).toBeVisible();
    } finally {
      await page.getByRole("button", { name: `Delete ${name}` }).click();
      await expect(page.getByTestId("coach-services").getByText(name)).toHaveCount(0);
    }
  });

  // 20261031100000: delivery, duration, a free price, switching off and on. Undone in the test.
  test("a free service with delivery and duration is saved, switched off and on, and deleted", async ({ page }) => {
    await openWizard(page, 5);
    const name = `E2E free ${Date.now()}`;
    await page.getByRole("button", { name: "+ Add service" }).click();
    const form = page.getByTestId("coach-service-form");
    await form.getByLabel("Service name").fill(name);
    await form.getByLabel("Delivery").selectOption("online");
    await form.getByLabel("Length").fill("30");
    await form.getByRole("radio", { name: "Free" }).click();
    await expect(form.getByLabel("Price", { exact: true })).toHaveCount(0); // free takes no price
    await form.getByRole("button", { name: "Save service" }).click();
    const row = page.getByTestId("coach-services").locator("li").filter({ hasText: name });
    try {
      await expect(row).toContainText("Free");
      await expect(row).toContainText("30 minutes");
      await row.getByTestId("coach-service-toggle").click();
      await expect(row).toHaveAttribute("data-active", "false");
      // the flip is optimistic; the buttons stay disabled until the save lands
      await expect(row.getByTestId("coach-service-toggle")).toBeEnabled();
      await page.reload();
      const again = page.getByTestId("coach-services").locator("li").filter({ hasText: name });
      await expect(again).toHaveAttribute("data-active", "false");
      await again.getByTestId("coach-service-toggle").click();
      await expect(again).toHaveAttribute("data-active", "true");
    } finally {
      await page.getByRole("button", { name: `Delete ${name}` }).click();
      await expect(page.getByTestId("coach-services").getByText(name)).toHaveCount(0);
    }
  });

  test("the last step shows the preview and a submit summary", async ({ page }) => {
    await openWizard(page, 6);
    await expect(page.getByText("6 of 6")).toBeVisible();
    await expect(page.getByText("This is how people will see your page.")).toBeVisible();
    const summary = page.getByTestId("coach-submit-summary");
    await expect(summary.getByText("Professional information")).toBeVisible();
    // optional rows (certifications, cover) show as open circles but never block submitting
    await expect(summary.locator("li[data-optional]")).toHaveCount(2);
    const open = await summary.locator("li[data-done=false]:not([data-optional])").count();
    const submit = summary.getByRole("button", { name: "Submit for review" });
    if (open > 0) await expect(submit).toBeDisabled();
    else await expect(submit).toBeEnabled();
  });

  // The acceptance path: complete the draft, submit it, see it pending review
  // with no way to publish it yourself, then take it back to draft. Every
  // field touched is restored. Needs the seeded coach to have a profile photo
  // (an upload cannot run here) — skipped otherwise.
  test("a complete draft is submitted for review, cannot self-publish, and is withdrawn", async ({ page }) => {
    await openWizard(page, 6);
    test.skip(
      (await page.getByTestId("coach-submit-summary").locator("li[data-done=false]").filter({ hasText: "Profile photo" }).count()) > 0,
      "the seeded coach has no profile photo",
    );

    const name = `E2E submit ${Date.now()}`;
    await page.goto(`${PATH}?step=1`);
    const before = {
      headline: await page.getByLabel("Professional title").inputValue(),
      about: await page.getByLabel("About", { exact: true }).inputValue(),
    };
    let specAdded = false;
    let onlineFlipped = false;
    try {
      if (!before.headline) await page.getByLabel("Professional title").fill("E2E Personal Trainer");
      if (!before.about) await page.getByLabel("About", { exact: true }).fill("E2E about text.");
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page).toHaveURL(/step=2/);
      const chips = page.getByTestId("coach-specializations");
      if ((await chips.locator("[aria-pressed=true]").count()) === 0) {
        await chips.getByRole("button", { name: /Strength/ }).click();
        specAdded = true;
      }
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page).toHaveURL(/step=3/);
      const online = page.getByRole("switch", { name: "Online coaching" });
      if ((await online.getAttribute("aria-checked")) !== "true") {
        await online.click();
        onlineFlipped = true;
      }
      await page.getByRole("button", { name: "Continue" }).click();
      await page.goto(`${PATH}?step=5`);
      await page.getByRole("button", { name: "+ Add service" }).click();
      const form = page.getByTestId("coach-service-form");
      await form.getByLabel("Service name").fill(name);
      await form.getByLabel("Price", { exact: true }).fill("99");
      await form.getByRole("button", { name: "Save service" }).click();
      await expect(page.getByTestId("coach-services").getByText(name)).toBeVisible();

      await page.goto(`${PATH}?step=6`);
      const summary = page.getByTestId("coach-submit-summary");
      await expect(summary.getByText("Your coach profile is ready")).toBeVisible();
      await summary.getByRole("button", { name: "Submit for review" }).click();

      await expect(page.getByTestId("coach-profile-status")).toHaveAttribute("data-status", "pending_review");
      await expect(page.getByText("Your profile has been submitted for review.")).toBeVisible();
      // read-only now: no wizard, no publish control anywhere
      await expect(page.getByRole("heading", { name: "Build your coach profile" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /publish/i })).toHaveCount(0);
    } finally {
      // back to draft (Edit profile → confirm), then undo every field
      if ((await page.getByTestId("coach-profile-status").getAttribute("data-status").catch(() => null)) === "pending_review") {
        await page.getByRole("button", { name: "Edit profile" }).click();
        await page.getByRole("dialog").getByRole("button", { name: "Edit profile" }).click();
        await expect(page.getByRole("heading", { name: "Build your coach profile" })).toBeVisible();
      }
      await page.goto(`${PATH}?step=5`);
      const del = page.getByRole("button", { name: `Delete ${name}` });
      if (await del.count()) {
        await del.click();
        await expect(page.getByTestId("coach-services").getByText(name)).toHaveCount(0);
      }
      if (onlineFlipped) {
        await page.goto(`${PATH}?step=3`);
        await page.getByRole("switch", { name: "Online coaching" }).click();
        await saved(page);
      }
      if (specAdded) {
        await page.goto(`${PATH}?step=2`);
        await page.getByTestId("coach-specializations").getByRole("button", { name: /Strength/ }).click();
        await saved(page);
      }
      await page.goto(`${PATH}?step=1`);
      await page.getByLabel("Professional title").fill(before.headline);
      await page.getByLabel("About", { exact: true }).fill(before.about);
      await saved(page);
    }
  });
});
