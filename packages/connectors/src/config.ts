import { parseEncryptionKey } from "@leren/channels";
import { z } from "zod";

import { CONNECTOR_IDS } from "./types";

const connectorList = z
  .string()
  .default("")
  .transform((value) =>
    value
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name !== ""),
  )
  .pipe(z.array(z.enum(CONNECTOR_IDS)));

/**
 * The environment variables that choose and configure the connectors (decision 0054). The API adds
 * them to its schema and calls `checkConnectorEnv` on the result. The Google connectors reuse
 * `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `CHANNEL_TOKEN_ENCRYPTION_KEY`.
 */
export const connectorEnvShape = {
  CONNECTORS: connectorList,
  GOOGLE_DOCS_MCP_URL: z.url().optional(),
  GOOGLE_SHEETS_MCP_URL: z.url().optional(),
};

export type ConnectorEnv = z.infer<z.ZodObject<typeof connectorEnvShape>> & {
  GOOGLE_CLIENT_ID?: string | undefined;
  GOOGLE_CLIENT_SECRET?: string | undefined;
  CHANNEL_TOKEN_ENCRYPTION_KEY?: string | undefined;
};

/** The variables that each connector needs. A connector that is not enabled needs none of them. */
const REQUIRED: Readonly<Record<(typeof CONNECTOR_IDS)[number], readonly (keyof ConnectorEnv)[]>> =
  {
    notion: [],
    google_docs: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_DOCS_MCP_URL"],
    google_sheets: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  };

/**
 * Reports a problem for every variable that an enabled connector needs and that is missing, and
 * for a missing or malformed encryption key.
 */
export function checkConnectorEnv(
  config: ConnectorEnv,
  problem: (variable: string, message: string) => void,
): void {
  if (config.CONNECTORS.length === 0) {
    return;
  }

  for (const id of config.CONNECTORS) {
    for (const name of REQUIRED[id]) {
      if (!config[name]) {
        problem(name, `${name} is required when the ${id} connector is enabled`);
      }
    }
  }

  try {
    parseEncryptionKey(config.CHANNEL_TOKEN_ENCRYPTION_KEY ?? "");
  } catch {
    problem(
      "CHANNEL_TOKEN_ENCRYPTION_KEY",
      "CHANNEL_TOKEN_ENCRYPTION_KEY must be 32 bytes encoded as base64 when a connector is enabled",
    );
  }
}
