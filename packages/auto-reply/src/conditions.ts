import { detectMention } from "./mention";

export type SenderMode = "any" | "allowlist";

export type MentionDetection = "alias" | "alias_then_llm";

export type ThreadMode = "new" | "reply" | "both";

/**
 * The email conditions of an auto-reply rule. A sender allowlist holds full addresses and
 * `@domain` entries. `mentionAliases` extends the user's own names when detecting a mention.
 */
export interface EmailConditions {
  senderMode: SenderMode;
  senderAllowlist: readonly string[];
  replyWhenTo: boolean;
  replyWhenCc: boolean;
  replyWhenBcc: boolean;
  requireSoleRecipient: boolean;
  mentionOverrides: boolean;
  mentionDetection: MentionDetection;
  mentionAliases: readonly string[];
  threadMode: ThreadMode;
  skipBulkMail: boolean;
}

/**
 * The facts about a received email that the conditions look at. `isBulk` is true for a mailing
 * list or an automatically generated message, and `isReply` is true when the message belongs to an
 * existing thread. The caller derives both from the headers.
 */
export interface EmailFacts {
  from: string;
  to: readonly string[];
  cc: readonly string[];
  body: string;
  isReply: boolean;
  isBulk: boolean;
}

/**
 * The mailbox owner. `names` holds the user's own names, such as the first name and the full name.
 */
export interface EmailRecipient {
  email: string;
  names: readonly string[];
}

export type RecipientRole = "to" | "cc" | "bcc";

export type SkipReason =
  | "bulk_mail"
  | "sender_not_allowed"
  | "thread_mode"
  | "recipient_role"
  | "not_sole_recipient";

export type HandleReason = "recipient" | "mention";

/**
 * The result of evaluating the conditions. `check_mention` means that the conditions exclude the
 * message unless it addresses the user by name, that no alias matched and that the rule allows a
 * model to decide. The caller asks the model and then handles or skips the message.
 */
export type EmailVerdict =
  | { outcome: "handle"; reason: HandleReason }
  | { outcome: "skip"; reason: SkipReason }
  | { outcome: "check_mention"; reason: SkipReason };

/**
 * Lowercases and trims an address so that comparisons ignore case and surrounding spaces.
 */
function normalize(address: string): string {
  return address.trim().toLowerCase();
}

/**
 * Reports whether `sender` is allowed by `allowlist`. An entry that starts with `@` matches every
 * address of that domain, and any other entry matches one address.
 */
function isSenderAllowed(sender: string, allowlist: readonly string[]): boolean {
  const address = normalize(sender);

  return allowlist.map(normalize).some((entry) => {
    return entry.startsWith("@") ? address.endsWith(entry) : address === entry;
  });
}

/**
 * Finds how the email reached the user. A user who is in neither the To nor the Cc header received
 * the message as a blind copy, because blind copy recipients are never listed in the headers.
 */
function getRecipientRole(email: EmailFacts, user: EmailRecipient): RecipientRole {
  const address = normalize(user.email);

  if (email.to.some((recipient) => normalize(recipient) === address)) {
    return "to";
  }

  if (email.cc.some((recipient) => normalize(recipient) === address)) {
    return "cc";
  }

  return "bcc";
}

/**
 * Checks the conditions that a mention never overrides: bulk mail, the sender and the thread.
 * Returns the reason for skipping, or `null` when the message passes.
 */
function findHardSkip(conditions: EmailConditions, email: EmailFacts): SkipReason | null {
  if (conditions.skipBulkMail && email.isBulk) {
    return "bulk_mail";
  }

  if (
    conditions.senderMode === "allowlist" &&
    !isSenderAllowed(email.from, conditions.senderAllowlist)
  ) {
    return "sender_not_allowed";
  }

  if (conditions.threadMode === "new" && email.isReply) {
    return "thread_mode";
  }

  if (conditions.threadMode === "reply" && !email.isReply) {
    return "thread_mode";
  }

  return null;
}

/**
 * Checks the recipient conditions: whether the user's role is answered and, for the To role,
 * whether the user must be the only recipient. Returns the reason for skipping, or `null`.
 */
function findRecipientSkip(
  conditions: EmailConditions,
  email: EmailFacts,
  role: RecipientRole,
): SkipReason | null {
  const allowedByRole = {
    to: conditions.replyWhenTo,
    cc: conditions.replyWhenCc,
    bcc: conditions.replyWhenBcc,
  }[role];

  if (!allowedByRole) {
    return "recipient_role";
  }

  const isSoleRecipient = email.to.length + email.cc.length === 1;

  if (role === "to" && conditions.requireSoleRecipient && !isSoleRecipient) {
    return "not_sole_recipient";
  }

  return null;
}

/**
 * Decides whether an email is handled under one rule. The bulk mail, sender and thread conditions
 * are always enforced. The recipient conditions can be overridden by a mention of the user's name
 * when `mentionOverrides` is set. The function is pure and never calls a model, so a rule that
 * allows a model to detect mentions receives `check_mention` and the caller asks the model.
 */
export function evaluateEmailConditions(
  conditions: EmailConditions,
  email: EmailFacts,
  user: EmailRecipient,
): EmailVerdict {
  const hardSkip = findHardSkip(conditions, email);

  if (hardSkip) {
    return { outcome: "skip", reason: hardSkip };
  }

  const recipientSkip = findRecipientSkip(conditions, email, getRecipientRole(email, user));

  if (!recipientSkip) {
    return { outcome: "handle", reason: "recipient" };
  }

  if (!conditions.mentionOverrides) {
    return { outcome: "skip", reason: recipientSkip };
  }

  const names = [...user.names, ...conditions.mentionAliases];

  if (detectMention(email.body, names)) {
    return { outcome: "handle", reason: "mention" };
  }

  if (conditions.mentionDetection === "alias_then_llm") {
    return { outcome: "check_mention", reason: recipientSkip };
  }

  return { outcome: "skip", reason: recipientSkip };
}
