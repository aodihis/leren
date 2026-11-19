import type {
  AssistantContentPart,
  CompletionModel,
  CompletionModelStreamEvent,
  CompletionRequest,
  CompletionResponse,
} from "@anvia/core";

/** One scripted model turn: plain text, or tool calls the agent must execute. */
export type FakeStep =
  | { readonly text: string }
  | { readonly toolCalls: readonly { readonly name: string; readonly input: unknown }[] };

/** A fake model that supports streaming and records the requests it received. */
export interface FakeModel extends CompletionModel {
  readonly requests: readonly CompletionRequest[];
  streamCompletion(request: CompletionRequest): AsyncIterable<CompletionModelStreamEvent>;
}

const EMPTY_USAGE = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  cachedInputTokens: 0,
  cacheCreationInputTokens: 0,
};

function toResponse(step: FakeStep, turn: number): CompletionResponse {
  if ("text" in step) {
    return {
      choice: [{ type: "text", text: step.text }],
      usage: EMPTY_USAGE,
      finishReason: "stop",
      rawResponse: null,
    };
  }

  return {
    choice: step.toolCalls.map((call, index) => ({
      type: "tool-call" as const,
      toolCallId: `call-${turn}-${index}`,
      toolName: call.name,
      input: call.input as never,
    })),
    usage: EMPTY_USAGE,
    finishReason: "tool-calls",
    rawResponse: null,
  };
}

function toStreamEvent(part: AssistantContentPart): CompletionModelStreamEvent | undefined {
  if (part.type === "text") {
    return { type: "text_delta", delta: part.text };
  }

  if (part.type === "tool-call") {
    return { type: "tool_call", toolCall: part };
  }

  return undefined;
}

/**
 * Creates a model that replays `steps` in order, one per model call, through either
 * `completion` or `streamCompletion`.
 *
 * It makes no network calls, so tests can check agent behavior such as the turn limit, tool use
 * and abstention deterministically. Calling it after the script ends throws, which makes an
 * unexpected extra turn fail the test.
 */
export function createFakeModel(steps: readonly FakeStep[]): FakeModel {
  const requests: CompletionRequest[] = [];

  function nextResponse(request: CompletionRequest): CompletionResponse {
    const step = steps[requests.length];
    requests.push(request);

    if (!step) {
      throw new Error(`The fake model has no scripted step for call ${requests.length}.`);
    }

    return toResponse(step, requests.length);
  }

  return {
    provider: "fake",
    modelId: "fake",
    capabilities: {
      streaming: true,
      tools: true,
      toolChoice: true,
      imageInput: false,
      documentInput: false,
      outputSchema: false,
      reasoning: false,
    },
    requests,
    async completion(request) {
      return nextResponse(request);
    },
    async *streamCompletion(request) {
      const response = nextResponse(request);

      for (const part of response.choice) {
        const event = toStreamEvent(part);

        if (event) {
          yield event;
        }
      }

      yield { type: "final", response };
    },
  };
}
