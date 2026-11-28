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
 * Replaces email addresses and phone numbers in `text` with `[redacted]`. A phone number is
 * recognised only by its form: a leading `+` and country code, an area code in parentheses, or a
 * leading zero with separators. Other digits, such as order numbers, dates and amounts, stay
 * readable.
 */
export function redactContactDetails(text: string): string {
  return text.replace(EMAIL, "[redacted]").replace(DIAL_PHONE, "[redacted]");
}
