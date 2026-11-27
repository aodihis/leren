import { z } from "zod";

import {
  createGmailDraft,
  fetchNewGmail,
  readGmailPosition,
  readGmailReplyContext,
  sendGmailReply,
} from "./gmail";
import { readIdTokenClaims, refreshTokens, requestOAuthTokens, tokenExpiry } from "./oauth";
import type { MailDeliverer, MailReader, RedirectProvider } from "./types";

const AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

/**
 * The scopes of the Google provider. The first two identify the account. The Gmail scopes let the
 * product read mail, send replies and create drafts (decisions 0038 and 0046).
 */
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.compose",
] as const;

const idTokenClaimsSchema = z.object({ sub: z.string().min(1), email: z.string().min(1) });

export type GoogleProviderOptions = {
  clientId: string;
  clientSecret: string;
  /** Replaces the global `fetch`, so tests can run without the network. */
  fetch?: typeof fetch;
};

/**
 * The Google provider for the `email` channel. It connects a Gmail or Google Workspace mailbox with
 * the authorization code flow, PKCE and offline access. The account is identified by the `sub`
 * claim and labelled with the address. It reads new mail with the Gmail history API.
 */
export function createGoogleProvider(
  options: GoogleProviderOptions,
): RedirectProvider & MailReader & MailDeliverer {
  const send = options.fetch ?? fetch;

  const requestTokens = (parameters: Record<string, string>) =>
    requestOAuthTokens(send, "Google", TOKEN_URL, {
      client_id: options.clientId,
      client_secret: options.clientSecret,
      ...parameters,
    });

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

      const claims = readIdTokenClaims(response.id_token, idTokenClaimsSchema, "Google");

      const syncCursor = await readGmailPosition(send, response.access_token).catch(() => null);

      return {
        providerAccountId: claims.sub,
        label: claims.email,
        syncCursor,
        tokens: {
          accessToken: response.access_token,
          refreshToken: response.refresh_token,
          expiresAt: tokenExpiry(response.expires_in),
        },
      };
    },
    refresh(tokens) {
      return refreshTokens(requestTokens, tokens);
    },
    fetchNewMail(accessToken, cursor) {
      return fetchNewGmail(send, accessToken, cursor);
    },
    readReplyContext(accessToken, providerMessageId) {
      return readGmailReplyContext(send, accessToken, providerMessageId);
    },
    createDraft(accessToken, reply) {
      return createGmailDraft(send, accessToken, reply);
    },
    sendReply(accessToken, reply) {
      return sendGmailReply(send, accessToken, reply);
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
