import { OpenAIClient } from "@anvia/openai";
import type { CompletionModel } from "@anvia/core";

/** Settings for the language model provider. */
export interface ModelOptions {
  readonly apiKey: string;
  readonly modelId: string;
}

/**
 * Creates the completion model used by agents.
 *
 * The provider receives its credentials explicitly, so the caller decides where the key is read
 * from. Agents depend on the `CompletionModel` interface, so another provider can replace this
 * function without changing them.
 */
export function createModel(options: ModelOptions): CompletionModel {
  const client = new OpenAIClient({ apiKey: options.apiKey });

  return client.completionModel({ modelId: options.modelId, api: "responses" });
}
