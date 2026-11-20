import { expect } from "@playwright/test";

import { MAILPIT_URL } from "./config";

type MailpitMessage = { ID: string; Subject: string };

/**
 * Deletes every email sent to `address`, so the next `readSignInCode` cannot return the code from an
 * earlier request for the same address.
 */
export async function clearInbox(address: string): Promise<void> {
  const query = encodeURIComponent(`to:${address}`);

  await fetch(`${MAILPIT_URL}/api/v1/search?query=${query}`, { method: "DELETE" });
}

/**
 * Waits for the sign-in email sent to `address` and returns its six-digit code. The inbox is
 * Mailpit, which receives every email the API sends during the tests.
 */
export async function readSignInCode(address: string): Promise<string> {
  let subject = "";

  await expect(async () => {
    const query = encodeURIComponent(`to:${address}`);
    const response = await fetch(`${MAILPIT_URL}/api/v1/search?query=${query}`);
    const body = (await response.json()) as { messages: MailpitMessage[] };

    expect(body.messages.length).toBeGreaterThan(0);
    subject = body.messages[0]?.Subject ?? "";
  }).toPass({ timeout: 10_000 });

  const code = /\b\d{6}\b/.exec(subject)?.[0];

  if (!code) {
    throw new Error(`No sign-in code found in the subject "${subject}"`);
  }

  return code;
}
