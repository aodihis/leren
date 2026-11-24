import type { EmailMessage, EmailSender } from "./types";

export type InMemoryEmailSender = EmailSender & {
  readonly sent: readonly EmailMessage[];
};

/** Creates an EmailSender that records messages. */
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
