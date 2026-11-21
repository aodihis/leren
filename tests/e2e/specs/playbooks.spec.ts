import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { signInAsNewUser } from "../support/auth";

type PlaybookOptions = { startsAt?: string; endsAt?: string };

async function createPlaybook(
  page: Page,
  topic: string,
  options: PlaybookOptions = {},
): Promise<void> {
  await page.goto("/playbooks/new");
  await page.getByLabel("Topic", { exact: true }).fill(topic);
  await page.getByLabel("Response", { exact: true }).fill("We are open from 9 to 5.");

  if (options.startsAt || options.endsAt) {
    await page.getByRole("tab", { name: "Rules" }).click();
  }

  if (options.startsAt) {
    await page.getByLabel("Starts").fill(options.startsAt);
  }

  if (options.endsAt) {
    await page.getByLabel("Ends").fill(options.endsAt);
  }

  await page.getByRole("button", { name: "Create playbook" }).click();
  await expect(page).toHaveURL(/\/playbooks$/);
}

test.beforeEach(async ({ page }) => {
  await signInAsNewUser(page);
});

test("creates an enabled playbook and shows it in the list", async ({ page }) => {
  await createPlaybook(page, "Opening hours");

  const row = page.getByRole("row", { name: /Opening hours/ });

  await expect(row.getByText("Active", { exact: true })).toBeVisible();
  await expect(row.getByText("Always")).toBeVisible();
});

test("turns a playbook off and on again", async ({ page }) => {
  await createPlaybook(page, "Opening hours");

  const row = page.getByRole("row", { name: /Opening hours/ });

  await page.getByRole("button", { name: "Disable Opening hours" }).click();
  await expect(row.getByText("Disabled", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Enable Opening hours" }).click();
  await expect(row.getByText("Active", { exact: true })).toBeVisible();
});

test("derives the status of an enabled playbook from its period", async ({ page }) => {
  await createPlaybook(page, "Future playbook", { startsAt: "2099-01-01T09:00" });
  await createPlaybook(page, "Past playbook", { endsAt: "2000-01-01T09:00" });

  await expect(
    page.getByRole("row", { name: /Future playbook/ }).getByText("Scheduled", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("row", { name: /Past playbook/ }).getByText("Expired", { exact: true }),
  ).toBeVisible();
});

test("saves an edited playbook and keeps it enabled", async ({ page }) => {
  await createPlaybook(page, "Opening hours");
  await page
    .getByRole("row", { name: /Opening hours/ })
    .getByRole("link", { name: "Edit" })
    .click();

  await page.getByLabel("Response", { exact: true }).fill("We are open from 10 to 6.");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(/\/playbooks$/);

  await expect(
    page.getByRole("row", { name: /Opening hours/ }).getByText("Active", { exact: true }),
  ).toBeVisible();
});

test("deletes a playbook", async ({ page }) => {
  await createPlaybook(page, "Opening hours");
  await page.getByRole("button", { name: "Delete Opening hours" }).click();

  await expect(page.getByText(/You have no playbooks yet/)).toBeVisible();
});
