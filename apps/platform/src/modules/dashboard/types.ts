import type { InferResponseType } from "hono/client";

import type { api } from "../api/api-client";

type DashboardEndpoint = (typeof api.api)["dashboard"];

/** The counts of the messages of a window and the latest failures, as the API returns them. */
export type Overview = InferResponseType<DashboardEndpoint["overview"]["$get"], 200>;

/** The report of a playbook whose period has ended, as the API returns it. */
export type PlaybookReport = InferResponseType<
  DashboardEndpoint["playbooks"][":id"]["report"]["$get"],
  200
>;
