import type { CompletionModel } from "@anvia/core";
import { createModel, loadHarness } from "@leren/agents";

/** The default judge model keys. */
const JUDGE_CANDIDATES = ["gpt-6-luna-gateway", "gpt-5-mini", "glm-5.3-gateway"];

/** Builds the model that the assistant runs on. */
export async function getAgentModel(): Promise<CompletionModel> {
  const harness = await loadHarness();

  return harness.createModel("assistant");
}

/** Reads the assistant's system prompt. */
export async function getInstructions(): Promise<string> {
  const harness = await loadHarness();

  return harness.readPrompt("assistant");
}

/** Returns a model that never sends temperature. */
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

/** Builds the model that grades answers. */
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
