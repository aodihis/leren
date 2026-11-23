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

/**
 * A reply that a provider delivers (decision 0046). `messageId` is the `Message-ID` header that the
 * deliverer builds, `inReplyTo` and `references` come from the headers of the original, and
 * `threadId` puts the reply into the conversation of the original. The reply has one recipient.
 */
export type OutboundReply = {
  to: string;
  subject: string;
  body: string;
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
 * A provider that can put a reply into a mailbox (decision 0046). `readReplyContext` reads the
 * headers of the original, and `createDraft` and `sendReply` deliver the same reply. Delivery calls
 * throw `DeliveryNotSentError` or `DeliveryRejectedError` when the outcome is known, and any other
 * error when it is not.
 */
export interface EmailSender extends ChannelProvider {
  readReplyContext(accessToken: string, providerMessageId: string): Promise<ReplyContext>;
  createDraft(accessToken: string, reply: OutboundReply): Promise<DeliveryReceipt>;
  sendReply(accessToken: string, reply: OutboundReply): Promise<DeliveryReceipt>;
}

/** Whether `provider` can deliver a reply. */
export function isEmailSender(provider: ChannelProvider): provider is EmailSender {
  return "sendReply" in provider && typeof provider.sendReply === "function";
}
