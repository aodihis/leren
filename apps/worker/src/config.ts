import { channelProviderEnvShape, checkChannelProviderEnv } from "@leren/channels";
import { z } from "zod";

import { parseWorkerRoles } from "./roles";
import type { WorkerRole } from "./roles";

const DEFAULT_MCP_URL = "http://localhost:3000/mcp";

/** Reads an empty variable, such as `NAME=` in an env file, as a variable that is not set. */
function emptyAsUnset<Schema extends z.ZodType>(schema: Schema) {
  return z.preprocess((value) => (value === "" ? undefined : value), schema);
}

/**
 * Builds the schema of the configuration for a set of roles. A variable that only a role uses is
 * required only when the role is in the set (decision 0045), and it is checked together with every
 * other variable, so that one error lists everything that is missing.
 */
function createConfigSchema(roles: ReadonlySet<WorkerRole>) {
  return z
    .object({
      DATABASE_URL: z.string().min(1),
      VECTOR_STORE_URL: roles.has("indexer") ? z.string().min(1) : z.string().min(1).optional(),
      RABBITMQ_URL: z.string().min(1),
      WORKER_ROLES: z
        .string()
        .optional()
        .transform((value, context) => {
          const parsed = parseWorkerRoles(value);

          if ("error" in parsed) {
            context.addIssue({ code: "custom", message: parsed.error });

            return z.NEVER;
          }

          return parsed.roles;
        }),
      REPLY_MODEL: z.string().optional(),
      MCP_SESSION_SECRET: emptyAsUnset(z.string().min(32).optional()),
      MCP_URL: z
        .string()
        .optional()
        .transform((value) => value || DEFAULT_MCP_URL),
      KNOWLEDGE_DRIFT_INTERVAL_MINUTES: z.coerce.number().positive().default(10),
      EMAIL_POLL_INTERVAL_SECONDS: z.coerce.number().positive().default(60),
      NODE_ENV: z.string().optional(),
      ...channelProviderEnvShape,
    })
    .superRefine((config, context) => {
      if (roles.has("listener") || roles.has("processor")) {
        checkChannelProviderEnv(config, (variable, message) =>
          context.addIssue({ code: "custom", path: [variable], message }),
        );
      }
    });
}

export type Config = z.infer<ReturnType<typeof createConfigSchema>>;

/**
 * Reads and validates the worker's configuration from environment variables. Throws one error that
 * lists every missing or invalid variable, so a misconfigured process fails at startup. When
 * `WORKER_ROLES` itself is invalid, the variables that depend on the roles are not checked, so that
 * the error names the real problem and not settings of roles that the operator never asked for.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsedRoles = parseWorkerRoles(env.WORKER_ROLES);
  const roles = new Set<WorkerRole>("roles" in parsedRoles ? parsedRoles.roles : []);
  const result = createConfigSchema(roles).safeParse(env);

  if (!result.success) {
    const problems = result.error.issues.map(
      (issue) => `${issue.path.join(".")}: ${issue.message}`,
    );

    throw new Error(`Invalid worker configuration:\n${problems.join("\n")}`);
  }

  return result.data;
}
