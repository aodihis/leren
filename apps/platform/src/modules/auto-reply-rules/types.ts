import type { InferRequestType, InferResponseType } from "hono/client";

import type { api } from "../api/api-client";

type RulesEndpoint = (typeof api.api)["auto-reply-rules"];

/**
 * The body that creates or replaces a rule, as the API declares it.
 */
export type RuleInput = InferRequestType<RulesEndpoint["$post"]>["json"];

/**
 * A rule as the API returns it, including its derived status.
 */
export type Rule = InferResponseType<RulesEndpoint["$get"], 200>["rules"][number];

/**
 * The reply conditions of the `email` channel, as the API returns them.
 */
export type EmailConditions = Extract<Rule["conditions"][number], { channel: "email" }>;

/**
 * The values of the rule form. Dates are `datetime-local` strings in the rule's timezone, and the
 * sender allowlist and the aliases are text that the user separates with new lines or commas.
 */
export interface RuleFormValues {
  name: string;
  enabled: boolean;
  timezone: string;
  startsAt: string;
  endsAt: string;
  email: Omit<EmailConditions, "channel" | "senderAllowlist" | "mentionAliases"> & {
    senderAllowlist: string;
    mentionAliases: string;
  };
}
