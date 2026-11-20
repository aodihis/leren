import { isoToZonedLocal, zonedLocalToIso } from "./time";
import type { Rule, RuleFormValues, RuleInput } from "./types";

/**
 * Splits text that the user separated with new lines or commas into trimmed, non-empty items.
 */
function splitList(text: string): string[] {
  return text.split(/[\n,]/).flatMap((item) => item.trim() || []);
}

/**
 * Returns the form values for a new rule, with the same defaults as the database.
 */
export function getNewRuleValues(timezone: string): RuleFormValues {
  return {
    name: "",
    enabled: true,
    timezone,
    startsAt: "",
    endsAt: "",
    email: {
      senderMode: "any",
      senderAllowlist: "",
      replyWhenTo: true,
      replyWhenCc: false,
      replyWhenBcc: false,
      requireSoleRecipient: false,
      mentionOverrides: false,
      mentionDetection: "alias",
      mentionAliases: "",
      threadMode: "both",
      skipBulkMail: true,
    },
  };
}

/**
 * Converts a stored rule to form values. The bounds are shown as wall clock time in the rule's own
 * timezone.
 */
export function toFormValues(rule: Rule): RuleFormValues {
  return {
    name: rule.name,
    enabled: rule.enabled,
    timezone: rule.timezone,
    startsAt: isoToZonedLocal(rule.startsAt, rule.timezone),
    endsAt: isoToZonedLocal(rule.endsAt, rule.timezone),
    email: {
      ...rule.email,
      senderAllowlist: rule.email.senderAllowlist.join("\n"),
      mentionAliases: rule.email.mentionAliases.join(", "),
    },
  };
}

/**
 * Converts form values to the request body. The bounds are read as wall clock time in the chosen
 * timezone, and an empty bound is open.
 */
export function toRequestBody(values: RuleFormValues): RuleInput {
  return {
    name: values.name,
    enabled: values.enabled,
    timezone: values.timezone,
    startsAt: zonedLocalToIso(values.startsAt, values.timezone),
    endsAt: zonedLocalToIso(values.endsAt, values.timezone),
    email: {
      ...values.email,
      senderAllowlist: splitList(values.email.senderAllowlist),
      mentionAliases: splitList(values.email.mentionAliases),
    },
  };
}
