import type { InferResponseType } from "hono/client";

import type { api } from "../api/api-client";

type DashboardEndpoint = (typeof api.api)["dashboard"];

/** The message counts and latest failures. */
export type Overview = InferResponseType<DashboardEndpoint["overview"]["$get"], 200>;

/** The report of a playbook whose period has ended. */
export type PlaybookReport = InferResponseType<
  DashboardEndpoint["playbooks"][":id"]["report"]["$get"],
  200
>;
