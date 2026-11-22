import type { CompletionModel } from "@anvia/core";
import { createModel, loadHarness } from "@leren/agents";

/** The harness model keys that grade answers when `EVAL_JUDGE_MODEL` is not set, in order of preference. */
const JUDGE_CANDIDATES = ["gpt-6-luna-gateway", "gpt-5-mini", "glm-5.3-gateway"];

/**
 * Builds the model that the Assistant Agent runs on during an eval. It is the model that
 * `ASSISTANT_MODEL` selects, so an eval measures the model that the product uses.
 */
export async function getAgentModel(): Promise<CompletionModel> {
  const harness = await loadHarness();

  return harness.createModel("assistant");
}

/** Reads the system prompt that the product gives the Assistant Agent. */
export async function getInstructions(): Promise<string> {
  const harness = await loadHarness();

  return harness.readPrompt("assistant");
}

/**
 * Returns a model that never sends `temperature`. Reasoning models reject a fixed temperature with
 * a 400 error, and the library's extraction-based metrics, such as faithfulness, set one.
 */
function withoutTemperature(model: CompletionModel): CompletionModel {
  return {
    provider: model.provider,
    modelId: model.modelId,
    contextLimits: model.contextLimits,
    capabilities: model.capabilities,
    controls: model.controls,
    traceRequest: model.traceRequest?.bind(model),
    completion: (request, options) =>
      model.completion({ ...request, temperature: undefined }, options),
  };
}

/**
 * Builds the model that grades answers. `EVAL_JUDGE_MODEL` names a model in `harness.config.ts`.
 * Without it, the first of the preferred models whose API key is set and that differs from the
 * agent's model is used. The judge must differ from the agent's model, because a model that grades
 * its own answers is lenient toward its own mistakes, so this throws when they are the same.
 */
export async function getJudgeModel(): Promise<CompletionModel> {
  const harness = await loadHarness();
  const agentKey = process.env.ASSISTANT_MODEL || harness.config.defaultModel;
  const requested = process.env.EVAL_JUDGE_MODEL;

  const usable = (key: string) => {
    const definition = harness.config.models[key];

    return (
      definition !== undefined && key !== agentKey && Boolean(process.env[definition.apiKeyEnv])
    );
  };

  const key = requested || JUDGE_CANDIDATES.find(usable);
  const definition = key ? harness.config.models[key] : undefined;

  if (!key || !definition) {
    const available = Object.keys(harness.config.models).join(", ");

    throw new Error(`No judge model is available. Set EVAL_JUDGE_MODEL to one of: ${available}`);
  }

  if (key === agentKey) {
    throw new Error(
      `The judge model "${key}" is also the agent's model. Set EVAL_JUDGE_MODEL to another model.`,
    );
  }

  const apiKey = process.env[definition.apiKeyEnv];

  if (!apiKey) {
    throw new Error(`The judge model "${key}" needs ${definition.apiKeyEnv} to be set.`);
  }

  return withoutTemperature(
    createModel({
      apiKey,
      modelId: definition.modelId,
      baseUrl: definition.baseUrl,
      api: definition.api,
    }),
  );
}
