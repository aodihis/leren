import { createTransport } from "nodemailer";

import type { EmailMessage, EmailSender } from "./types";

export type SmtpEmailSenderOptions = {
  /** An SMTP connection URL. */
  url: string;
  /** The address shown as the sender. */
  from: string;
};

/** Creates an EmailSender that uses SMTP. */
export function createSmtpEmailSender(options: SmtpEmailSenderOptions): EmailSender {
  const transport = createTransport(options.url);

  return {
    async verify() {
      await transport.verify();
    },
    async send(message: EmailMessage) {
      await transport.sendMail({
        from: options.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
    },
  };
}
