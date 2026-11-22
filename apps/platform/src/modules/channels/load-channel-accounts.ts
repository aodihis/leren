import { api } from "../api/api-client";
import type { ChannelAccountsOverview } from "./types";

/**
 * Loads the enabled channel providers and the signed-in user's channel accounts. Throws when the
 * API cannot be reached or refuses, so that a route can show its error or fall back.
 */
export async function loadChannelAccounts(): Promise<ChannelAccountsOverview> {
  const response = await api.api["channel-accounts"].$get();

  if (!response.ok) {
    throw new Error("Could not load your channel accounts.");
  }

  return response.json();
}

/**
 * Loads the user's channel accounts for a screen that works without them. The playbook form uses
 * it, so a playbook can still be edited when the accounts cannot be loaded.
 */
export async function loadAccountsOrNone(): Promise<ChannelAccountsOverview["accounts"]> {
  try {
    return (await loadChannelAccounts()).accounts;
  } catch {
    return [];
  }
}
