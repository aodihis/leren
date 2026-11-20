import type { InferRequestType, InferResponseType } from "hono/client";

import type { api } from "../api/api-client";

type ItemsEndpoint = (typeof api.api)["knowledge-items"];

/**
 * The body that creates or replaces a knowledge item, as the API declares it.
 */
export type KnowledgeItemInput = InferRequestType<ItemsEndpoint["$post"]>["json"];

/**
 * A knowledge item as the API returns it, including whether the assistant may use it now.
 */
export type KnowledgeItem = InferResponseType<ItemsEndpoint["$get"], 200>["items"][number];

/**
 * The values of the knowledge form. The validity bounds are `datetime-local` strings in the
 * timezone of the item's rule, the examples are text with one example on each line, and the
 * contacts are text that the user separates with commas.
 */
export interface KnowledgeFormValues {
  ruleId: string;
  topic: string;
  examples: string;
  response: string;
  restrictions: string;
  validFrom: string;
  validUntil: string;
  contacts: string;
}
