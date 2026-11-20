/** The wire protocols an OpenAI-compatible endpoint can speak. */
export type ModelApi = "responses" | "chat";

/** The reasoning effort levels a model can be asked to use. */
export type ReasoningEffort = "minimal" | "low" | "medium" | "high";

/**
 * One model the harness can run an agent on, together with the client that talks to it.
 *
 * `modelId` is the identifier the provider expects. `apiKeyEnv` names the environment variable that
 * holds the credentials, so the config file never contains a secret. `baseUrl` selects the
 * endpoint of an OpenAI-compatible service and defaults to the provider's own. `api` selects the
 * wire protocol and defaults to `"responses"`. When `reasoningEfforts` is empty the model does not
 * support reasoning effort, and `defaultReasoningEffort` must be omitted.
 */
export interface ModelDefinition {
  readonly provider: "openai";
  readonly modelId: string;
  readonly apiKeyEnv: string;
  readonly baseUrl?: string;
  readonly api?: ModelApi;
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

/** The tasks whose model is chosen by an environment variable. */
export type ModelTask = "assistant" | "reply";

/**
 * The environment variable that holds the harness model key for each task. An unset or empty
 * variable selects `defaultModel`.
 */
export const MODEL_TASK_ENV: Readonly<Record<ModelTask, string>> = {
  assistant: "ASSISTANT_MODEL",
  reply: "REPLY_MODEL",
};

/** A model chosen for a task, with the key it has in the config. */
export interface ResolvedModel {
  readonly key: string;
  readonly definition: ModelDefinition;
  readonly apiKey: string;
}

/**
 * Finds the model a task runs on and reads its API key.
 *
 * The task's environment variable names a key of `config.models`. Throws an error that lists the
 * available keys when the key is unknown, and an error that names the variable when the model's
 * API key is not set, so a misconfigured process fails before the first request.
 */
export function resolveTaskModel(
  config: HarnessConfig,
  task: ModelTask,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedModel {
  const variable = MODEL_TASK_ENV[task];
  const key = env[variable] || config.defaultModel;
  const definition = config.models[key];

  if (!definition) {
    const available = Object.keys(config.models).join(", ");

    throw new Error(`${variable}="${key}" is not a model in the harness. Available: ${available}`);
  }

  const apiKey = env[definition.apiKeyEnv];

  if (!apiKey) {
    throw new Error(`${definition.apiKeyEnv} is not set, but model "${key}" needs it`);
  }

  return { key, definition, apiKey };
}

/** Returns the config unchanged, so that a config file gets full type checking. */
export function defineHarnessConfig(config: HarnessConfig): HarnessConfig {
  return config;
}
