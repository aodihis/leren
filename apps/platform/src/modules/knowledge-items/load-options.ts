import { api } from "../api/api-client";

/**
 * Loads what the knowledge form offers to choose from: the user's rules and contacts. A failure
 * throws, so the route shows its error page.
 */
export async function loadFormOptions() {
  const [rulesResponse, contactsResponse] = await Promise.all([
    api.api["auto-reply-rules"].$get(),
    api.api.contacts.$get(),
  ]);

  if (!rulesResponse.ok || !contactsResponse.ok) {
    throw new Error("Could not load your rules and contacts.");
  }

  const { rules } = await rulesResponse.json();
  const { contacts } = await contactsResponse.json();

  return { rules, contacts };
}
