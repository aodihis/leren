import { generateCompletion } from "@anvia/core";
import type { CompletionModel } from "@anvia/core";
import type { z } from "zod";

/** The result of reading a model's text as JSON. */
export type ParsedOutput<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: string };

/** Finds the JSON object in a model's text. */
function extractJson(text: string): string | undefined {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");

  return start === -1 || end < start ? undefined : text.slice(start, end + 1);
}

/** The start of a model's text, for an error message. */
function snippet(text: string): string {
  return JSON.stringify(text.slice(0, 200));
}

/** Reads a model's text as validated JSON. */
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

/** Thrown when a model's answer is not valid JSON. */
export class InvalidModelOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidModelOutputError";
  }
}

/** What generateJson needs to ask a question. */
export interface GenerateJsonOptions<Value> {
  readonly model: CompletionModel;
  readonly instructions: string;
  readonly prompt: string;
  readonly schema: z.ZodType<Value>;
  readonly abortSignal?: AbortSignal | undefined;
}

/** Asks a model one question and returns an object. */
export async function generateJson<Value>(options: GenerateJsonOptions<Value>): Promise<Value> {
  const response = await generateCompletion({
    model: options.model,
    instructions: options.instructions,
    prompt: options.prompt,
    abortSignal: options.abortSignal,
  });

  const parsed = parseJsonOutput(response.text, options.schema);

  if (!parsed.ok) {
    throw new InvalidModelOutputError(`${parsed.error} Output: ${snippet(response.text)}`);
  }

  return parsed.value;
}
