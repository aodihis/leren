import { api } from "../api/api-client";
import type { ChannelAccountsOverview } from "./types";

/** Loads channel providers and the user's accounts. */
export async function loadChannelAccounts(): Promise<ChannelAccountsOverview> {
  const response = await api.api["channel-accounts"].$get();

  if (!response.ok) {
    throw new Error("Could not load your channel accounts.");
  }

  return response.json();
}

/** Loads channel accounts, tolerating load failure. */
export async function loadAccountsOrNone(): Promise<ChannelAccountsOverview["accounts"]> {
  try {
    return (await loadChannelAccounts()).accounts;
  } catch {
    return [];
  }
}
