import { z } from "zod";

import { parseEncryptionKey } from "./crypto";
import { PROVIDER_DEFINITIONS } from "./providers";
import { CHANNEL_PROVIDER_NAMES } from "./providers/types";
import { ZOHO_REGIONS } from "./providers/zoho";
import type { ZohoRegion } from "./providers/zoho";

const providerList = z
  .string()
  .default("")
  .transform((value) =>
    value
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name !== ""),
  )
  .pipe(z.array(z.enum(CHANNEL_PROVIDER_NAMES)));

/**
 * The environment variables that choose and configure the channel providers (decisions 0038, 0060
 * and 0061). The API and the worker add them to their own schema and call `checkChannelProviderEnv` on
 * the result, so both fail at startup under the same conditions.
 */
export const channelProviderEnvShape = {
  CHANNEL_PROVIDERS: providerList,
  CHANNEL_TOKEN_ENCRYPTION_KEY: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  MICROSOFT_CLIENT_ID: z.string().min(1).optional(),
  MICROSOFT_CLIENT_SECRET: z.string().min(1).optional(),
  ZOHO_CLIENT_ID: z.string().min(1).optional(),
  ZOHO_CLIENT_SECRET: z.string().min(1).optional(),
  ZOHO_REGION: z.enum(Object.keys(ZOHO_REGIONS) as [ZohoRegion, ...ZohoRegion[]]).default("com"),
};

export type ChannelProviderEnv = z.infer<z.ZodObject<typeof channelProviderEnvShape>>;

/**
 * Reports a problem for every variable that an enabled provider needs and that is missing or
 * invalid. `mailpit` is refused when `NODE_ENV` is `production`. A provider that is not enabled
 * needs none of its variables.
 */
export function checkChannelProviderEnv(
  config: ChannelProviderEnv & { NODE_ENV?: string | undefined },
  problem: (variable: string, message: string) => void,
): void {
  if (config.CHANNEL_PROVIDERS.includes("mailpit") && config.NODE_ENV === "production") {
    problem(
      "CHANNEL_PROVIDERS",
      "mailpit is for development and tests and cannot run in production",
    );
  }

  for (const name of config.CHANNEL_PROVIDERS) {
    for (const variable of PROVIDER_DEFINITIONS[name].variables) {
      if (!config[variable]) {
        problem(variable, `${variable} is required when the ${name} provider is enabled`);
      }
    }
  }

  if (!config.CHANNEL_PROVIDERS.some((name) => PROVIDER_DEFINITIONS[name].storesTokens)) {
    return;
  }

  try {
    parseEncryptionKey(config.CHANNEL_TOKEN_ENCRYPTION_KEY ?? "");
  } catch {
    problem(
      "CHANNEL_TOKEN_ENCRYPTION_KEY",
      "CHANNEL_TOKEN_ENCRYPTION_KEY must be 32 bytes encoded as base64 when a provider stores tokens",
    );
  }
}
