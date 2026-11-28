import { OpenAIClient } from "@anvia/openai";
import { REASONING_EFFORT_CONTROL_ID } from "@anvia/core";
import type { CompletionModel } from "@anvia/core";

import type { ModelApi, ReasoningEffort } from "./config";

/**
 * Settings for the language model provider. `baseUrl` selects the endpoint of an OpenAI-compatible
 * service and `api` the wire protocol. Both are optional and default to the provider's own
 * endpoint and the Responses API.
 */
export interface ModelOptions {
  readonly apiKey: string;
  readonly modelId: string;
  readonly baseUrl?: string;
  readonly api?: ModelApi;
  /**
   * The reasoning efforts that the model accepts, from the lowest to the highest. When it is given,
   * they replace the efforts that the provider's adapter declares for the model id, so a model that
   * the adapter does not know, such as one behind a gateway, can be called with an effort.
   */
  readonly reasoningEfforts?: readonly ReasoningEffort[];
}

/**
 * Creates the completion model used by agents.
 *
 * The provider receives its credentials explicitly, so the caller decides where the key is read
 * from. Agents depend on the `CompletionModel` interface, so another provider can replace this
 * function without changing them.
 */
export function createModel(options: ModelOptions): CompletionModel {
  const client = new OpenAIClient({ apiKey: options.apiKey, baseUrl: options.baseUrl });
  const efforts = options.reasoningEfforts ?? [];

  return client.completionModel({
    modelId: options.modelId,
    api: options.api ?? "responses",
    controls:
      efforts.length > 0
        ? {
            [REASONING_EFFORT_CONTROL_ID]: {
              type: "select",
              label: "Reasoning effort",
              options: [...efforts],
            },
          }
        : undefined,
  });
}
