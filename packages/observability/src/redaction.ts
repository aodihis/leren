const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /(?<!\d)\+?\d(?:[\s().-]?\d){8,}(?!\d)/g;

/**
 * Replaces email addresses and phone numbers in `text` with `[redacted]`.
 *
 * Telemetry and logs call it before recording text that came from an email, so personal contact
 * details are not stored. The input is not modified.
 */
export function redact(text: string): string {
  return text.replace(EMAIL, "[redacted]").replace(PHONE, "[redacted]");
}

const DIAL_PHONE = new RegExp(
  [
    String.raw`(?<![\w+])\+\d(?:[\s().-]?\d){7,}(?!\d)`,
    String.raw`(?<!\d)\(\d{2,4}\)[\s.-]?\d(?:[\s.-]?\d){5,}(?!\d)`,
    String.raw`(?<![\d.-])0\d{1,3}[\s.-]\d{3,4}[\s.-]\d{3,5}(?!\d)`,
  ].join("|"),
  "g",
);

/**
 * Replaces email addresses and phone numbers in `text` with `[redacted]`, and keeps every other run
 * of digits. A phone number is recognised only by its form: a leading `+` and country code, an area
 * code in parentheses, or a local number with a leading zero and separators. Order numbers, invoice
 * numbers, dates, times and amounts therefore stay readable.
 *
 * It is used where the text is stored and read again later, so that the text keeps the details that
 * explain a decision. A bare run of digits is not treated as a phone number, so a number written
 * without any of these forms is kept. The input is not modified.
 */
export function redactContactDetails(text: string): string {
  return text.replace(EMAIL, "[redacted]").replace(DIAL_PHONE, "[redacted]");
}
