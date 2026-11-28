import { createAgent } from "@leren/agents";
import type { Harness, ReasoningEffort } from "@leren/agents";
import type { Observer } from "@leren/observability";
import type { z } from "zod";

/** The result of reading a model's text as JSON that matches a schema. */
export type ParsedOutput<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: string };

/**
 * Finds the JSON object in a model's text, which may be wrapped in a code fence or in sentences,
 * by taking the text from the first opening brace to the last closing brace.
 */
function extractJson(text: string): string | undefined {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");

  return start === -1 || end < start ? undefined : text.slice(start, end + 1);
}

/** The start of a model's text, for an error message. */
function snippet(text: string): string {
  return JSON.stringify(text.slice(0, 200));
}

/** Reads a model's text as JSON and validates it against the schema. It never throws. */
export function parseJsonOutput<Value>(
  text: string,
  schema: z.ZodType<Value>,
): ParsedOutput<Value> {
  const json = extractJson(text);

  if (json === undefined) {
    return { ok: false, error: "The output contains no JSON object." };
  }

  let data: unknown;

  try {
    data = JSON.parse(json);
  } catch {
    return { ok: false, error: "The output is not valid JSON." };
  }

  const result = schema.safeParse(data);

  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, error: `The output does not match the schema: ${result.error.message}` };
}

/**
 * Thrown when a model answered but its answer is not the expected JSON. It is the only model call
 * failure about the answer's content. Every other error, such as an abort or a provider failure, is
 * a failure of the call that a retry may fix.
 */
export class InvalidModelOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidModelOutputError";
  }
}

/** What `generateJson` needs to ask a model one question. */
export interface GenerateJsonOptions<Value> {
  /** The id that names the call in traces, such as `reply-triage`. */
  readonly id: string;
  readonly harness: Pick<Harness, "model">;
  readonly observer: Observer;
  /** The key of the model in the harness config. */
  readonly model: string;
  /**
   * The reasoning effort of the call. The model's default effort in the config is used instead
   * when it is not given or when the model does not list it.
   */
  readonly reasoning?: ReasoningEffort | undefined;
  readonly instructions: string;
  readonly prompt: string;
  readonly schema: z.ZodType<Value>;
  /** The most tokens that the model may write. Without it, the model's own limit applies. */
  readonly maxTokens?: number | undefined;
  readonly abortSignal?: AbortSignal | undefined;
}

/**
 * Asks a model one question with a traced single-turn agent without tools and returns the answer
 * as a validated object. The answer is parsed here as JSON, so any model works without structured
 * output. Throws `InvalidModelOutputError` when the answer is invalid or cut off at the token
 * limit.
 */
export async function generateJson<Value>(options: GenerateJsonOptions<Value>): Promise<Value> {
  const { model, controls } = options.harness.model(options.model, options.reasoning);

  const agent = createAgent({
    id: options.id,
    model,
    instructions: options.instructions,
    maxTurns: 1,
    maxTokens: options.maxTokens,
    controls,
    observer: options.observer,
  });

  const response = await agent.generate({
    prompt: options.prompt,
    abortSignal: options.abortSignal,
  });

  if (response.type !== "response") {
    throw new InvalidModelOutputError(`The model stopped without an answer: ${response.type}.`);
  }

  if (response.finishReason === "length") {
    throw new InvalidModelOutputError(
      `The answer was cut off at the limit of ${options.maxTokens ?? "the model's"} output tokens.`,
    );
  }

  const parsed = parseJsonOutput(response.text, options.schema);

  if (!parsed.ok) {
    throw new InvalidModelOutputError(`${parsed.error} Output: ${snippet(response.text)}`);
  }

  return parsed.value;
}
