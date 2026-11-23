import { api } from "../api/api-client";
import type { Overview } from "./types";

/**
 * Loads the message counts of the last 30 days, or `null` when they cannot be loaded, so that a
 * page that shows them still opens without them.
 */
export async function loadOverview(): Promise<Overview | null> {
  try {
    const response = await api.api.dashboard.overview.$get({ query: { days: "30" } });

    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}
