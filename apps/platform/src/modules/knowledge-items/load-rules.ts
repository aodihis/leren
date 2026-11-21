import { api } from "../api/api-client";

/**
 * Loads the user's rules, which a knowledge item belongs to. A failure throws, so the route shows
 * its error page.
 */
export async function loadRules() {
  const response = await api.api["auto-reply-rules"].$get();

  if (!response.ok) {
    throw new Error("Could not load your rules.");
  }

  const { rules } = await response.json();

  return rules;
}
