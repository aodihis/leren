import type { InferResponseType } from "hono/client";

import { api } from "../api/api-client";

type TokensEndpoint = (typeof api.api.mcp)["tokens"];

/** An access token of the signed-in user, as the API lists it. */
export type AccessToken = InferResponseType<TokensEndpoint["$get"], 200>["tokens"][number];

/** Loads the user's access tokens. Throws when the API cannot be reached or refuses. */
export async function loadAccessTokens(): Promise<AccessToken[]> {
  const response = await api.api.mcp.tokens.$get();

  if (!response.ok) {
    throw new Error("Could not load your access tokens.");
  }

  return (await response.json()).tokens;
}
