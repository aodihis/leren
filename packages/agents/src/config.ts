/** The reasoning effort levels a model can be asked to use. */
export type ReasoningEffort = "minimal" | "low" | "medium" | "high";

/**
 * One model the harness can run an agent on, together with the client that talks to it.
 *
 * `modelId` is the identifier the provider expects. `apiKeyEnv` names the environment variable that
 * holds the credentials, so the config file never contains a secret. When `reasoningEfforts` is
 * empty the model does not support reasoning effort, and `defaultReasoningEffort` must be omitted.
 */
export interface ModelDefinition {
  readonly provider: "openai";
  readonly modelId: string;
  readonly apiKeyEnv: string;
  readonly contextWindow: number;
  readonly maxOutputTokens: number;
  readonly reasoningEfforts: readonly ReasoningEffort[];
  readonly defaultReasoningEffort?: ReasoningEffort;
}

/** The agents that take a system prompt from the harness config. */
export type AgentName = "assistant" | "reply";

/**
 * The single configuration file of the harness, `harness.config.ts` in the repository root.
 *
 * Paths are relative to the directory that contains the config file. `models` is keyed by a
 * name chosen here, and `defaultModel` must be one of those keys.
 */
export interface HarnessConfig {
  readonly prompts: Readonly<Record<AgentName, string>>;
  readonly models: Readonly<Record<string, ModelDefinition>>;
  readonly defaultModel: string;
  readonly pluginsDir: string;
}

/** Returns the config unchanged, so that a config file gets full type checking. */
export function defineHarnessConfig(config: HarnessConfig): HarnessConfig {
  return config;
}
