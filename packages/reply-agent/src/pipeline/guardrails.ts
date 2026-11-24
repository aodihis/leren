import { MAX_BODY_LENGTH } from "./types";
import type { Draft, Email } from "./types";

/** The most characters of an email body that reach a model. */
export const EMAIL_BODY_LIMIT = 20_000;

/**
 * A marker that the drafting instructions contain. A draft that contains it repeats the
 * instructions, so the output guardrail blocks it.
 */
export const PROMPT_CANARY = "LEREN-REPLY-RULES-7f3a";

const INJECTION_PATTERNS: readonly RegExp[] = [
  /ignore (all |any |the )?(previous|prior|above|earlier) (instructions|rules|messages)/i,
  /disregard (all |any |the )?(previous|prior|above|earlier|your) (instructions|rules)/i,
  /(reveal|print|show|repeat|output) (me )?(your|the) (system |hidden )?(prompt|instructions)/i,
  /you are now\b/i,
  /new instructions\s*:/i,
  /\bsystem\s*:\s/i,
  /act as (an? )?(admin|administrator|developer|root)/i,
];

const CREDENTIAL_PATTERNS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bBearer\s+[A-Za-z0-9._~+/-]{24,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

/**
 * Whether a character is invisible or a control character that has no use in an email: control
 * characters other than tab, line feed and carriage return, zero-width and direction marks, and the
 * byte order mark.
 */
function isHidden(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;

  return (
    (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) ||
    code === 0x7f ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x2064) ||
    code === 0xfeff
  );
}

/** An email after the input guardrail: cleaned text and whether it looks like an injection. */
export interface PreparedEmail {
  readonly from: string;
  readonly subject: string;
  readonly body: string;
  readonly suspicious: boolean;
}

function clean(text: string): string {
  return [...text].filter((character) => !isHidden(character)).join("");
}

/**
 * The input guardrail. It removes control and invisible characters, cuts the body at
 * `EMAIL_BODY_LIMIT` and reports whether the text matches a known injection phrase. It never
 * blocks, because a message that quotes such a phrase is still a message that needs an answer. The
 * flag is passed on so that later stages can treat the email with more care.
 */
export function prepareEmail(email: Email): PreparedEmail {
  const from = clean(email.from);
  const subject = clean(email.subject);
  const body = clean(email.body).slice(0, EMAIL_BODY_LIMIT);
  const suspicious = INJECTION_PATTERNS.some((pattern) => pattern.test(`${subject}\n${body}`));

  return { from, subject, body, suspicious };
}

function neutralize(text: string): string {
  return text.replaceAll("</untrusted_email>", "</ untrusted_email>");
}

/**
 * Wraps an email as untrusted data for a prompt. A closing tag inside the email is neutralized, so
 * the email cannot end the envelope early.
 */
export function wrapUntrusted(email: PreparedEmail): string {
  return [
    "<untrusted_email>",
    `From: ${neutralize(email.from)}`,
    `Subject: ${neutralize(email.subject)}`,
    "",
    neutralize(email.body),
    "</untrusted_email>",
  ].join("\n");
}

/** The result of the output guardrail: the reasons for a block, or none. */
export interface GuardrailResult {
  readonly blocked: boolean;
  readonly reasons: readonly string[];
}

/**
 * The output guardrail. It blocks a reply that contains a credential pattern, repeats the drafting
 * instructions, answers without citing a playbook, or cites an id that is not in `retrievedIds`.
 * Contact details such as email addresses, links and phone numbers are normal content of a reply
 * and are never blocked.
 */
export function checkOutput(
  draft: Pick<Draft, "body" | "citations">,
  retrievedIds: ReadonlySet<string>,
): GuardrailResult {
  const reasons: string[] = [];

  if (CREDENTIAL_PATTERNS.some((pattern) => pattern.test(draft.body))) {
    reasons.push("The reply contains something that looks like a credential.");
  }

  if (draft.body.includes(PROMPT_CANARY)) {
    reasons.push("The reply repeats the drafting instructions.");
  }

  if (draft.citations.length === 0) {
    reasons.push("The reply answers without citing a playbook.");
  }

  if (draft.citations.some((id) => !retrievedIds.has(id))) {
    reasons.push("The reply cites a playbook that retrieval did not return.");
  }

  return { blocked: reasons.length > 0, reasons };
}

/**
 * The checks of the evaluator that need no model: the draft has a body of an accepted length, and
 * it cites at least one playbook and only playbooks that retrieval returned. Returns the problems
 * found, which become feedback for the next revision.
 */
export function checkDraft(draft: Draft, retrievedIds: ReadonlySet<string>): string[] {
  const issues: string[] = [];

  if (draft.body.trim().length === 0) {
    issues.push("The reply body is empty.");
  }

  if (draft.body.length > MAX_BODY_LENGTH) {
    issues.push(`The reply body is longer than ${MAX_BODY_LENGTH} characters.`);
  }

  if (draft.citations.length === 0) {
    issues.push("The reply cites no playbook.");
  }

  for (const id of draft.citations) {
    if (!retrievedIds.has(id)) {
      issues.push(`The reply cites "${id}", which retrieval did not return.`);
    }
  }

  return issues;
}
