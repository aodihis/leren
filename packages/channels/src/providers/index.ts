import { createGoogleProvider } from "./google";
import { createImapProvider } from "./imap";
import { createMailpitProvider } from "./mailpit";
import { createMicrosoftProvider } from "./microsoft";
import { CHANNEL_PROVIDER_NAMES } from "./types";
import type { ChannelProvider, ChannelProviderName } from "./types";
import { createZohoProvider } from "./zoho";
import type { ZohoRegion } from "./zoho";

export { CHANNEL_PROVIDER_NAMES } from "./types";

export type { ChannelProvider, ChannelProviderName } from "./types";

type ProviderVariable =
  | "GOOGLE_CLIENT_ID"
  | "GOOGLE_CLIENT_SECRET"
  | "MICROSOFT_CLIENT_ID"
  | "MICROSOFT_CLIENT_SECRET"
  | "ZOHO_CLIENT_ID"
  | "ZOHO_CLIENT_SECRET";

/** The settings that the providers need, as read from the environment. */
export type ProviderSettings = {
  CHANNEL_PROVIDERS: readonly ChannelProviderName[];
  ZOHO_REGION?: ZohoRegion | undefined;
} & Partial<Record<ProviderVariable, string | undefined>>;

/**
 * What the codebase knows about one provider: the variables it needs, whether it stores tokens,
 * which requires `CHANNEL_TOKEN_ENCRYPTION_KEY`, and how its adapter is built. `create` runs only
 * after `checkChannelProviderEnv` has found every variable present.
 */
type ProviderDefinition = {
  variables: readonly ProviderVariable[];
  storesTokens: boolean;
  create: (settings: ProviderSettings) => ChannelProvider;
};

export const PROVIDER_DEFINITIONS: Record<ChannelProviderName, ProviderDefinition> = {
  google: {
    variables: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    storesTokens: true,
    create: (settings) =>
      createGoogleProvider({
        clientId: settings.GOOGLE_CLIENT_ID ?? "",
        clientSecret: settings.GOOGLE_CLIENT_SECRET ?? "",
      }),
  },
  microsoft: {
    variables: ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"],
    storesTokens: true,
    create: (settings) =>
      createMicrosoftProvider({
        clientId: settings.MICROSOFT_CLIENT_ID ?? "",
        clientSecret: settings.MICROSOFT_CLIENT_SECRET ?? "",
      }),
  },
  zoho: {
    variables: ["ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET"],
    storesTokens: true,
    create: (settings) =>
      createZohoProvider({
        clientId: settings.ZOHO_CLIENT_ID ?? "",
        clientSecret: settings.ZOHO_CLIENT_SECRET ?? "",
        region: settings.ZOHO_REGION ?? "com",
      }),
  },
  imap: { variables: [], storesTokens: true, create: () => createImapProvider() },
  mailpit: { variables: [], storesTokens: false, create: () => createMailpitProvider() },
};

/**
 * Builds the adapter of every enabled provider, keyed by name. A provider that is not listed is
 * not built and needs none of its settings.
 */
export function createChannelProviders(
  settings: ProviderSettings,
): ReadonlyMap<string, ChannelProvider> {
  const providers = new Map<string, ChannelProvider>();

  for (const name of CHANNEL_PROVIDER_NAMES) {
    if (settings.CHANNEL_PROVIDERS.includes(name)) {
      providers.set(name, PROVIDER_DEFINITIONS[name].create(settings));
    }
  }

  return providers;
}
