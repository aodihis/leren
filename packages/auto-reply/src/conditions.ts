import { detectMention } from "./mention";

export type SenderMode = "any" | "allowlist";

export type MentionDetection = "alias" | "alias_then_llm";

export type ThreadMode = "new" | "reply" | "both";

/** The email conditions of an auto-reply rule. */
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

/** The facts about a received email. */
export interface EmailFacts {
  from: string;
  to: readonly string[];
  cc: readonly string[];
  body: string;
  isReply: boolean;
  isBulk: boolean;
}

/** The mailbox owner. */
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

/** The result of evaluating the conditions. */
export type EmailVerdict =
  | { outcome: "handle"; reason: HandleReason }
  | { outcome: "skip"; reason: SkipReason }
  | { outcome: "check_mention"; reason: SkipReason };

/** Lowercases and trims an address. */
function normalize(address: string): string {
  return address.trim().toLowerCase();
}

/** Reports whether a sender is on the allowlist. */
function isSenderAllowed(sender: string, allowlist: readonly string[]): boolean {
  const address = normalize(sender);

  return allowlist.map(normalize).some((entry) => {
    return entry.startsWith("@") ? address.endsWith(entry) : address === entry;
  });
}

/** Finds how the email reached the user. */
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

/** Checks the conditions a mention never overrides. */
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

/** Checks the recipient conditions. */
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

/** Decides whether an email is handled under a rule. */
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
