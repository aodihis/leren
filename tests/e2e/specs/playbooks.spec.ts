import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { signInAsNewUser } from "../support/auth";
import { seedChannelAccount } from "../support/seed";

/**
 * Registers a new user who has an email account connected, because a playbook that is enabled has to
 * name one (decision 0044). Returns the label of the account, which is the address of the user.
 */
async function signInWithAccount(page: Page): Promise<string> {
  const email = await signInAsNewUser(page);

  await seedChannelAccount(email);

  return email;
}

type PlaybookOptions = { startsAt?: string; endsAt?: string };

async function createPlaybook(
  page: Page,
  account: string,
  topic: string,
  options: PlaybookOptions = {},
): Promise<void> {
  await page.goto("/playbooks/new");
  await page.getByLabel("Topic", { exact: true }).fill(topic);
  await page.getByLabel("Information", { exact: true }).fill("We are open from 9 to 5.");

  await page.getByRole("tab", { name: "Rules" }).click();
  await page.getByLabel("Email account").selectOption({ label: account });

  if (options.startsAt) {
    await page.getByLabel("Starts").fill(options.startsAt);
  }

  if (options.endsAt) {
    await page.getByLabel("Ends").fill(options.endsAt);
  }

  await page.getByRole("button", { name: "Create playbook" }).click();
  await expect(page).toHaveURL(/\/playbooks$/);
}

test("creates an enabled playbook and shows it in the list", async ({ page }) => {
  const account = await signInWithAccount(page);

  await createPlaybook(page, account, "Opening hours");

  const row = page.getByRole("row", { name: /Opening hours/ });

  await expect(row.getByText("Active", { exact: true })).toBeVisible();
  await expect(row.getByText("Always")).toBeVisible();
});

test("turns a playbook off and on again", async ({ page }) => {
  const account = await signInWithAccount(page);

  await createPlaybook(page, account, "Opening hours");

  const row = page.getByRole("row", { name: /Opening hours/ });

  await page.getByRole("button", { name: "Disable Opening hours" }).click();
  await expect(row.getByText("Disabled", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Enable Opening hours" }).click();
  await expect(row.getByText("Active", { exact: true })).toBeVisible();
});

test("derives the status of an enabled playbook from its period", async ({ page }) => {
  const account = await signInWithAccount(page);

  await createPlaybook(page, account, "Future playbook", { startsAt: "2099-01-01T09:00" });
  await createPlaybook(page, account, "Past playbook", { endsAt: "2000-01-01T09:00" });

  await expect(
    page.getByRole("row", { name: /Future playbook/ }).getByText("Scheduled", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("row", { name: /Past playbook/ }).getByText("Expired", { exact: true }),
  ).toBeVisible();
});

test("saves an edited playbook and keeps it enabled", async ({ page }) => {
  const account = await signInWithAccount(page);

  await createPlaybook(page, account, "Opening hours");
  await page
    .getByRole("row", { name: /Opening hours/ })
    .getByRole("link", { name: "Opening hours" })
    .click();

  await page.getByLabel("Information", { exact: true }).fill("We are open from 10 to 6.");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(/\/playbooks$/);

  await expect(
    page.getByRole("row", { name: /Opening hours/ }).getByText("Active", { exact: true }),
  ).toBeVisible();
});

test("deletes a playbook", async ({ page }) => {
  const account = await signInWithAccount(page);

  await createPlaybook(page, account, "Opening hours");
  await page.getByRole("button", { name: "Delete Opening hours" }).click();

  await expect(page.getByText(/You have no playbooks yet/)).toBeVisible();
});
