import type { InferResponseType } from "hono/client";

import type { api } from "../api/api-client";

/** A conversation in the history list. */
export type ConversationSummary = InferResponseType<
  typeof api.api.assistant.$get,
  200
>["conversations"][number];
