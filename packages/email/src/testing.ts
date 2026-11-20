import type { EmailMessage, EmailSender } from "./types";

export type InMemoryEmailSender = EmailSender & {
  readonly sent: readonly EmailMessage[];
};

/**
 * Creates an `EmailSender` that records messages instead of delivering them. Tests read `sent` to
 * assert what would have been delivered.
 */
export function createInMemoryEmailSender(): InMemoryEmailSender {
  const sent: EmailMessage[] = [];

  return {
    sent,
    async verify() {},
    async send(message) {
      sent.push(message);
    },
  };
}
