import { MaxTurnsError, createTool } from "@anvia/core";
import type { AnyTool, Message } from "@anvia/core";
import type { EvalTarget } from "@anvia/core/evals";
import { loadHarness } from "@leren/agents";
import { z } from "zod";
import { generateReply } from "../../agents/drafter/agent";
import { allowedTools } from "../../agents/drafter/utils/mcp";
import { prepareEmail, wrapUntrusted } from "../../pipeline/guardrails";
import { lowestReasoningEffort, parseJsonOutput } from "../../pipeline/llm";
import { collectPlaybooks, keepAllowed } from "../../pipeline/playbooks";
import type { Playbook } from "../../pipeline/playbooks";
import {
  buildAnswerInstructions,
  buildAnswerPrompt,
  readReplyPrompts,
} from "../../pipeline/prompts";
import { MAX_OUTPUT_TOKENS, answerSchema } from "../../pipeline/types";
import type { Answer, Category, Email } from "../../pipeline/types";
import { observer } from "../observer";

/** The input of one drafter case: the email, what triage found in it, and what search returns. */
export type DrafterInput = {
  email: Email;
  category: Category;
  /** The questions that triage would list. They are fixed, so triage cannot change the result. */
  questions: readonly string[];
  /** The user's playbooks that match any query. An empty list is no reliable result. */
  playbooks: readonly Playbook[];
  /**
   * The ids that the email gate allowed for the message. As in a reply session of the MCP server,
   * the tools return only these playbooks. Unset means that every playbook of the case is allowed.
   */
  allowedPlaybookIds?: readonly string[];
  replyInstructions?: string;
};

/** A tool call that the drafter made during the run, in order. */
export type ToolCall = { name: string; input: Readonly<Record<string, unknown>> };

/** What one drafter run produced. */
export type DrafterOutput = {
  /** The final text of the run, or an empty string when the run reached its turn limit. */
  raw: string;
  /** The answer read from `raw`, or undefined when `raw` is not a valid answer. */
  answer: Answer | undefined;
  toolCalls: readonly ToolCall[];
  /** The names of the MCP tools that the drafter was offered. */
  offeredTools: readonly string[];
  /** The ids of the playbooks that the tools could return: the case's playbooks that the gate allowed. */
  readableIds: readonly string[];
  /** The ids of the playbooks that the drafter's tool calls returned. */
  foundIds: readonly string[];
  turnLimitReached: boolean;
};

/** The view of a playbook that the real MCP tools return. Every fixture is usable now. */
function toView(item: Playbook) {
  return { ...item, enabled: true, usable: true, periodStatus: "active" };
}

const notCalled = () => {
  throw new Error("This tool is not part of the drafter eval.");
};

/**
 * Builds a fake of every tool that the real MCP server registers, including the tools that read
 * mail and change data. Names, descriptions and result shapes match `@leren/mcp-server`. The
 * search returns every playbook of the case for any query, so the case controls exactly what the
 * drafter finds, and the drafter must pick the right playbook itself.
 */
