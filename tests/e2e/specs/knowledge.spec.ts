import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { signInAsNewUser } from "../support/auth";

async function createRule(page: Page, name: string): Promise<void> {
  await page.goto("/auto-reply-rules/new");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Create rule" }).click();
  await expect(page).toHaveURL(/\/auto-reply-rules$/);
}

async function createItem(
  page: Page,
  topic: string,
  response: string,
  validUntil?: string,
): Promise<void> {
  await page.goto("/knowledge/new");
  await page.getByLabel("Topic", { exact: true }).fill(topic);
  await page.getByLabel("Response", { exact: true }).fill(response);

  if (validUntil) {
    await page.getByLabel("Valid until").fill(validUntil);
  }

  await page.getByRole("button", { name: "Create item" }).click();
  await expect(page).toHaveURL(/\/knowledge$/);
}

test.beforeEach(async ({ page }) => {
  await signInAsNewUser(page);
});

test("creates an item as a draft that belongs to the chosen rule", async ({ page }) => {
  await createRule(page, "Holiday");
  await createItem(page, "Opening hours", "We are open from 9 to 5.");

  const row = page.getByRole("row", { name: /Opening hours/ });

  await expect(row.getByText("Holiday")).toBeVisible();
  await expect(row.getByText("Draft")).toBeVisible();
});

test("moves an item through approval, archiving and restoring", async ({ page }) => {
  await createRule(page, "Holiday");
  await createItem(page, "Opening hours", "We are open from 9 to 5.");

  const row = page.getByRole("row", { name: /Opening hours/ });

  await page.getByRole("button", { name: "Approve Opening hours" }).click();
  await expect(row.getByText("Approved")).toBeVisible();

  await page.getByRole("button", { name: "Archive Opening hours" }).click();
  await expect(row.getByText("Archived")).toBeVisible();

  await page.getByRole("button", { name: "Restore Opening hours" }).click();
  await expect(row.getByText("Draft")).toBeVisible();
});

test("sends an edited approved item back to draft", async ({ page }) => {
  await createRule(page, "Holiday");
  await createItem(page, "Opening hours", "We are open from 9 to 5.");
  await page.getByRole("button", { name: "Approve Opening hours" }).click();
  await expect(page.getByText("Approved")).toBeVisible();

  await page.getByRole("link", { name: "Edit" }).click();
  await expect(page.getByText("This item is approved.")).toBeVisible();
  await page.getByLabel("Response", { exact: true }).fill("We are open from 10 to 6.");
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page).toHaveURL(/\/knowledge$/);
  await expect(page.getByRole("row", { name: /Opening hours/ }).getByText("Draft")).toBeVisible();
});

test("marks an approved item whose validity has ended", async ({ page }) => {
  await createRule(page, "Holiday");
  await createItem(page, "Old offer", "The offer is valid.", "2000-01-01T09:00");

  await page.getByRole("button", { name: "Approve Old offer" }).click();

  await expect(page.getByText("Outside its validity")).toBeVisible();
});

test("deletes an item", async ({ page }) => {
  await createRule(page, "Holiday");
  await createItem(page, "Opening hours", "We are open from 9 to 5.");

  await page.getByRole("button", { name: "Delete Opening hours" }).click();

  await expect(page.getByText("You have no knowledge yet.")).toBeVisible();
});

test("does not show the knowledge of another user", async ({ page, browser }) => {
  await createRule(page, "Holiday");
  await createItem(page, "Private topic", "Private response.");

  const other = await browser.newContext();
  const otherPage = await other.newPage();

  try {
    await signInAsNewUser(otherPage);
    await otherPage.getByRole("link", { name: "Knowledge" }).click();

    await expect(otherPage.getByText("You have no knowledge yet.")).toBeVisible();
    await expect(otherPage.getByText("Private topic")).toHaveCount(0);
  } finally {
    await other.close();
  }
});
