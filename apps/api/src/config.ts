import { z } from "zod";

import { parseEncryptionKey } from "./modules/channel-accounts/crypto";
import { CHANNEL_PROVIDER_NAMES } from "./modules/channel-accounts/providers/types";

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

const configSchema = z
  .object({
    DATABASE_URL: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
    MCP_SESSION_SECRET: z.string().min(32, "MCP_SESSION_SECRET must be at least 32 characters"),
    VECTOR_STORE_URL: z.string().min(1),
    API_URL: z.url().default("http://localhost:3000"),
    PLATFORM_URL: z.url().default("http://localhost:5173"),
    RABBITMQ_URL: z.string().min(1),
    SMTP_URL: z.string().min(1),
    EMAIL_FROM: z.string().min(1).default("Leren <no-reply@leren.local>"),
    ASSISTANT_MODEL: z.string().optional(),
    PORT: z.coerce.number().int().positive().default(3000),
    NODE_ENV: z.string().optional(),
    CHANNEL_PROVIDERS: providerList,
    CHANNEL_TOKEN_ENCRYPTION_KEY: z.string().optional(),
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  })
  .superRefine((config, context) => {
    const problem = (path: string, message: string) =>
      context.addIssue({ code: "custom", path: [path], message });

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
  });

export type Config = z.infer<typeof configSchema>;

/**
 * Reads and validates the API's configuration from environment variables. Throws one error that
 * lists every missing or invalid variable, so a misconfigured process fails at startup.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = configSchema.safeParse(env);

  if (!result.success) {
    const problems = result.error.issues.map(
      (issue) => `${issue.path.join(".")}: ${issue.message}`,
    );

    throw new Error(`Invalid API configuration:\n${problems.join("\n")}`);
  }

  return result.data;
}
