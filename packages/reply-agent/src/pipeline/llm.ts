import { generateCompletion } from "@anvia/core";
import type { CompletionModel } from "@anvia/core";
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
 * Thrown when a model answered but its answer cannot be read as the expected JSON. It is the only
 * failure of a model call that is about the content of the answer. Every other error, such as an
 * abort or a provider failure, is a failure of the call and may succeed on a retry.
 */
export class InvalidModelOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidModelOutputError";
  }
}

/** What `generateJson` needs to ask a model one question. */
export interface GenerateJsonOptions<Value> {
  readonly model: CompletionModel;
  readonly instructions: string;
  readonly prompt: string;
  readonly schema: z.ZodType<Value>;
  /** The most tokens that the model may write. */
  readonly maxTokens?: number | undefined;
  readonly abortSignal?: AbortSignal | undefined;
}

/**
 * Asks a model one question with a single completion, without tools, and returns its answer as a
 * validated object. A stage that only classifies or scores what it is given uses this and not an
 * agent. The model is told to answer in JSON by the instructions, and the text is parsed here, so
 * the helper works with every model, whether or not it supports structured output. Throws
 * `InvalidModelOutputError` when the answer is not valid or was cut off at the token limit.
 */
export async function generateJson<Value>(options: GenerateJsonOptions<Value>): Promise<Value> {
  const response = await generateCompletion({
    model: options.model,
    instructions: options.instructions,
    prompt: options.prompt,
    maxTokens: options.maxTokens,
    abortSignal: options.abortSignal,
  });

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
