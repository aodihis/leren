import type { AppType } from "@leren/api/client";
import { hc } from "hono/client";

/** A typed client for the API. */
export const api = hc<AppType>("/");
