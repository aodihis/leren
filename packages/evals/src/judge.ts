import type { CompletionModel } from "@anvia/core";
import { createModel, loadHarness } from "@leren/agents";

/** The harness model keys that grade answers when `EVAL_JUDGE_MODEL` is not set, in order of preference. */
const JUDGE_CANDIDATES = ["gpt-6-luna-gateway", "gpt-5-mini", "glm-5.3-gateway"];

/** Options of `getJudgeModel`. */
export interface JudgeModelOptions {
  /** Environment variables that select the models under evaluation. The judge differs from all of them. */
  readonly agentModelEnvs: readonly string[];
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
 * Builds the model that grades answers. `EVAL_JUDGE_MODEL` names a model in `harness.config.ts`,
 * and otherwise the first preferred model with an API key is used. The judge must differ from the
 * models under evaluation, because a model is lenient toward its own mistakes.
 */
export async function getJudgeModel(options: JudgeModelOptions): Promise<CompletionModel> {
  const harness = await loadHarness();

  const excluded = options.agentModelEnvs.map(
    (name) => process.env[name] || harness.config.defaultModel,
  );

  const requested = process.env.EVAL_JUDGE_MODEL;

  const usable = (key: string) => {
    const definition = harness.config.models[key];

    return (
      definition !== undefined &&
      !excluded.includes(key) &&
      Boolean(process.env[definition.apiKeyEnv])
    );
  };

  const key = requested || JUDGE_CANDIDATES.find(usable);
  const definition = key ? harness.config.models[key] : undefined;

  if (!key || !definition) {
    const available = Object.keys(harness.config.models).join(", ");

    throw new Error(`No judge model is available. Set EVAL_JUDGE_MODEL to one of: ${available}`);
  }

  if (excluded.includes(key)) {
    throw new Error(
      `The judge model "${key}" is also a model under evaluation. Set EVAL_JUDGE_MODEL to another model.`,
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
