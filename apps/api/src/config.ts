import { channelProviderEnvShape, checkChannelProviderEnv } from "@leren/channels";
import { checkConnectorEnv, connectorEnvShape } from "@leren/connectors";
import { z } from "zod";

const configSchema = z
  .object({
    DATABASE_URL: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
    MCP_SESSION_SECRET: z.string().min(32, "MCP_SESSION_SECRET must be at least 32 characters"),
    VECTOR_STORE_URL: z.string().min(1),
    VECTOR_STORE_API_KEY: z.string().optional(),
    API_URL: z.url().default("http://localhost:3000"),
    PLATFORM_URL: z.url().default("http://localhost:5173"),
    RABBITMQ_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),
    SMTP_URL: z.string().min(1),
    EMAIL_FROM: z.string().min(1).default("Leren <no-reply@leren.local>"),
    ASSISTANT_MODEL: z.string().optional(),
    PORT: z.coerce.number().int().positive().default(3000),
    NODE_ENV: z.string().optional(),
    ...channelProviderEnvShape,
    ...connectorEnvShape,
  })
  .superRefine((config, context) => {
    checkChannelProviderEnv(config, (variable, message) =>
      context.addIssue({ code: "custom", path: [variable], message }),
    );

    checkConnectorEnv(config, (variable, message) =>
      context.addIssue({ code: "custom", path: [variable], message }),
    );
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
