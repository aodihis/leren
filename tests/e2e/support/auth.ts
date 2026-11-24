import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

import { clearInbox, readSignInCode } from "./mailpit";

/** Returns an email address that no other test uses. */
export function uniqueEmail(): string {
  return `user-${crypto.randomUUID()}@example.com`;
}

/** Signs in with a code read from Mailpit. */
export async function signIn(page: Page, email: string): Promise<void> {
  await clearInbox(email);
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByText(`We sent a 6-digit code to ${email}`)).toBeVisible();

  const code = await readSignInCode(email);

  await page.getByLabel("Sign-in code").fill(code);
}

/** Registers a new user and shows the profile page. */
export async function signInAsNewUser(page: Page): Promise<string> {
  const email = uniqueEmail();

  await signIn(page, email);
  await expect(page).toHaveURL(/\/profile$/);

  return email;
}
