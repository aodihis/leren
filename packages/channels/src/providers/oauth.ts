import { z } from "zod";

import { InvalidGrantError } from "./types";
import type { ProviderTokens } from "./types";

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().positive().optional(),
  id_token: z.string().optional(),
});

export type TokenResponse = z.infer<typeof tokenResponseSchema>;

/** Converts the lifetime of an access token in seconds to the instant it expires. */
export function tokenExpiry(seconds: number | undefined): string | null {
  return seconds === undefined ? null : new Date(Date.now() + seconds * 1000).toISOString();
}

const tokenErrorSchema = z.object({ error: z.string() });

/**
 * Posts a form to a provider's token endpoint and returns its answer. An error in `revokedErrors`
 * throws `InvalidGrantError`, because only a new connection can replace the grant. Some providers
 * report errors with a success status, so every answer is checked. Any other failure throws a
 * retryable plain error.
 */
export async function requestOAuthTokens(
  send: typeof fetch,
  provider: string,
  url: string,
  parameters: Record<string, string>,
  revokedErrors: readonly string[] = ["invalid_grant"],
): Promise<TokenResponse> {
  const response = await send(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(parameters),
  });

  const answer: unknown = await response.json().catch(() => undefined);
  const error = tokenErrorSchema.safeParse(answer);

  if (error.success && revokedErrors.includes(error.data.error)) {
    throw new InvalidGrantError();
  }

  if (!response.ok || error.success) {
    throw new Error(`${provider} token request failed with status ${response.status}`);
  }

  return tokenResponseSchema.parse(answer);
}

/**
 * Refreshes the tokens with the refresh token grant, using `requestTokens` to post the form. An
 * account without a refresh token cannot be refreshed, so it throws `InvalidGrantError`. A provider
 * that does not send a new refresh token keeps honouring the one it was given.
 */
export async function refreshTokens(
  requestTokens: (parameters: Record<string, string>) => Promise<TokenResponse>,
  previous: ProviderTokens,
): Promise<ProviderTokens> {
  if (!previous.refreshToken) {
    throw new InvalidGrantError("The account has no refresh token");
  }

  const response = await requestTokens({
    grant_type: "refresh_token",
    refresh_token: previous.refreshToken,
  });

  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token ?? previous.refreshToken,
    expiresAt: tokenExpiry(response.expires_in),
  };
}

/**
 * Reads the claims of an ID token. The signature is not checked, which the OpenID Connect
 * specification allows only for a token that was received directly from the provider's token
 * endpoint over TLS, so callers pass no other token.
 */
export function readIdTokenClaims<T>(
  idToken: string | undefined,
  schema: z.ZodType<T>,
  provider: string,
): T {
  const payload = idToken?.split(".")[1];

  if (!payload) {
    throw new Error(`${provider} did not return an ID token`);
  }

  return schema.parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
}
