# 0061. Zoho Mail as a channel provider

- Status: Accepted
- Date: 2026-11-26
- Affects: packages/channels, apps/api, apps/worker, .env.example, docs/overview/README.md

## Context

Zoho Mail serves many small and medium businesses, and its mailboxes are reached through a REST API with OAuth, like those of the Google and Microsoft providers ([0038](0038-channel-providers-and-google-oauth.md), [0060](0060-microsoft-provider.md)). Zoho publishes no SDK for Zoho Mail, only an OpenAPI description of the REST API. Zoho also differs from the other providers in three ways: an account lives in one of several data centers, the token endpoint issues no ID token, and the mail API has no history of changes from which a cursor could resume.

## Decision

- The provider's name is `zoho`, its channel is `email` and its display name is "Zoho Mail". Its variables are `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET` and `ZOHO_REGION`, and `CHANNEL_TOKEN_ENCRYPTION_KEY` is required when it is enabled. The redirect URI is `${API_URL}/api/channel-accounts/zoho/callback`.
- The adapter calls the REST API with `fetch`, as the other adapters do, because there is no official SDK.
- `ZOHO_REGION` chooses one data center for the deployment: `com`, `eu`, `in`, `com.au`, `jp`, `ca`, `uk` or `sa`, and `com` by default. Authorization, tokens and mail all use the hosts of that data center. An account in another data center cannot connect.
- The adapter uses the authorization code flow with PKCE, `access_type=offline` and `prompt=consent`. The scopes are `ZohoMail.accounts.READ`, `ZohoMail.folders.READ`, `ZohoMail.messages.READ` and `ZohoMail.messages.CREATE`, separated by commas. Every request to the mail API carries the header `Authorization: Zoho-oauthtoken <token>`.
- Zoho issues no ID token, so the adapter reads the Zoho Mail account of the token from `/api/accounts` and takes the first account of the type `ZOHO_ACCOUNT`. The provider's identifier of the account is its `zuid` and its `accountId`, joined by a colon, and the display label is its primary address.
- Zoho keeps the refresh token on a refresh. The token endpoint can report an error with the status 200, so the adapter reads the error from every answer. The error `invalid_code` throws `InvalidGrantError`, so the account becomes `revoked`. Disconnecting revokes the refresh token at `/oauth/v2/revoke/token` with the client credentials.
- The cursor is built by the adapter, because Zoho has none. It holds the account id, the id of the inbox, the receive time of the newest message seen, and the ids of the messages received at that time. A poll lists the inbox newest first, 200 messages to a page, until it reaches a message older than the cursor, and records every message received after it, oldest first. A poll reads at most five pages, and older new mail is then a gap. Connecting an account stores the position of the newest message in the inbox, so only mail that arrives afterwards is read, as decision 0041 requires. A cursor that cannot be read is replaced by the current position, which the poll records as a baseline.
- The inbox is the folder of the type `Inbox` whose path is `/Inbox`, because a folder that a user creates can also have the type `Inbox`.
- The adapter reads each new message's headers and content. The sender, the recipients and the copied recipients come from the headers, `isReply` and `isBulk` follow the rules of the other providers, and the HTML content is converted to plain text. The provider message id is the folder id and the message id, joined by a colon, because reading the headers of a message needs both.
- A draft is saved with `mode` `draft`, `inReplyTo` and `refHeader` set from the headers of the original, which is how Zoho joins a draft to the conversation. A reply in `send` mode is sent with the reply action on the original, which joins it to the conversation. Both use the account's primary address as the sender and a plain-text body.
- The id of a saved draft or a sent reply is `data.messageId` of Zoho's answer. A successful answer without it has an unknown outcome, because decision 0046 completes a delivery only when the provider's id is stored.
- A delivery request that does not reach Zoho, that Zoho answers with status 401 or 429, or that fails while the account is read before anything is delivered, throws `DeliveryNotSentError`. An answer with status 403 throws `DeliveryRejectedError` with the reason `forbidden`, and any other answer from 400 to 499 throws it with the reason `rejected`. Any other failure has an unknown outcome, as decision 0046 describes.

## Consequences

- A deployment serves the accounts of one Zoho data center. Serving several needs the callback to read the `accounts-server` that Zoho adds to the redirect, and the account to store its data center.
- A poll costs one request per page of the inbox and two per new message. Zoho limits a refresh token to ten access tokens in ten minutes, which hourly tokens do not reach.
- Mail that is moved into the inbox after newer mail has arrived is not read, because it is older than the cursor.
- A message that is moved out of its folder before its reply is delivered cannot be read again by its id, so the delivery fails.
- If Zoho answers a delivery without the message id, the delivery ends as unknown although the mail may have been sent.
- The shape of the reply and draft answers and the value of the reply action follow Zoho's documentation and have not been checked against a live mailbox.
