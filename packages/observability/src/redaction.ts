const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /(?<!\d)\+?\d(?:[\s().-]?\d){8,}(?!\d)/g;

/** Redacts email addresses and phone numbers. */
export function redact(text: string): string {
  return text.replace(EMAIL, "[redacted]").replace(PHONE, "[redacted]");
}
