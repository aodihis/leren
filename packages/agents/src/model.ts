import { OpenAIClient } from "@anvia/openai";
import type { CompletionModel } from "@anvia/core";

import type { ModelApi } from "./config";

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

  return client.completionModel({ modelId: options.modelId, api: options.api ?? "responses" });
}
