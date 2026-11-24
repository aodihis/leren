import { api } from "../api/api-client";
import type { Overview } from "./types";

/** Loads the message counts of the last 30 days. */
export async function loadOverview(): Promise<Overview | null> {
  try {
    const response = await api.api.dashboard.overview.$get({ query: { days: "30" } });

    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}
