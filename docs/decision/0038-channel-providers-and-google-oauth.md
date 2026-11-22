# 0038. Channel providers, Google as the first provider and token encryption

- Status: Accepted
- Date: 2026-11-22
- Affects: packages/db, apps/api, apps/platform, .env.example, docs/overview/README.md, docs/plans/0001-auto-reply-roadmap.md

## Context

[0021](0021-channels-and-channel-accounts.md) says that a user connects a channel account with OAuth and leaves the provider, its scopes and the handling of tokens to the decision that builds the connection. The product reaches mailboxes through providers that differ in their OAuth endpoints, scopes and message APIs. More providers will follow the first one, and local development and tests need a mailbox that does not depend on an external service.

## Decision

- A **channel provider** is an adapter in the codebase that implements one interface. The interface covers building the authorization URL, exchanging a code for tokens, refreshing tokens, revoking tokens, and identifying the account that was authorised. The message operations of an email provider extend it in the feature that ingests email. Providers are not loaded from disk at runtime, because they handle client secrets and mailbox tokens.
- A registry maps a provider name to its adapter. The environment variable `CHANNEL_PROVIDERS` holds the names of the enabled providers, separated by commas. Its default is empty, so no account can be connected until a provider is enabled.
- The API reads `CHANNEL_PROVIDERS` with its other configuration and fails at startup when a name is unknown, or when an enabled provider is missing a required variable. A provider that is not enabled needs none of its variables.
- Google is the first provider. Its name is `google`, its channel is `email`, and its variables are `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. The redirect URI is `${API_URL}/api/channel-accounts/google/callback`. Google serves personal Gmail and Google Workspace mailboxes through the same Gmail API. Microsoft Graph is the next provider and is not part of this decision.
- The Google scopes are `openid`, `email`, `https://www.googleapis.com/auth/gmail.readonly` and `https://www.googleapis.com/auth/gmail.send`. The first two identify the account. The others let the product read mail and send approved replies. The request uses `access_type=offline` and `prompt=consent`, so that Google returns a refresh token. The provider's identifier of the account is the `sub` claim of the ID token, because an address can change. The display label is the address.
- `mailpit` is a provider for development and tests only. It has no OAuth step and no credentials, and connecting it creates an active account at once. The API fails at startup when `mailpit` is enabled and `NODE_ENV` is `production`. It exists so that the email pipeline can be exercised against the Mailpit service in `docker-compose.dev.yml`.
- `channel_accounts` has the columns `id`, `user_id`, `channel`, `provider`, `provider_account_id`, `label`, `credentials`, `status`, `created_at` and `updated_at`. `credentials` is encrypted text. `status` is `active` or `revoked`. The table is unique on `channel`, `provider` and `provider_account_id`, as decided in 0021.
- An account is **usable** when its status is `active` and its provider is enabled. Disabling a provider does not change any row. Its accounts stop being usable, the gate skips them, and they become usable again when the provider is enabled again.
- `reply_conditions` gets a nullable `channel_account_id` that references `channel_accounts` and is set to null when the account is deleted. The API rejects a value that names an account of another user, or an account whose channel differs from the channel of the row.
- The API allows one account on the `email` channel for each user and answers a second connection with a conflict. Connecting a provider account that belongs to another user is also a conflict. Connecting the account again for the same user replaces its credentials and makes it active.
- The routes are `GET /api/channel-accounts` for the user's accounts and the enabled providers, `POST /api/channel-accounts/:provider/connect` that returns the authorization URL, `GET /api/channel-accounts/:provider/callback` that finishes the connection, and `DELETE /api/channel-accounts/:id` that disconnects. An unknown or disabled provider is answered with not found.
- The connect route creates a random `state` value and a PKCE code verifier. Both are kept, together with the user and the provider, in a signed, `httpOnly` cookie that expires after ten minutes. The callback accepts a request only when the cookie is present, the `state` matches, the signed-in user is the user in the cookie, and the code exchange carries the verifier. The cookie is cleared on every callback, so a `state` value is used once.
- Tokens are encrypted with AES-256-GCM using the key in `CHANNEL_TOKEN_ENCRYPTION_KEY`, which is 32 random bytes encoded as base64. The stored text has a version prefix, the nonce, the authentication tag and the ciphertext. The id of the account is the additional authenticated data, so a value copied to another row does not decrypt. The key is required when an enabled provider stores tokens, and it is never logged.
- An access token is refreshed when it is used and has expired. When the provider answers that the refresh token is no longer valid, the account becomes `revoked`. Disconnecting revokes the tokens at the provider and then deletes the row. A failure of the revocation call does not keep the row.

## Consequences

- A provider is added with one adapter and one name in the registry. The routes, the table and the screens do not change.
- Changing `CHANNEL_PROVIDERS` needs a restart and no migration. There is no runtime switch in the interface.
- Rotating `CHANNEL_TOKEN_ENCRYPTION_KEY` needs a re-encryption of the stored credentials. The version prefix leaves room for a second key, and no rotation is built now.
- Deleting an account leaves the playbooks that named it with no account on that channel. They listen on nothing for that channel until the user chooses another account.
- `gmail.readonly` is a restricted Google scope. While the Google project is in testing mode, only listed test users can connect and their refresh tokens expire after seven days. Serving other users needs Google's app verification, which is outside this decision.
- 0021 says that the first version allows one email account for each user and that the API enforces it. This decision restates that limit for the routes above and adds no schema constraint.
- Mailpit does not exercise the OAuth flow. Tests of the state value, PKCE, refresh and revocation use a fake provider that implements the same interface.
