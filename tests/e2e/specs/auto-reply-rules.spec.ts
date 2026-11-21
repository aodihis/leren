import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { signInAsNewUser } from "../support/auth";

type RuleOptions = { enabled?: boolean; startsAt?: string; endsAt?: string };

async function createRule(page: Page, name: string, options: RuleOptions = {}): Promise<void> {
  await page.goto("/auto-reply-rules/new");
  await page.getByLabel("Name", { exact: true }).fill(name);

  if (options.enabled === false) {
    await page.getByRole("switch", { name: "Enabled" }).click();
  }

  if (options.startsAt) {
    await page.getByLabel("Starts").fill(options.startsAt);
  }

  if (options.endsAt) {
    await page.getByLabel("Ends").fill(options.endsAt);
  }

  await page.getByRole("button", { name: "Create rule" }).click();
  await expect(page).toHaveURL(/\/auto-reply-rules$/);
}

test.beforeEach(async ({ page }) => {
  await signInAsNewUser(page);
});

test("creates a rule that is active and shows it in the list", async ({ page }) => {
  await createRule(page, "Holiday");

  const row = page.getByRole("row", { name: /Holiday/ });

  await expect(row.getByText("Active", { exact: true })).toBeVisible();
  await expect(row.getByText("Always")).toBeVisible();
});

test("derives the status of a rule from its switch and its period", async ({ page }) => {
  await createRule(page, "Disabled rule", { enabled: false });
  await createRule(page, "Future rule", { startsAt: "2099-01-01T09:00" });
  await createRule(page, "Past rule", { endsAt: "2000-01-01T09:00" });

  await expect(
    page.getByRole("row", { name: /Disabled rule/ }).getByText("Disabled", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("row", { name: /Future rule/ }).getByText("Scheduled", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("row", { name: /Past rule/ }).getByText("Expired", { exact: true }),
  ).toBeVisible();
});

test("edits a rule and shows the new name", async ({ page }) => {
  await createRule(page, "Holiday");

  await page.getByRole("link", { name: "Edit" }).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Holiday");
  await page.getByLabel("Name", { exact: true }).fill("Summer break");
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page).toHaveURL(/\/auto-reply-rules$/);
  await expect(page.getByRole("row", { name: /Summer break/ })).toBeVisible();
  await expect(page.getByText("Holiday")).toHaveCount(0);
});

test("deletes a rule", async ({ page }) => {
  await createRule(page, "Holiday");

  await page.getByRole("button", { name: "Delete Holiday" }).click();

  await expect(page.getByText("You have no rules yet.")).toBeVisible();
});

test("does not show the rules of another user", async ({ page, browser }) => {
  await createRule(page, "Private rule");

  const other = await browser.newContext();
  const otherPage = await other.newPage();

  try {
    await signInAsNewUser(otherPage);
    await otherPage.getByRole("link", { name: "Rules" }).click();

    await expect(otherPage.getByText("You have no rules yet.")).toBeVisible();
    await expect(otherPage.getByText("Private rule")).toHaveCount(0);
  } finally {
    await other.close();
  }
});
