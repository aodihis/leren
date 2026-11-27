export { channelProviderEnvShape, checkChannelProviderEnv } from "./config";

export { decryptCredentials, encryptCredentials, parseEncryptionKey } from "./crypto";

export {
  CHANNEL_PROVIDER_NAMES,
  DeliveryNotSentError,
  DeliveryRejectedError,
  InvalidGrantError,
  SignInError,
  isEmailProvider,
  isEmailSender,
  isSignInProvider,
} from "./providers/types";

export type {
  AuthorisedAccount,
  ChannelProvider,
  ChannelProviderName,
  ConnectStart,
  DeliveryReceipt,
  EmailProvider,
  EmailSender,
  FetchResult,
  MailDeliverer,
  MailReader,
  OutboundReply,
  ProviderTokens,
  RedirectProvider,
  ReplyContext,
  SignInFailure,
  SignInProvider,
} from "./providers/types";

export { createChannelProviders } from "./providers";

export { imapSettingsInputSchema } from "./providers/imap-settings";

export type { SuggestedSettings } from "./providers/imap-discovery";

export {
  getAccessToken,
  markAccountRevoked,
  readTokens,
  requireKey,
  revokeOnRefusedCredentials,
} from "./tokens";

export type { ChannelAccountsDependencies } from "./tokens";
