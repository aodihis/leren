import { PROMPT_CANARY } from "../pipeline/guardrails";

const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const URL_PATTERN = /https?:\/\/[^\s)>"']+/gi;
const PHONE_PATTERN = /\+?\d[\d\s().-]{6,}\d/g;
const NUMBER_PATTERN = /\d+/g;

const CREDENTIAL_PATTERNS = [
  /sk-[a-z0-9]{20,}/i,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:password|passwd|api[_ -]?key|secret)\s*[:=]\s*\S+/i,
];

const digitsOnly = (text: string) => text.replace(/\D/g, "");

/** The details of `body` that carry a fact: addresses, links, phone numbers and numbers. */
function factualDetails(body: string): string[] {
  const emails = body.match(EMAIL_PATTERN) ?? [];
  const urls = (body.match(URL_PATTERN) ?? []).map((url) => url.replace(/[.,;:!?]+$/, ""));
  const phones = body.match(PHONE_PATTERN) ?? [];

  const withoutOthers = [emails, urls, phones]
    .flat()
    .reduce((rest, found) => rest.replace(found, " "), body);

  const numbers = withoutOthers.match(NUMBER_PATTERN) ?? [];

  return [...emails, ...urls, ...phones, ...numbers];
}

/**
 * Returns the details of a reply body that none of the sources contains. A source is a playbook
 * or the original email. Addresses and links are compared as lower-case text, and phone numbers
 * by their digits and plain numbers as whole numbers, so that formatting differences are not reported. An empty
 * result means every factual detail of the reply can be traced to a source.
 */
export function unsupportedDetails(body: string, sources: readonly string[]): string[] {
  const haystack = sources.join("\n").toLowerCase();
  const digitHaystack = digitsOnly(haystack);
  const numbersInSources = new Set(haystack.match(NUMBER_PATTERN) ?? []);

  return factualDetails(body).filter((detail) => {
    if (/^\d+$/.test(detail)) {
      return !numbersInSources.has(detail);
    }

    return /^[\d\s+().-]+$/.test(detail)
      ? !digitHaystack.includes(digitsOnly(detail))
      : !haystack.includes(detail.toLowerCase());
  });
}

/**
 * Returns the policy violations of a reply body: the internal marker of the system prompt, and
 * text shaped like a credential. An empty result means the body is safe to show to a sender.
 */
export function policyViolations(body: string): string[] {
  const violations: string[] = [];

  if (body.includes(PROMPT_CANARY) || /LEREN-REPLY-RULES/i.test(body)) {
    violations.push("repeats the internal marker of the system prompt");
  }

  for (const pattern of CREDENTIAL_PATTERNS) {
    if (pattern.test(body)) {
      violations.push(`contains text that looks like a credential (${pattern.source})`);
    }
  }

  return violations;
}
