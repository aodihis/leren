import type { InboundEmail } from "@leren/inbox";

/** The names of the providers that exist. */
export const CHANNEL_PROVIDER_NAMES = ["google", "mailpit"] as const;

export type ChannelProviderName = (typeof CHANNEL_PROVIDER_NAMES)[number];

/** The tokens that grant access to an account. */
export type ProviderTokens = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
};

/** An account that a provider has identified. */
export type AuthorisedAccount = {
  providerAccountId: string;
  label: string;
  tokens: ProviderTokens | null;
  syncCursor?: string | null;
};

/** What starting a connection produces. */
export type ConnectStart =
  | { kind: "redirect"; url: string }
  | { kind: "connected"; account: AuthorisedAccount };

/** Thrown when a refresh token is no longer honoured. */
export class InvalidGrantError extends Error {
  constructor(message = "The provider rejected the refresh token") {
    super(message);
    this.name = "InvalidGrantError";
  }
}

/** An adapter for one provider of channel accounts. */
export interface ChannelProvider {
  readonly name: ChannelProviderName;
  readonly channel: "email";
  /** The name shown to users, such as "Google". */
  readonly displayName: string;
  /** Starts a connection for a user. */
  start(input: {
    state: string;
    codeChallenge: string;
    redirectUri: string;
    userEmail: string;
  }): ConnectStart;
  /** Exchanges an authorization code for tokens. */
  finish(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<AuthorisedAccount>;
  /** Returns new tokens. */
  refresh(tokens: ProviderTokens): Promise<ProviderTokens>;
  /** Revokes the tokens at the provider. */
  revoke(tokens: ProviderTokens): Promise<void>;
}

/** An email as a provider reads it. */
export type FetchedEmail = Omit<
  InboundEmail,
  "userId" | "channelAccountId" | "channel" | "provider"
>;

/** What one read of a mailbox returns. */
export type FetchResult = {
  emails: FetchedEmail[];
  cursor: string;
  baseline: boolean;
  unreadable: string[];
};

/** A provider that can read new mail. */
export interface EmailProvider extends ChannelProvider {
  fetchNewMail(accessToken: string, cursor: string | null): Promise<FetchResult>;
}

/** Whether `provider` can read mail from a mailbox. */
export function isEmailProvider(provider: ChannelProvider): provider is EmailProvider {
  return "fetchNewMail" in provider && typeof provider.fetchNewMail === "function";
}

/** A reply that a provider delivers. */
export type OutboundReply = {
  to: string;
  subject: string;
  body: string;
  threadId: string | null;
  messageId: string;
  inReplyTo: string | null;
  references: string | null;
};

/** The headers of the original that a reply needs. */
export type ReplyContext = {
  messageId: string | null;
  references: string | null;
  replyTo: string | null;
};

/** What a provider answered to a draft or send. */
export type DeliveryReceipt = { id: string; response: unknown };

/** Thrown when a delivery never reached the provider. */
export class DeliveryNotSentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeliveryNotSentError";
  }
}

/** The reasons a provider refuses a delivery. */
export type DeliveryRejection = "forbidden" | "rejected";

/** Thrown when the provider refuses the delivery. */
export class DeliveryRejectedError extends Error {
  constructor(
    readonly reason: DeliveryRejection,
    message: string,
  ) {
    super(message);
    this.name = "DeliveryRejectedError";
  }
}

/** A provider that can put a reply into a mailbox. */
export interface EmailSender extends ChannelProvider {
  readReplyContext(accessToken: string, providerMessageId: string): Promise<ReplyContext>;
  createDraft(accessToken: string, reply: OutboundReply): Promise<DeliveryReceipt>;
  sendReply(accessToken: string, reply: OutboundReply): Promise<DeliveryReceipt>;
}

/** Whether `provider` can deliver a reply. */
export function isEmailSender(provider: ChannelProvider): provider is EmailSender {
  return "sendReply" in provider && typeof provider.sendReply === "function";
}
