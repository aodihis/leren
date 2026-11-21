import { isoToZonedLocal, zonedLocalToIso } from "./time";
import type { EmailConditions, Playbook, PlaybookFormValues, PlaybookInput } from "./types";

/**
 * Splits text that the user separated with new lines or commas into trimmed, non-empty items.
 */
function splitList(text: string): string[] {
  return text.split(/[\n,]/).flatMap((item) => item.trim() || []);
}

/**
 * Returns the email conditions of a playbook. The form edits only the `email` channel, so the
 * conditions of any other channel are left to the API.
 */
function findEmailConditions(playbook: Playbook): EmailConditions {
  const email = playbook.conditions.find((entry) => entry.channel === "email");

  if (!email) {
    throw new Error("The playbook has no email conditions");
  }

  return email;
}

/**
 * Returns the form values for a new playbook, with the same defaults as the email conditions of
 * the assistant's tools.
 */
export function getNewPlaybookValues(timezone: string): PlaybookFormValues {
  return {
    enabled: true,
    topic: "",
    examples: "",
    response: "",
    restrictions: "",
    contacts: "",
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
 * Converts a stored playbook to form values. The bounds are shown as wall clock time in the
 * playbook's own timezone.
 */
export function toFormValues(playbook: Playbook): PlaybookFormValues {
  const { channel: _channel, ...email } = findEmailConditions(playbook);

  return {
    enabled: playbook.enabled,
    topic: playbook.topic,
    examples: playbook.examples.join("\n"),
    response: playbook.response,
    restrictions: playbook.restrictions,
    contacts: playbook.contacts.join(", "),
    timezone: playbook.timezone,
    startsAt: isoToZonedLocal(playbook.startsAt, playbook.timezone),
    endsAt: isoToZonedLocal(playbook.endsAt, playbook.timezone),
    email: {
      ...email,
      senderAllowlist: email.senderAllowlist.join("\n"),
      mentionAliases: email.mentionAliases.join(", "),
    },
  };
}

/**
 * Converts form values to the request body. The bounds are read as wall clock time in the chosen
 * timezone, and an empty bound is open. Blank examples and contacts are dropped.
 */
export function toRequestBody(values: PlaybookFormValues): PlaybookInput {
  return {
    enabled: values.enabled,
    topic: values.topic,
    examples: values.examples.split("\n").flatMap((example) => example.trim() || []),
    response: values.response,
    restrictions: values.restrictions,
    contacts: splitList(values.contacts),
    timezone: values.timezone,
    startsAt: zonedLocalToIso(values.startsAt, values.timezone),
    endsAt: zonedLocalToIso(values.endsAt, values.timezone),
    conditions: [
      {
        ...values.email,
        channel: "email",
        senderAllowlist: splitList(values.email.senderAllowlist),
        mentionAliases: splitList(values.email.mentionAliases),
      },
    ],
  };
}
