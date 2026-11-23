export { channelProviderEnvShape, checkChannelProviderEnv } from "./config";

export { encryptCredentials, parseEncryptionKey } from "./crypto";

export {
  CHANNEL_PROVIDER_NAMES,
  DeliveryNotSentError,
  DeliveryRejectedError,
  InvalidGrantError,
  isEmailProvider,
  isEmailSender,
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
  OutboundReply,
  ProviderTokens,
  ReplyContext,
} from "./providers/types";

export { createChannelProviders } from "./providers";

export { getAccessToken, readTokens, requireKey } from "./tokens";

export type { ChannelAccountsDependencies } from "./tokens";
