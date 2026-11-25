import { api } from "../api/api-client";
import type { ConnectorsOverview } from "./types";

/**
 * Loads the enabled connectors and the signed-in user's connections. Throws when the API cannot
 * be reached or refuses, so that a route can show its error.
 */
export async function loadConnectors(): Promise<ConnectorsOverview> {
  const response = await api.api.connectors.$get();

  if (!response.ok) {
    throw new Error("Could not load your connectors.");
  }

  return response.json();
}
