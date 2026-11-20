import { createTransport } from "nodemailer";

import type { EmailMessage, EmailSender } from "./types";

export type SmtpEmailSenderOptions = {
  /** An SMTP connection URL such as `smtp://localhost:51025` or `smtps://user:pass@host:465`. */
  url: string;
  /** The address shown as the sender, for example `Leren <no-reply@leren.local>`. */
  from: string;
};

/**
 * Creates an `EmailSender` that delivers through an SMTP server. The URL's scheme decides the
 * transport security: `smtps` connects over TLS and `smtp` upgrades with STARTTLS when the server
 * offers it.
 */
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
