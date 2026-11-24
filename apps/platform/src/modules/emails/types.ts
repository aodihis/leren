import type { InferResponseType } from "hono/client";

import type { api } from "../api/api-client";

type MessagesEndpoint = (typeof api.api)["messages"];

/** One page of the user's processed emails. */
export type EmailList = InferResponseType<MessagesEndpoint["$get"], 200>;

export type EmailSummary = EmailList["messages"][number];

/** One email with the pipeline's decision. */
export type EmailDetail = InferResponseType<MessagesEndpoint[":id"]["$get"], 200>;
