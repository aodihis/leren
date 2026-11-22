import type { InboundEmail } from "@leren/inbox";

/** The names of the providers that exist. `CHANNEL_PROVIDERS` selects which of them are enabled. */
export const CHANNEL_PROVIDER_NAMES = ["google", "mailpit"] as const;

export type ChannelProviderName = (typeof CHANNEL_PROVIDER_NAMES)[number];

/** The tokens that grant access to an account. Times are ISO 8601 instants. */
export type ProviderTokens = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
};

/**
 * An account that a provider has identified. `providerAccountId` is stable for the life of the
 * account, so it is never an address that can change. `tokens` is null for a provider that has no
 * credentials. `syncCursor` is the position of the mailbox at the moment of authorisation, so the
 * listener reads only mail that arrives afterwards. It is absent for a provider that cannot read
 * a mailbox, or that could not determine the position.
 */
export type AuthorisedAccount = {
  providerAccountId: string;
  label: string;
  tokens: ProviderTokens | null;
  syncCursor?: string | null;
};

/** What starting a connection produces: a page to send the user to, or an account that exists already. */
export type ConnectStart =
  | { kind: "redirect"; url: string }
  | { kind: "connected"; account: AuthorisedAccount };

/**
 * Thrown by `refresh` when the provider no longer honours the refresh token, for example because
 * the user revoked access. Any other error is a failure that may succeed on a retry.
 */
export class InvalidGrantError extends Error {
  constructor(message = "The provider rejected the refresh token") {
    super(message);
    this.name = "InvalidGrantError";
  }
}

/**
 * An adapter for one provider of channel accounts (decision 0038). The API calls these methods and
 * knows nothing else about the provider. Adapters never log tokens.
 */
export interface ChannelProvider {
  readonly name: ChannelProviderName;
  readonly channel: "email";
  /** The name shown to users, such as "Google". */
  readonly displayName: string;
  /**
   * Starts a connection for a user whose sign-in address is `userEmail`. An OAuth provider returns
   * the authorization URL for the given `state` and PKCE `codeChallenge`. A provider without OAuth
   * returns the account at once.
   */
  start(input: {
    state: string;
    codeChallenge: string;
    redirectUri: string;
    userEmail: string;
  }): ConnectStart;
  /** Exchanges the authorization code for tokens and identifies the account that they belong to. */
  finish(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<AuthorisedAccount>;
  /** Returns new tokens. Throws `InvalidGrantError` when the refresh token is no longer valid. */
  refresh(tokens: ProviderTokens): Promise<ProviderTokens>;
  /** Revokes the tokens at the provider. */
  revoke(tokens: ProviderTokens): Promise<void>;
}

/**
 * An email as a provider reads it from a mailbox. The listener adds the owner, the account, the
 * channel and the provider name before it records the email (decision 0041).
 */
export type FetchedEmail = Omit<
  InboundEmail,
  "userId" | "channelAccountId" | "channel" | "provider"
>;

/**
 * What one read of a mailbox returns. `cursor` is the position to resume from, and it is opaque to
 * everything except the provider that made it. `baseline` is true when the provider could not
 * resume from the cursor it was given, because there was none or because it was too old. The
 * result then holds no emails, and `cursor` is the current position of the mailbox. `unreadable`
 * lists the ids of messages that could not be converted to an email, which a retry cannot fix, so
 * they are left out of `emails`.
 */
export type FetchResult = {
  emails: FetchedEmail[];
  cursor: string;
  baseline: boolean;
  unreadable: string[];
};

/**
 * A provider that can read new mail from a mailbox (decision 0041). `fetchNewMail` returns the
 * emails that arrived after `cursor`, and it throws on any failure other than a message that no
 * longer exists, which it skips. With a null cursor it returns the current position and no emails.
 */
export interface EmailProvider extends ChannelProvider {
  fetchNewMail(accessToken: string, cursor: string | null): Promise<FetchResult>;
}

/** Whether `provider` can read mail from a mailbox. */
export function isEmailProvider(provider: ChannelProvider): provider is EmailProvider {
  return "fetchNewMail" in provider && typeof provider.fetchNewMail === "function";
}
