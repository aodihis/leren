export { channelProviderEnvShape, checkChannelProviderEnv } from "./config";

export { encryptCredentials, parseEncryptionKey } from "./crypto";

export { CHANNEL_PROVIDER_NAMES, InvalidGrantError, isEmailProvider } from "./providers/types";

export type {
  AuthorisedAccount,
  ChannelProvider,
  ChannelProviderName,
  ConnectStart,
  EmailProvider,
  FetchResult,
  ProviderTokens,
} from "./providers/types";

export { createChannelProviders } from "./providers";

export { getAccessToken, readTokens, requireKey } from "./tokens";

export type { ChannelAccountsDependencies } from "./tokens";
