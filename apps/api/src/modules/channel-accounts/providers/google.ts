import { z } from "zod";

import { InvalidGrantError } from "./types";
import type { ChannelProvider, ProviderTokens } from "./types";

const AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

/**
 * The scopes of the Google provider. The first two identify the account. The Gmail scopes let the
 * product read mail and send approved replies (decision 0038).
 */
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
] as const;

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().positive().optional(),
  id_token: z.string().optional(),
});

const idTokenClaimsSchema = z.object({ sub: z.string().min(1), email: z.string().min(1) });

export type GoogleProviderOptions = {
  clientId: string;
  clientSecret: string;
  /** Replaces the global `fetch`, so tests can run without the network. */
  fetch?: typeof fetch;
};

/** Converts the lifetime of an access token in seconds to the instant it expires. */
function expiry(seconds: number | undefined): string | null {
  return seconds === undefined ? null : new Date(Date.now() + seconds * 1000).toISOString();
}

/**
 * Reads the claims of an ID token that was received directly from Google's token endpoint over
 * TLS. The OpenID Connect specification allows skipping the signature check for such a token.
 */
function readIdToken(idToken: string | undefined) {
  const payload = idToken?.split(".")[1];

  if (!payload) {
    throw new Error("Google did not return an ID token");
  }

  return idTokenClaimsSchema.parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
}

/**
 * The Google provider for the `email` channel. It connects a Gmail or Google Workspace mailbox with
 * the authorization code flow, PKCE and offline access. The account is identified by the `sub`
 * claim and labelled with the address.
 */
export function createGoogleProvider(options: GoogleProviderOptions): ChannelProvider {
  const send = options.fetch ?? fetch;

  const requestTokens = async (parameters: Record<string, string>) => {
    const response = await send(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: options.clientId,
        client_secret: options.clientSecret,
        ...parameters,
      }),
    });

    if (!response.ok) {
      const error: unknown = await response.json().catch(() => undefined);

      if (
        response.status === 400 &&
        z.object({ error: z.literal("invalid_grant") }).safeParse(error).success
      ) {
        throw new InvalidGrantError();
      }

      throw new Error(`Google token request failed with status ${response.status}`);
    }

    return tokenResponseSchema.parse(await response.json());
  };

  return {
    name: "google",
    channel: "email",
    displayName: "Google",
    start({ state, codeChallenge, redirectUri }) {
      const url = new URL(AUTHORIZATION_URL);

      url.search = new URLSearchParams({
        client_id: options.clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: GOOGLE_SCOPES.join(" "),
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        access_type: "offline",
        prompt: "consent",
      }).toString();

      return { kind: "redirect", url: url.toString() };
    },
    async finish({ code, codeVerifier, redirectUri }) {
      const response = await requestTokens({
        grant_type: "authorization_code",
        code,
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
      });

      if (!response.refresh_token) {
        throw new Error("Google did not return a refresh token");
      }

      const claims = readIdToken(response.id_token);

      return {
        providerAccountId: claims.sub,
        label: claims.email,
        tokens: {
          accessToken: response.access_token,
          refreshToken: response.refresh_token,
          expiresAt: expiry(response.expires_in),
        },
      };
    },
    async refresh(tokens) {
      if (!tokens.refreshToken) {
        throw new InvalidGrantError("The account has no refresh token");
      }

      const response = await requestTokens({
        grant_type: "refresh_token",
        refresh_token: tokens.refreshToken,
      });

      return {
        accessToken: response.access_token,
        refreshToken: response.refresh_token ?? tokens.refreshToken,
        expiresAt: expiry(response.expires_in),
      } satisfies ProviderTokens;
    },
    async revoke(tokens) {
      const response = await send(REVOKE_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: tokens.refreshToken ?? tokens.accessToken }),
      });

      if (!response.ok) {
        throw new Error(`Google token revocation failed with status ${response.status}`);
      }
    },
  };
}
