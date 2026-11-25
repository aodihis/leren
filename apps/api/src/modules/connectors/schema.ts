import { z } from "zod";

import { CONNECTOR_IDS } from "@leren/connectors";

/** The connector in the path. An unknown or disabled connector is answered with not found. */
export const connectorParamsSchema = z.object({ connector: z.enum(CONNECTOR_IDS) });

/**
 * The query that the authorization server appends when it redirects the browser back. Every field
 * is optional because a refusal carries `error` and no `code`, and the handler reports each
 * missing field.
 */
export const callbackQuerySchema = z.object({
  code: z.string().max(2048).optional(),
  state: z.string().max(512).optional(),
  error: z.string().max(200).optional(),
});

/** The reasons that a connection can fail, which the callback reports to the platform. */
export type ConnectionErrorCode = "denied" | "invalid_state" | "failed";
