import type { EmailMessage } from "./types";

const EXPIRY_NOTE =
  "The code expires in a few minutes. If you did not request it, ignore this email.";

/**
 * Builds the email that carries a one-time sign-in code. The code is a short string of digits that
 * the recipient types into the sign-in form.
 */
export function createVerificationCodeEmail(to: string, code: string): EmailMessage {
  return {
    to,
    subject: `Your Leren sign-in code: ${code}`,
    text: `Your Leren sign-in code is ${code}.\n\n${EXPIRY_NOTE}`,
    html: [
      `<p>Your Leren sign-in code is:</p>`,
      `<p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p>`,
      `<p>${EXPIRY_NOTE}</p>`,
    ].join(""),
  };
}
