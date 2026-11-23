import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { signInAsNewUser } from "../support/auth";
import { seedFinishedPlaybook } from "../support/seed";

const SCREENSHOT_DIR = process.env.E2E_SCREENSHOT_DIR;

/**
 * Saves a picture of `target` when `E2E_SCREENSHOT_DIR` is set, so a run can produce evidence for a
 * pull request. Without it the test only asserts.
 */
async function capture(page: Page, target: Locator, name: string): Promise<void> {
  if (!SCREENSHOT_DIR) {
    return;
  }

  await page.mouse.move(0, 0);
  await target.screenshot({ path: `${SCREENSHOT_DIR}/${name}.png` });
}

test.beforeEach(async ({ page }) => {
  const email = await signInAsNewUser(page);

  await seedFinishedPlaybook(email);
});

test("shows the counts by outcome and the failures on the overview", async ({ page }) => {
  await page.goto("/");

  const summary = page.getByRole("region", { name: "Email summary" });

  await expect(summary.getByText("Received").locator("xpath=following-sibling::div")).toHaveText(
    "6",
  );
  await expect(summary.getByRole("link", { name: "Answer emails" })).toHaveText("3");
  await expect(summary.getByRole("link", { name: "Escalate emails" })).toHaveText("1");
  await expect(summary.getByRole("link", { name: "Ignore emails" })).toHaveText("1");

  await expect(page.getByRole("link", { name: "Invoice question" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Broken attachment" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Project deadline" })).toHaveCount(0);

  await capture(page, page.locator("main"), "dashboard-overview");
});

test("opens the processed emails of an outcome from the overview", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Answer emails" }).click();

  await expect(page).toHaveURL(/outcome=answer/);

  const rows = page.getByRole("row");

  await expect(rows.filter({ hasText: "Project deadline" })).toBeVisible();
  await expect(rows.filter({ hasText: "Room booking" })).toBeVisible();
  await expect(rows.filter({ hasText: "Invoice question" })).toBeVisible();
  await expect(rows.filter({ hasText: "Contract question" })).toHaveCount(0);

  await capture(page, page.locator("main"), "processed-emails-outcome-filter");
});

test("filters the processed emails by outcome", async ({ page }) => {
  await page.goto("/emails");
  await page.getByLabel("Outcome").selectOption("escalate");

  await expect(page).toHaveURL(/outcome=escalate/);
  await expect(page.getByRole("row", { name: /Contract question/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /Project deadline/ })).toHaveCount(0);
});

test("reports on a playbook whose period has ended", async ({ page }) => {
  await page.goto("/playbooks");
  await page.getByRole("link", { name: "Report for Vacation cover" }).click();

  await expect(page.getByRole("heading", { name: "Report: Vacation cover" })).toBeVisible();

  const outcomes = page.getByRole("region", { name: "Outcomes" });

  await expect(
    outcomes.getByText("Emails handled").locator("xpath=following-sibling::div"),
  ).toHaveText("4");
  await expect(
    outcomes.getByText("Cited in a reply").locator("xpath=following-sibling::div"),
  ).toHaveText("3");
  await expect(outcomes.getByText("Escalate").locator("xpath=following-sibling::div")).toHaveText(
    "1",
  );

  const deliveries = page.getByRole("region", { name: "Deliveries" });

  await expect(deliveries.getByRole("listitem").filter({ hasText: /^Delivered/ })).toContainText(
    "2",
  );
  await expect(
    deliveries.getByRole("listitem").filter({ hasText: /^Not delivered/ }),
  ).toContainText("1");

  await capture(page, page.locator("main"), "playbook-report");
});
