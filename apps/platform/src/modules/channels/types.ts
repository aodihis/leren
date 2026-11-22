import type { InferResponseType } from "hono/client";

import type { api } from "../api/api-client";

type ChannelAccountsEndpoint = (typeof api.api)["channel-accounts"];

/**
 * The enabled channel providers and the signed-in user's channel accounts, as the API returns them.
 */
export type ChannelAccountsOverview = InferResponseType<ChannelAccountsEndpoint["$get"], 200>;

export type ChannelAccount = ChannelAccountsOverview["accounts"][number];

export type ChannelProvider = ChannelAccountsOverview["providers"][number];
