import type { InferRequestType, InferResponseType } from "hono/client";

import type { api } from "../api/api-client";

type PlaybooksEndpoint = (typeof api.api)["playbooks"];

/**
 * The body that creates or replaces a playbook, as the API declares it.
 */
export type PlaybookInput = InferRequestType<PlaybooksEndpoint["$post"]>["json"];

/**
 * A playbook as the API returns it, including its derived period status and whether the assistant
 * may use it now.
 */
export type Playbook = InferResponseType<PlaybooksEndpoint["$get"], 200>["playbooks"][number];

/**
 * The reply conditions of the `email` channel, as the API returns them.
 */
export type EmailConditions = Extract<Playbook["conditions"][number], { channel: "email" }>;

/**
 * The values of the playbook form. The bounds are `datetime-local` strings in the playbook's
 * timezone, the examples are text with one example on each line, and the sender
 * allowlist and the aliases are text that the user separates with new lines or commas.
 */
export interface PlaybookFormValues {
  enabled: boolean;
  topic: string;
  examples: string;
  response: string;
  restrictions: string;
  timezone: string;
  startsAt: string;
  endsAt: string;
  email: Omit<EmailConditions, "channel" | "senderAllowlist" | "mentionAliases"> & {
    senderAllowlist: string;
    mentionAliases: string;
  };
}
