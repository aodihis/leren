import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

import { clearInbox, readSignInCode } from "./mailpit";

/**
 * Returns an email address that no other test uses, so tests that run in parallel never share a
 * user or an inbox.
 */
export function uniqueEmail(): string {
  return `user-${crypto.randomUUID()}@example.com`;
}

/**
 * Requests a sign-in code for `email`, reads it from Mailpit and enters it. A new address
 * registers a user and lands on the profile page. The caller asserts where the sign-in ends.
 */
export async function signIn(page: Page, email: string): Promise<void> {
  await clearInbox(email);
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByText(`We sent a 6-digit code to ${email}`)).toBeVisible();

  const code = await readSignInCode(email);

  await page.getByLabel("Sign-in code").fill(code);
}

/**
 * Registers a new user and waits until the profile page is shown, so the test can navigate
 * straight to the page it exercises. Returns the address of the new user.
 */
export async function signInAsNewUser(page: Page): Promise<string> {
  const email = uniqueEmail();

  await signIn(page, email);
  await expect(page).toHaveURL(/\/profile$/);

  return email;
}
