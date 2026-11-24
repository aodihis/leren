import { OpenAIClient } from "@anvia/openai";
import type { CompletionModel } from "@anvia/core";

import type { ModelApi } from "./config";

/** Settings for the language model provider. */
export interface ModelOptions {
  readonly apiKey: string;
  readonly modelId: string;
  readonly baseUrl?: string;
  readonly api?: ModelApi;
}

/** Creates the completion model used by agents. */
export function createModel(options: ModelOptions): CompletionModel {
  const client = new OpenAIClient({ apiKey: options.apiKey, baseUrl: options.baseUrl });

  return client.completionModel({ modelId: options.modelId, api: options.api ?? "responses" });
}
