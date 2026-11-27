import { refreshTokens, requestOAuthTokens, tokenExpiry } from "./oauth";
import type { MailDeliverer, MailReader, RedirectProvider } from "./types";
import {
  createZohoDraft,
  fetchNewZohoMail,
  readZohoAccount,
  readZohoPosition,
  readZohoReplyContext,
  sendZohoReply,
} from "./zoho-mail";

/**
 * The domains of the Zoho data centers, keyed by the value of `ZOHO_REGION`. A Zoho account lives
 * in one data center, and its tokens are served at `accounts.<domain>` and its mail at
 * `mail.<domain>`.
 */
export const ZOHO_REGIONS = {
  com: "zoho.com",
  eu: "zoho.eu",
  in: "zoho.in",
  "com.au": "zoho.com.au",
  jp: "zoho.jp",
  ca: "zohocloud.ca",
  uk: "zoho.uk",
  sa: "zoho.sa",
} as const;

export type ZohoRegion = keyof typeof ZOHO_REGIONS;

/**
 * The scopes of the Zoho provider. They let the product find the mailbox and its inbox, read mail,
 * and create drafts and replies (decision 0061). Zoho separates scopes with commas.
 */
export const ZOHO_SCOPES = [
  "ZohoMail.accounts.READ",
  "ZohoMail.folders.READ",
  "ZohoMail.messages.READ",
  "ZohoMail.messages.CREATE",
] as const;

/** The token error with which Zoho answers a refresh token that it no longer honours. */
const REVOKED_GRANT_ERRORS = ["invalid_code"];

export type ZohoProviderOptions = {
  clientId: string;
  clientSecret: string;
  region: ZohoRegion;
  /** Replaces the global `fetch`, so tests can run without the network. */
  fetch?: typeof fetch;
};

/**
 * The Zoho provider for the `email` channel (decision 0061). It connects a Zoho Mail mailbox in the
 * configured data center with the authorization code flow, PKCE and offline access. Zoho issues no
 * ID token, so the account is identified and labelled from the Zoho Mail account of the token.
 */
export function createZohoProvider(
  options: ZohoProviderOptions,
): RedirectProvider & MailReader & MailDeliverer {
  const send = options.fetch ?? fetch;
  const domain = ZOHO_REGIONS[options.region];
  const accounts = `https://accounts.${domain}`;
  const mail = `https://mail.${domain}`;

  const requestTokens = (parameters: Record<string, string>) =>
    requestOAuthTokens(
      send,
      "Zoho",
      `${accounts}/oauth/v2/token`,
      { client_id: options.clientId, client_secret: options.clientSecret, ...parameters },
      REVOKED_GRANT_ERRORS,
    );

  return {
    name: "zoho",
    channel: "email",
    displayName: "Zoho Mail",
    start({ state, codeChallenge, redirectUri }) {
      const url = new URL(`${accounts}/oauth/v2/auth`);

      url.search = new URLSearchParams({
        client_id: options.clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: ZOHO_SCOPES.join(","),
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
        throw new Error("Zoho did not return a refresh token");
      }

      const account = await readZohoAccount(send, mail, response.access_token);

      const syncCursor = await readZohoPosition(
        send,
        mail,
        response.access_token,
        account.accountId,
      ).catch(() => null);

      return {
        providerAccountId: account.zuid
          ? `${account.zuid}:${account.accountId}`
          : account.accountId,
        label: account.address,
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
    async revoke(tokens) {
      const response = await send(`${accounts}/oauth/v2/revoke/token`, {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(`${options.clientId}:${options.clientSecret}`).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          token: tokens.refreshToken ?? tokens.accessToken,
          token_type: tokens.refreshToken ? "refresh_token" : "access_token",
        }),
      });

      if (!response.ok) {
        throw new Error(`Zoho token revocation failed with status ${response.status}`);
      }
    },
    fetchNewMail(accessToken, cursor) {
      return fetchNewZohoMail(send, mail, accessToken, cursor);
    },
    readReplyContext(accessToken, providerMessageId) {
      return readZohoReplyContext(send, mail, accessToken, providerMessageId);
    },
    createDraft(accessToken, reply) {
      return createZohoDraft(send, mail, accessToken, reply);
    },
    sendReply(accessToken, reply) {
      return sendZohoReply(send, mail, accessToken, reply);
    },
  };
}