function createFakeMcpTools(playbooks: readonly Playbook[]): Record<string, AnyTool> {
  const any = z.object({}).passthrough();

  return {
    search_playbooks: createTool({
      name: "search_playbooks",
      description:
        "Find the enabled playbooks that are valid now and match a text. Returns no matches when nothing is reliably close.",
      inputSchema: z.object({ query: z.string().min(1).max(2000) }),
      handler: () => ({
        outcome: "ok",
        data:
          playbooks.length === 0
            ? { status: "no_reliable_result", matches: [] }
            : {
                status: "ok",
                matches: playbooks.map((item) => ({ score: 0.8, playbook: toView(item) })),
              },
      }),
    }),
    get_playbook: createTool({
      name: "get_playbook",
      description: "Get one playbook of the user.",
      inputSchema: z.object({ playbookId: z.string() }),
      handler: ({ playbookId }) => {
        const item = playbooks.find((entry) => entry.id === playbookId);

        if (!item) {
          throw new Error("Not found");
        }

        return { outcome: "ok", data: toView(item) };
      },
    }),
    list_playbooks: createTool({
      name: "list_playbooks",
      description: "List the user's playbooks with their conditions.",
      inputSchema: any,
      handler: () => ({ outcome: "ok", data: { playbooks: playbooks.map(toView) } }),
    }),
    describe_playbook_fields: createTool({
      name: "describe_playbook_fields",
      description: "Describe every field of a playbook.",
      inputSchema: any,
      handler: notCalled,
    }),
    list_messages: createTool({
      name: "list_messages",
      description: "List the user's received emails.",
      inputSchema: any,
      handler: notCalled,
    }),
    get_message: createTool({
      name: "get_message",
      description: "Get one received email of the user.",
      inputSchema: any,
      handler: notCalled,
    }),
    create_playbook: createTool({
      name: "create_playbook",
      description: "Create a playbook for the user.",
      inputSchema: any,
      handler: () => ({ outcome: "ok" }),
    }),
    update_playbook: createTool({
      name: "update_playbook",
      description: "Change an existing playbook of the user. Name only the fields to change.",
      inputSchema: any,
      handler: () => ({ outcome: "ok" }),
    }),
  };
}

/** Lists the tool calls in the messages of a run. */
function toolCallsOf(messages: readonly Message[]): ToolCall[] {
  return messages.flatMap((message) => {
    if (message.role !== "assistant" || typeof message.content === "string") {
      return [];
    }

    return message.content.flatMap((part) =>
      part.type === "tool-call"
        ? [{ name: part.toolName, input: part.input as Record<string, unknown> }]
        : [],
    );
  });
}

const harness = await loadHarness();
const model = harness.createModel("reply");
const prompts = await readReplyPrompts(harness);

/**
 * Runs the first attempt of the drafter, with its production prompt and model, against fake MCP
 * tools. The fakes pass through the drafter's own `allowedTools`, the list that the real MCP
 * connection uses, so a write tool reaches the drafter only if that list lets it through. The fakes
 * return only the playbooks that the gate allowed, as the reply session of the MCP server does.
 * There is no revision and no content judge, so the result measures the drafter alone.
 */
export const target: EvalTarget<DrafterInput, DrafterOutput> = async (
  input,
  _testCase,
  context,
) => {
  const allowed: readonly string[] = allowedTools;

  const readable = keepAllowed(
    input.playbooks,
    input.allowedPlaybookIds && new Set(input.allowedPlaybookIds),
  );

  const offered = Object.entries(createFakeMcpTools(readable)).filter(([name]) =>
    allowed.includes(name),
  );

  let raw = "";
  let messages: readonly Message[];
  let turnLimitReached = false;

  try {
    const run = await generateReply({
      instructions: buildAnswerInstructions(prompts.rules, input.replyInstructions),
      prompt: buildAnswerPrompt({
        email: wrapUntrusted(prepareEmail(input.email)),
        category: input.category,
        questions: input.questions,
        playbooks: [],
        feedback: [],
        previousBody: undefined,
      }),
      model,
      observer,
      tools: offered.map(([, tool]) => tool),
      maxTokens: MAX_OUTPUT_TOKENS.answer,
      controls: lowestReasoningEffort(model),
      abortSignal: context?.signal,
    });

    raw = run.output;
    messages = run.messages;
  } catch (error) {
    if (!(error instanceof MaxTurnsError)) {
      throw error;
    }

    messages = error.chatHistory;
    turnLimitReached = true;
  }

  const parsed = parseJsonOutput(raw, answerSchema);

  return {
    raw,
    answer: parsed.ok ? parsed.value : undefined,
    toolCalls: toolCallsOf(messages),
    offeredTools: offered.map(([name]) => name),
    readableIds: readable.map((item) => item.id),
    foundIds: collectPlaybooks(messages).map((item) => item.id),
    turnLimitReached,
  };
};
