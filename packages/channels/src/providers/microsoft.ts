import { z } from "zod";

import { readIdTokenClaims, refreshTokens, requestOAuthTokens, tokenExpiry } from "./oauth";
import {
  createOutlookDraft,
  fetchNewOutlookMail,
  readOutlookAddress,
  readOutlookPosition,
  readOutlookReplyContext,
  sendOutlookReply,
} from "./outlook";
import type { MailDeliverer, MailReader, RedirectProvider } from "./types";

const AUTHORITY_URL = "https://login.microsoftonline.com/common/oauth2/v2.0";

/**
 * The scopes of the Microsoft provider. The first three identify the account, `offline_access`
 * makes Microsoft return a refresh token, and the mail scopes let the product read mail, create
 * drafts and send replies (decision 0060).
 */
export const MICROSOFT_SCOPES = [
  "openid",
  "email",
  "profile",
  "offline_access",
  "https://graph.microsoft.com/Mail.ReadWrite",
  "https://graph.microsoft.com/Mail.Send",
] as const;

const idTokenClaimsSchema = z.object({ tid: z.string().min(1), oid: z.string().min(1) });

/**
 * The token errors that mean the user must connect the account again: the grant is no longer
 * valid, or Microsoft requires the user to sign in or consent again, which a refresh cannot do.
 */
const REVOKED_GRANT_ERRORS = ["invalid_grant", "interaction_required", "consent_required"];

export type MicrosoftProviderOptions = {
  clientId: string;
  clientSecret: string;
  /** Replaces the global `fetch`, so tests can run without the network. */
  fetch?: typeof fetch;
};

/**
 * The Microsoft provider for the `email` channel (decision 0060). It connects a Microsoft 365 or
 * Outlook.com mailbox through the `common` tenant with the authorization code flow, PKCE and
 * offline access. The account is identified by its tenant and object id and labelled with the
 * address of its mailbox. It reads new mail with a Graph delta query. Microsoft cannot revoke the tokens of
 * one application, so `revoke` calls nothing.
 */
export function createMicrosoftProvider(
  options: MicrosoftProviderOptions,
): RedirectProvider & MailReader & MailDeliverer {
  const send = options.fetch ?? fetch;

  const requestTokens = (parameters: Record<string, string>) =>
    requestOAuthTokens(
      send,
      "Microsoft",
      `${AUTHORITY_URL}/token`,
      {
        client_id: options.clientId,
        client_secret: options.clientSecret,
        scope: MICROSOFT_SCOPES.join(" "),
        ...parameters,
      },
      REVOKED_GRANT_ERRORS,
    );

  return {
    name: "microsoft",
    channel: "email",
    displayName: "Microsoft",
    start({ state, codeChallenge, redirectUri }) {
      const url = new URL(`${AUTHORITY_URL}/authorize`);

      url.search = new URLSearchParams({
        client_id: options.clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        response_mode: "query",
        scope: MICROSOFT_SCOPES.join(" "),
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        prompt: "select_account",
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
        throw new Error("Microsoft did not return a refresh token");
      }

      const claims = readIdTokenClaims(response.id_token, idTokenClaimsSchema, "Microsoft");
      const label = await readOutlookAddress(send, response.access_token);
      const syncCursor = await readOutlookPosition(send, response.access_token).catch(() => null);

      return {
        providerAccountId: `${claims.tid}:${claims.oid}`,
        label,
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
      return fetchNewOutlookMail(send, accessToken, cursor);
    },
    readReplyContext(accessToken, providerMessageId) {
      return readOutlookReplyContext(send, accessToken, providerMessageId);
    },
    createDraft(accessToken, reply) {
      return createOutlookDraft(send, accessToken, reply);
    },
    sendReply(accessToken, reply) {
      return sendOutlookReply(send, accessToken, reply);
    },
    async revoke() {},
  };
}
