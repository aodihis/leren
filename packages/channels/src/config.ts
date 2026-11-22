import { z } from "zod";

import { parseEncryptionKey } from "./crypto";
import { CHANNEL_PROVIDER_NAMES } from "./providers/types";

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
 * The environment variables that choose and configure the channel providers (decision 0038). The
 * API and the worker add them to their own schema and call `checkChannelProviderEnv` on the
 * result, so both fail at startup under the same conditions.
 */
export const channelProviderEnvShape = {
  CHANNEL_PROVIDERS: providerList,
  CHANNEL_TOKEN_ENCRYPTION_KEY: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
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

  if (!config.CHANNEL_PROVIDERS.includes("google")) {
    return;
  }

  for (const name of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"] as const) {
    if (!config[name]) {
      problem(name, `${name} is required when the google provider is enabled`);
    }
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
