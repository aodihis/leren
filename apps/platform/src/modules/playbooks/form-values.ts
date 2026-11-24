import { isoToZonedLocal, zonedLocalToIso } from "./time";
import type { EmailConditions, Playbook, PlaybookFormValues, PlaybookInput } from "./types";

/** Splits text on new lines or commas into items. */
function splitList(text: string): string[] {
  return text.split(/[\n,]/).flatMap((item) => item.trim() || []);
}

/** Returns the email conditions of a playbook. */
function findEmailConditions(playbook: Playbook): EmailConditions {
  const email = playbook.conditions.find((entry) => entry.channel === "email");

  if (!email) {
    throw new Error("The playbook has no email conditions");
  }

  return email;
}

/** Returns the form values for a new playbook. */
export function getNewPlaybookValues(timezone: string): PlaybookFormValues {
  return {
    enabled: true,
    topic: "",
    examples: "",
    response: "",
    restrictions: "",
    timezone,
    startsAt: "",
    endsAt: "",
    email: {
      replyMode: "draft",
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

/** Converts a stored playbook to form values. */
export function toFormValues(playbook: Playbook): PlaybookFormValues {
  const { channel: _channel, ...email } = findEmailConditions(playbook);

  return {
    enabled: playbook.enabled,
    topic: playbook.topic,
    examples: playbook.examples.join("\n"),
    response: playbook.response,
    restrictions: playbook.restrictions,
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

/** Converts form values to the request body. */
export function toRequestBody(values: PlaybookFormValues): PlaybookInput {
  return {
    enabled: values.enabled,
    topic: values.topic,
    examples: values.examples.split("\n").flatMap((example) => example.trim() || []),
    response: values.response,
    restrictions: values.restrictions,
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
