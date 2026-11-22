import { channelProviderEnvShape, checkChannelProviderEnv } from "@leren/channels";
import { z } from "zod";

const configSchema = z
  .object({
    DATABASE_URL: z.string().min(1),
    VECTOR_STORE_URL: z.string().min(1),
    RABBITMQ_URL: z.string().min(1),
    REPLY_MODEL: z.string().optional(),
    KNOWLEDGE_DRIFT_INTERVAL_MINUTES: z.coerce.number().positive().default(10),
    EMAIL_POLL_INTERVAL_SECONDS: z.coerce.number().positive().default(60),
    NODE_ENV: z.string().optional(),
    ...channelProviderEnvShape,
  })
  .superRefine((config, context) => {
    checkChannelProviderEnv(config, (variable, message) =>
      context.addIssue({ code: "custom", path: [variable], message }),
    );
  });

export type Config = z.infer<typeof configSchema>;

/**
 * Reads and validates the worker's configuration from environment variables. Throws one error that
 * lists every missing or invalid variable, so a misconfigured process fails at startup.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = configSchema.safeParse(env);

  if (!result.success) {
    const problems = result.error.issues.map(
      (issue) => `${issue.path.join(".")}: ${issue.message}`,
    );

    throw new Error(`Invalid worker configuration:\n${problems.join("\n")}`);
  }

  return result.data;
}
