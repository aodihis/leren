import type { InferRequestType, InferResponseType } from "hono/client";

import type { api } from "../api/api-client";

type PlaybooksEndpoint = (typeof api.api)["playbooks"];

/** The body that creates or replaces a playbook. */
export type PlaybookInput = InferRequestType<PlaybooksEndpoint["$post"]>["json"];

/** A playbook as the API returns it. */
export type Playbook = InferResponseType<PlaybooksEndpoint["$get"], 200>["playbooks"][number];

/** The email reply conditions from the API. */
export type EmailConditions = Extract<Playbook["conditions"][number], { channel: "email" }>;

/** The values of the playbook form. */
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
