import type { InboundEmail } from "@leren/inbox";

import type { SuggestedSettings } from "./imap-discovery";

/** The names of the providers that exist. `CHANNEL_PROVIDERS` selects which of them are enabled. */
export const CHANNEL_PROVIDER_NAMES = ["google", "microsoft", "zoho", "imap", "mailpit"] as const;

export type ChannelProviderName = (typeof CHANNEL_PROVIDER_NAMES)[number];

/** The tokens that grant access to an account. Times are ISO 8601 instants. */
export type ProviderTokens = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
};

/**
 * An account that a provider has identified. `providerAccountId` never changes, so it is never an
 * address. `tokens` is null for a provider without credentials. `syncCursor` is the mailbox
 * position at authorisation, so only later mail is read, and it is absent when the provider cannot
 * determine it.
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

/** What every adapter of a provider of channel accounts has, however it connects (decision 0038). */
interface ProviderBase {
  readonly name: ChannelProviderName;
  readonly channel: "email";
  /** The name shown to users, such as "Google". */
  readonly displayName: string;
  /** Returns new tokens. Throws `InvalidGrantError` when the refresh token is no longer valid. */
  refresh(tokens: ProviderTokens): Promise<ProviderTokens>;
  /** Revokes the tokens at the provider. */
  revoke(tokens: ProviderTokens): Promise<void>;
}

/**
 * A provider that connects an account by sending the user to the provider's consent page, or at
 * once when it has no consent step (decision 0062).
 */
export interface RedirectProvider extends ProviderBase {
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
}

/**
 * Why signing in to a mail server failed: the server refused the credentials, could not be reached,
 * could not set up an encrypted connection, or is at an address that the product does not connect
 * to.
 */
export type SignInFailure =
  | "authentication_failed"
  | "server_unreachable"
  | "encryption_failed"
  | "host_not_allowed";

/** Thrown by `signIn` when the account cannot be connected for a reason the user can act on. */
export class SignInError extends Error {
  constructor(
    readonly reason: SignInFailure,
    message: string,
  ) {
    super(message);
    this.name = "SignInError";
  }
}

/**
 * A provider that connects an account by signing in to its mail server with the user's settings and
 * password (decision 0062). `signIn` validates `settings`, throws `SignInError` on failure, and
 * returns the account only after success. The optional `suggestSettings` suggests an address's
 * servers, or returns null.
 */
export interface SignInProvider extends ProviderBase {
  signIn(settings: unknown): Promise<AuthorisedAccount>;
  suggestSettings?(address: string): Promise<SuggestedSettings | null>;
}

/**
 * An adapter for one provider of channel accounts (decision 0038). The API calls these methods and
 * knows nothing else about the provider. Adapters never log tokens or passwords.
 */
export type ChannelProvider = RedirectProvider | SignInProvider;

/** Whether `provider` connects an account by signing in to a mail server. */
export function isSignInProvider(provider: ChannelProvider): provider is SignInProvider {
  return "signIn" in provider && typeof provider.signIn === "function";
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
 * What one read of a mailbox returns. `cursor` is opaque to everything except the provider that
 * made it. `baseline` means the given cursor was missing or too old, so there are no emails and
 * `cursor` is the current position. `unreadable` lists messages that a retry cannot convert.
 */
export type FetchResult = {
  emails: FetchedEmail[];
  cursor: string;
  baseline: boolean;
  unreadable: string[];
};

/**
 * The capability of reading new mail from a mailbox (decision 0041). `fetchNewMail` returns the
 * emails that arrived after `cursor`, or the current position for a null cursor. It skips messages
 * that no longer exist, throws `InvalidGrantError` on refused credentials, and throws on any other
 * failure.
 */
export type MailReader = {
  fetchNewMail(accessToken: string, cursor: string | null): Promise<FetchResult>;
};

/** A provider that can read new mail from a mailbox. */
export type EmailProvider = ChannelProvider & MailReader;

/** Whether `provider` can read mail from a mailbox. */
export function isEmailProvider(provider: ChannelProvider): provider is EmailProvider {
  return "fetchNewMail" in provider && typeof provider.fetchNewMail === "function";
}

/**
 * A reply that a provider delivers to the single recipient (decision 0046). `providerMessageId`
 * identifies the original, `messageId` is the reply's `Message-ID`, and `inReplyTo`, `references`
 * and `threadId` thread it with the original. Each provider uses the fields that its API needs.
 */
export type OutboundReply = {
  to: string;
  subject: string;
  body: string;
  providerMessageId: string;
  threadId: string | null;
  messageId: string;
  inReplyTo: string | null;
  references: string | null;
};

/** The headers of an original message that a reply needs in order to join its conversation. */
export type ReplyContext = {
  messageId: string | null;
  references: string | null;
  replyTo: string | null;
};

/**
 * What a provider answered when it created a draft or sent a mail. `id` is the id of the draft or of
 * the sent message, and `response` is the whole answer, kept for investigation.
 */
export type DeliveryReceipt = { id: string; response: unknown };

/**
 * Thrown when a delivery is known not to have reached the provider, because the connection was
 * refused, the name was not found, the provider answered that the credentials are not valid, or
 * the provider answered that the rate limit was reached. The same reply may be delivered again.
 */
export class DeliveryNotSentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeliveryNotSentError";
  }
}

/**
 * The reasons a provider can give for refusing a delivery that a retry cannot fix. `forbidden`
 * means that the account lacks a permission, and `rejected` means that the provider did not accept
 * the reply.
 */
export type DeliveryRejection = "forbidden" | "rejected";

/** Thrown when the provider answered that it refuses the delivery. */
export class DeliveryRejectedError extends Error {
  constructor(
    readonly reason: DeliveryRejection,
    message: string,
  ) {
    super(message);
    this.name = "DeliveryRejectedError";
  }
}

/**
 * The capability of putting a reply into a mailbox (decision 0046). Delivery calls throw
 * `DeliveryNotSentError` or `DeliveryRejectedError` when the outcome is known, and any other error
 * when it is not. `InvalidGrantError` means the mailbox refused the credentials and nothing was
 * delivered.
 */
export type MailDeliverer = {
  readReplyContext(accessToken: string, providerMessageId: string): Promise<ReplyContext>;
  createDraft(accessToken: string, reply: OutboundReply): Promise<DeliveryReceipt>;
  sendReply(accessToken: string, reply: OutboundReply): Promise<DeliveryReceipt>;
};

/** A provider that can put a reply into a mailbox. */
export type EmailSender = ChannelProvider & MailDeliverer;

/** Whether `provider` can deliver a reply. */
export function isEmailSender(provider: ChannelProvider): provider is EmailSender {
  return "sendReply" in provider && typeof provider.sendReply === "function";
}
