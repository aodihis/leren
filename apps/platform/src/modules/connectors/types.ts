import type { InferResponseType } from "hono/client";

import type { api } from "../api/api-client";

type ConnectorsEndpoint = (typeof api.api)["connectors"];

/** The enabled connectors and the signed-in user's connections, as the API returns them. */
export type ConnectorsOverview = InferResponseType<ConnectorsEndpoint["$get"], 200>;

export type AvailableConnector = ConnectorsOverview["available"][number];

export type Connection = ConnectorsOverview["connections"][number];
