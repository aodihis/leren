/** The wire protocols an endpoint can speak. */
export type ModelApi = "responses" | "chat";

/** The reasoning effort levels of a model. */
export type ReasoningEffort = "minimal" | "low" | "medium" | "high";

/** One model the harness can run an agent on. */
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

/** One embedding model the harness can use. */
export interface EmbeddingModelDefinition {
  readonly provider: "openai";
  readonly modelId: string;
  readonly apiKeyEnv: string;
  readonly baseUrl: string;
  readonly dimensions: number;
}

/** The agents that take a system prompt from config. */
export type AgentName = "assistant" | "reply";

/** The single configuration file of the harness. */
export interface HarnessConfig {
  readonly prompts: Readonly<Record<AgentName, string>>;
  readonly models: Readonly<Record<string, ModelDefinition>>;
  readonly defaultModel: string;
  readonly embeddingModels: Readonly<Record<string, EmbeddingModelDefinition>>;
  readonly defaultEmbeddingModel: string;
  readonly pluginsDir: string;
}

/** The tasks whose model a variable picks. */
export type ModelTask = "assistant" | "reply" | "replyTriage" | "replyJudge";

/** The environment variable of each task's model. */
export const MODEL_TASK_ENV: Readonly<Record<ModelTask, string>> = {
  assistant: "ASSISTANT_MODEL",
  reply: "REPLY_MODEL",
  replyTriage: "REPLY_TRIAGE_MODEL",
  replyJudge: "REPLY_JUDGE_MODEL",
};

/** The fallback task for an unset model variable. */
const FALLBACK_TASK: Readonly<Partial<Record<ModelTask, ModelTask>>> = {
  replyTriage: "reply",
  replyJudge: "reply",
};

/** A model chosen for a task. */
export interface ResolvedModel {
  readonly key: string;
  readonly definition: ModelDefinition;
  readonly apiKey: string;
}

/** Finds the model a task runs on. */
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
  const definition = config.models[key];

  if (!definition) {
    const available = Object.keys(config.models).join(", ");

    throw new Error(`${source}="${key}" is not a model in the harness. Available: ${available}`);
  }

  const apiKey = env[definition.apiKeyEnv];

  if (!apiKey) {
    throw new Error(`${definition.apiKeyEnv} is not set, but model "${key}" needs it`);
  }

  return { key, definition, apiKey };
}

/** The environment variable of the embedding model. */
export const EMBEDDING_MODEL_ENV = "EMBEDDING_MODEL";

/** An embedding model chosen from the config. */
export interface ResolvedEmbeddingModel {
  readonly key: string;
  readonly definition: EmbeddingModelDefinition;
  readonly apiKey: string;
}

/** Finds the embedding model named by the config. */
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

/** Returns the config unchanged for type checking. */
export function defineHarnessConfig(config: HarnessConfig): HarnessConfig {
  return config;
}
