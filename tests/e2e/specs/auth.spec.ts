import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { clearInbox, readSignInCode } from "../support/mailpit";

function uniqueEmail(): string {
  return `user-${crypto.randomUUID()}@example.com`;
}

async function signIn(page: Page, email: string): Promise<void> {
  await clearInbox(email);
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByText(`We sent a 6-digit code to ${email}`)).toBeVisible();

  const code = await readSignInCode(email);

  await page.getByLabel("Sign-in code").fill(code);
}

test("redirects a signed-out visitor to the login page", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText("Sign in to Leren")).toBeVisible();
});

test("registers a new user with an emailed code and saves their name", async ({ page }) => {
  const email = uniqueEmail();

  await signIn(page, email);

  await expect(page).toHaveURL(/\/profile$/);

  await page.getByLabel("First name").fill("Ada");
  await page.getByLabel("Last name").fill("Lovelace");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText("Ada Lovelace")).toBeVisible();
});

test("signs a returning user in again after signing out", async ({ page }) => {
  const email = uniqueEmail();

  await signIn(page, email);
  await expect(page).toHaveURL(/\/profile$/);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);

  await signIn(page, email);

  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByText(email).first()).toBeVisible();
});

test("shows an error for a wrong code", async ({ page }) => {
  const email = uniqueEmail();

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByText(`We sent a 6-digit code to ${email}`)).toBeVisible();
  await page.getByLabel("Sign-in code").fill("000000");

  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});
