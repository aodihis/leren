import { z } from "zod";

const configSchema = z.object({
  DATABASE_URL: z.string().min(1),
  VECTOR_STORE_URL: z.string().min(1),
  RABBITMQ_URL: z.string().min(1),
  EMBEDDING_BASE_URL: z.url().default("https://openrouter.ai/api/v1"),
  EMBEDDING_API_KEY: z.string().min(1),
  EMBEDDING_MODEL: z.string().min(1).default("openai/text-embedding-3-small"),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(1536),
  KNOWLEDGE_DRIFT_INTERVAL_MINUTES: z.coerce.number().positive().default(10),
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
