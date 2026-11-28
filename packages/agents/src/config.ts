/** The wire protocols an OpenAI-compatible endpoint can speak. */
export type ModelApi = "responses" | "chat";

/** The reasoning effort levels a model can be asked to use, from the lowest to the highest. */
export const REASONING_EFFORTS = ["minimal", "low", "medium", "high"] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

/**
 * One model the harness can run an agent on, together with the client that talks to it.
 *
 * `modelId` is the identifier the provider expects. `apiKeyEnv` names the environment variable that
 * holds the credentials, so the config file never contains a secret. `baseUrl` selects the
 * endpoint of an OpenAI-compatible service and defaults to the provider's own. `api` selects the
 * wire protocol and defaults to `"responses"`. `reasoningEfforts` lists the efforts that the model
 * accepts, and a model with efforts must name its `defaultReasoningEffort`, which every call uses
 * unless it asks for another listed effort. An empty list means that the model does not reason,
 * and `defaultReasoningEffort` must be omitted.
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

/**
 * One embedding model the harness can use. `baseUrl` is the endpoint root of an OpenAI-compatible
 * service, `apiKeyEnv` names the variable that holds its key, and `dimensions` is the length of
 * every vector the model returns.
 */
export interface EmbeddingModelDefinition {
  readonly provider: "openai";
  readonly modelId: string;
  readonly apiKeyEnv: string;
  readonly baseUrl: string;
  readonly dimensions: number;
}

/**
 * The prompts that the harness config names. `reply` is the system prompt of the answering agent,
 * and the others are the fixed instructions of the stages of the reply pipeline.
 */
export type AgentName =
  | "assistant"
  | "reply"
  | "replyTriage"
  | "replyJudge"
  | "replyStyle"
  | "replyStyleJudge";

/**
 * The single configuration file of the harness, `harness.config.ts` in the repository root.
 *
 * Paths are relative to the directory that contains the config file. `models` is keyed by a
 * name chosen here, and `defaultModel` must be one of those keys. `embeddingModels` and
 * `defaultEmbeddingModel` follow the same rule for the models that produce vectors.
 */
export interface HarnessConfig {
  readonly prompts: Readonly<Record<AgentName, string>>;
  readonly models: Readonly<Record<string, ModelDefinition>>;
  readonly defaultModel: string;
  readonly embeddingModels: Readonly<Record<string, EmbeddingModelDefinition>>;
  readonly defaultEmbeddingModel: string;
  readonly pluginsDir: string;
}

/** The tasks whose model is chosen by an environment variable. */
export type ModelTask = "assistant" | "reply" | "replyTriage" | "replyJudge";

/**
 * The environment variable that holds the harness model key for each task. An unset or empty
 * variable selects the model of the task's fallback task, if it has one, and otherwise
 * `defaultModel`.
 */
export const MODEL_TASK_ENV: Readonly<Record<ModelTask, string>> = {
  assistant: "ASSISTANT_MODEL",
  reply: "REPLY_MODEL",
  replyTriage: "REPLY_TRIAGE_MODEL",
  replyJudge: "REPLY_JUDGE_MODEL",
};

/**
 * The task whose variable is read when a task's own variable is unset or empty. The triage and
 * judge steps of the reply pipeline follow the Reply Agent until they are given a model of their
 * own.
 */
const FALLBACK_TASK: Readonly<Partial<Record<ModelTask, ModelTask>>> = {
  replyTriage: "reply",
  replyJudge: "reply",
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
  const fallback = FALLBACK_TASK[task];
  const fallbackVariable = fallback && MODEL_TASK_ENV[fallback];

  const source =
    !env[variable] && fallbackVariable && env[fallbackVariable] ? fallbackVariable : variable;

  const key = env[source] || config.defaultModel;

  return resolveModel(config, key, env, `${source}="${key}"`);
}

/**
 * Resolves a model of the config by its key, with its API key from `env`. Throws when the key is
 * not a model of the config, naming it as `label`, or when the model's API key is not set.
 */
export function resolveModel(
  config: HarnessConfig,
  key: string,
  env: NodeJS.ProcessEnv = process.env,
  label = `"${key}"`,
): ResolvedModel {
  const definition = config.models[key];

  if (!definition) {
    const available = Object.keys(config.models).join(", ");

    throw new Error(`${label} is not a model in the harness. Available: ${available}`);
  }

  const apiKey = env[definition.apiKeyEnv];

  if (!apiKey) {
    throw new Error(`${definition.apiKeyEnv} is not set, but model "${key}" needs it`);
  }

  return { key, definition, apiKey };
}

/** The environment variable that holds the key of the embedding model in `embeddingModels`. */
export const EMBEDDING_MODEL_ENV = "EMBEDDING_MODEL";

/** An embedding model chosen from the config, with the key it has there. */
export interface ResolvedEmbeddingModel {
  readonly key: string;
  readonly definition: EmbeddingModelDefinition;
  readonly apiKey: string;
}

/**
 * Finds the embedding model named by `EMBEDDING_MODEL` and reads its API key. An unset or empty
 * variable selects `defaultEmbeddingModel`. The errors are the same as those of `resolveTaskModel`.
 */
export function resolveEmbeddingModel(
  config: HarnessConfig,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedEmbeddingModel {
  const key = env[EMBEDDING_MODEL_ENV] || config.defaultEmbeddingModel;
  const definition = config.embeddingModels[key];

  if (!definition) {
    const available = Object.keys(config.embeddingModels).join(", ");

    throw new Error(
      `${EMBEDDING_MODEL_ENV}="${key}" is not an embedding model in the harness. Available: ${available}`,
    );
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
