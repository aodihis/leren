import type { InferResponseType } from "hono/client";

import type { api } from "../api/api-client";

type MessagesEndpoint = (typeof api.api)["messages"];

/** One page of the signed-in user's processed emails, as the API returns it. */
export type EmailList = InferResponseType<MessagesEndpoint["$get"], 200>;

export type EmailSummary = EmailList["messages"][number];

/** One email with its stored body and the whole decision of the pipeline, as the API returns it. */
export type EmailDetail = InferResponseType<MessagesEndpoint[":id"]["$get"], 200>;
