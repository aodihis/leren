import { defineConnector } from "./definitions";
import { createConnector } from "./oauth";
import { CONNECTOR_IDS } from "./types";
import type { Connector, ConnectorId } from "./types";

/** The settings that the connectors need, as read from the environment. */
export type ConnectorSettings = {
  CONNECTORS: readonly ConnectorId[];
  GOOGLE_CLIENT_ID?: string | undefined;
  GOOGLE_CLIENT_SECRET?: string | undefined;
};

/**
 * Builds the client of every enabled connector, keyed by id. A connector that is not listed is not
 * built, so it can never be connected or registered with an agent. `loadConfig` has already checked
 * that the settings of every enabled connector are present.
 */
export function createConnectors(settings: ConnectorSettings): ReadonlyMap<string, Connector> {
  const connectors = new Map<string, Connector>();

  for (const id of CONNECTOR_IDS) {
    if (!settings.CONNECTORS.includes(id)) {
      continue;
    }

    connectors.set(
      id,
      createConnector(defineConnector(id), {
        clientId: settings.GOOGLE_CLIENT_ID,
        clientSecret: settings.GOOGLE_CLIENT_SECRET,
      }),
    );
  }

  return connectors;
}
