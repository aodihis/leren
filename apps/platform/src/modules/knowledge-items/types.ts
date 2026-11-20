import type { InferRequestType, InferResponseType } from "hono/client";

import type { api } from "../api/api-client";

type ItemsEndpoint = (typeof api.api)["knowledge-items"];

type ContactsEndpoint = (typeof api.api)["contacts"];

/**
 * The body that creates or replaces a knowledge item, as the API declares it.
 */
export type KnowledgeItemInput = InferRequestType<ItemsEndpoint["$post"]>["json"];

/**
 * A knowledge item as the API returns it, including whether the assistant may use it now.
 */
export type KnowledgeItem = InferResponseType<ItemsEndpoint["$get"], 200>["items"][number];

/**
 * A contact as the API returns it.
 */
export type Contact = InferResponseType<ContactsEndpoint["$get"], 200>["contacts"][number];

/**
 * The values of the knowledge form. The validity bounds are `datetime-local` strings in the
 * timezone of the item's rule, and the examples are text with one example on each line.
 */
export interface KnowledgeFormValues {
  ruleId: string;
  topic: string;
  examples: string;
  response: string;
  restrictions: string;
  validFrom: string;
  validUntil: string;
  contactIds: string[];
}
