import type { AppType } from "@leren/api/client";
import { hc } from "hono/client";

/**
 * A typed client for the API. Its request and response types come from the API's routes through
 * Hono RPC, so the platform does not redefine them. Requests go to the same origin, which reaches
 * the API through the development proxy or the production reverse proxy.
 */
export const api = hc<AppType>("/");
