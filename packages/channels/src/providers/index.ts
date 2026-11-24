import { createGoogleProvider } from "./google";
import { createMailpitProvider } from "./mailpit";
import { CHANNEL_PROVIDER_NAMES } from "./types";
import type { ChannelProvider, ChannelProviderName } from "./types";

export { CHANNEL_PROVIDER_NAMES } from "./types";

export type { ChannelProvider, ChannelProviderName } from "./types";

/** The settings that the providers need. */
export type ProviderSettings = {
  CHANNEL_PROVIDERS: readonly ChannelProviderName[];
  GOOGLE_CLIENT_ID?: string | undefined;
  GOOGLE_CLIENT_SECRET?: string | undefined;
};

/** Builds the adapter of every enabled provider. */
export function createChannelProviders(
  settings: ProviderSettings,
): ReadonlyMap<string, ChannelProvider> {
  const providers = new Map<string, ChannelProvider>();

  for (const name of CHANNEL_PROVIDER_NAMES) {
    if (!settings.CHANNEL_PROVIDERS.includes(name)) {
      continue;
    }

    if (name === "google") {
      providers.set(
        name,
        createGoogleProvider({
          clientId: settings.GOOGLE_CLIENT_ID ?? "",
          clientSecret: settings.GOOGLE_CLIENT_SECRET ?? "",
        }),
      );
    } else {
      providers.set(name, createMailpitProvider());
    }
  }

  return providers;
}
