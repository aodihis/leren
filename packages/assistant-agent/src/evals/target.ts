import { createTool } from "@anvia/core";
import type { AgentResponse, AgentToolInput, Message } from "@anvia/core";
import type { EvalTarget } from "@anvia/core/evals";
import { createObserver } from "@leren/observability";
import { z } from "zod";
import { createAssistantAgent } from "../agent";
import { getAgentModel, getInstructions } from "./models";

/** The moment that every eval treats as now, so that periods have a fixed status. */
const NOW = new Date("2026-11-22T10:00:00.000Z");

/** One turn of the conversation before the message that the agent must answer. */
export type Turn = { role: "user" | "assistant"; content: string };

/** A playbook in the fake store that the playbook tools read and write. */
export type PlaybookFixture = {
  id: string;
  topic: string;
  information: string;
  timezone: string;
  enabled: boolean;

  instruction: string;
  startsAt: string | null;
  endsAt: string | null;
  /** The connected account that the playbook answers on, or null when it names none. */
  channelAccountId: string | null;
};

/** A connected email account of the user in the fake store. */
export type AccountFixture = { id: string; label: string };

/** A tool call that the agent made during the run, in order. */
export type ToolCall = { name: string; input: Readonly<Record<string, unknown>> };

/** What the agent produced: its final text, the tool calls it made and the store afterwards. */
export type AssistantEvalOutput = {
  text: string;
  toolCalls: readonly ToolCall[];
  playbooks: readonly PlaybookFixture[];
  /** The agent run's trace, which lets the reporter link a result to the run that produced it. */
  trace?: AgentResponse["trace"];
};

/**
 * The input of one eval case. `conversation` ends with the user message to answer, `playbooks`
 * seeds the store, and `accounts` are the connected email accounts of the user. Without it the user
 * has one account.
 */
export type AssistantEvalInput = {
  conversation: readonly Turn[];
  playbooks: readonly PlaybookFixture[];
  accounts?: readonly AccountFixture[];
};

const DEFAULT_ACCOUNTS: readonly AccountFixture[] = [{ id: "acct-main", label: "me@example.com" }];

/** Builds a playbook fixture. Anything that is not given is empty, enabled and without a period. */
export function playbook(
  fields: Pick<PlaybookFixture, "id" | "topic" | "information"> & Partial<PlaybookFixture>,
): PlaybookFixture {
  return {
    timezone: "Asia/Jakarta",
    enabled: true,
    instruction: "",
    startsAt: null,
    endsAt: null,
    channelAccountId: "acct-main",
    ...fields,
  };
}

function periodStatus(item: PlaybookFixture): "scheduled" | "active" | "expired" {
  if (item.startsAt && new Date(item.startsAt) > NOW) {
    return "scheduled";
  }

  return item.endsAt && new Date(item.endsAt) < NOW ? "expired" : "active";
}

/**
 * The view of a playbook that the real MCP tools return. `usable` is true only for an enabled
 * playbook whose period includes now, which is the definition in `@leren/knowledge`.
 */
function toView(item: PlaybookFixture) {
  const status = periodStatus(item);

  return {
    ...item,
    periodStatus: status,
    usable: item.enabled && status === "active",
    conditions: [{ channel: "email", senderMode: "any", channelAccountId: item.channelAccountId }],
  };
}

/** The arguments that a write call names: those that are set, without the conditions. */
function defined(input: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(input).filter(([key, value]) => key !== "conditions" && value !== undefined),
  );
}

/**
 * Builds the playbook tools over an in-memory store. Names, descriptions and argument shapes match
 * the MCP tools in `@leren/mcp-server` and `apps/api`, so the agent sees the same tool surface as
 * in production. The store is the only state, and `search_playbooks` is a keyword match that
 * returns enabled playbooks that are valid now.
 */
function createFakePlaybookTools(
  initial: readonly PlaybookFixture[],
  accounts: readonly AccountFixture[],
) {
  const store = initial.map((item) => ({ ...item }));

  /**
   * Chooses the account of a playbook the way the real tool does (decision 0044): a playbook that
   * is on takes the account that is named, or else the only account, and otherwise the tool fails
   * with the message that tells the assistant what to do.
   */
  const chooseAccount = (requested: string | undefined, enabled: boolean): string | null => {
    if (!enabled) {
      return requested ?? null;
    }

    if (requested) {
      if (!accounts.some((account) => account.id === requested)) {
        throw new Error(
          "conditions: channelAccountId is not one of the user's active accounts. Use the id of a connected account.",
        );
      }

      return requested;
    }

    const [only] = accounts;

    if (accounts.length === 1 && only) {
      return only.id;
    }

    if (accounts.length === 0) {
      throw new Error(
        "conditions: The user has no connected email account. A playbook that is on needs one. Ask the user to connect one on the Channels page, and try again after that.",
      );
    }

    const choices = accounts.map((account) => `${account.label} (${account.id})`).join(", ");

    throw new Error(
      `conditions: The user has several email accounts: ${choices}. Ask the user which one the playbook answers on, and pass its id as channelAccountId.`,
    );
  };

  const find = (id: string) => {
    const item = store.find((entry) => entry.id === id);

    if (!item) {
      throw new Error("Not found");
    }

    return item;
  };

  const fields = z.object({
    enabled: z.boolean().optional().describe("Whether the playbook is on. Defaults to true."),
    topic: z.string().describe("The subject of the playbook, up to 200 characters."),
    information: z
      .string()
      .describe("What the assistant knows about the subject, up to 5000 characters."),
    timezone: z.string().describe("An IANA timezone name, such as Asia/Jakarta."),
    instruction: z
      .string()
      .optional()
      .describe("How to answer when this playbook is used. It replaces the default instruction."),
    startsAt: z
      .string()
      .nullable()
      .optional()
      .describe("When the playbook starts, or null for none."),
    endsAt: z.string().nullable().optional().describe("When the playbook ends, or null for none."),
    conditions: z
      .array(
        z
          .object({
            channel: z.literal("email"),
            channelAccountId: z
              .string()
              .optional()
              .describe(
                "The id of the connected account that the playbook answers on. Leave it out to use the only account that the user has.",
              ),
          })
          .passthrough(),
      )
      .optional()
      .describe(
        "The reply conditions for each channel, such as who may be answered. Name the channel in each entry. Anything left out keeps its current or default value, and a channel that is not named is unchanged.",
      ),
  });

  const tools: AgentToolInput[] = [
    createTool({
      name: "list_playbooks",
      description:
        "List the user's playbooks with their conditions, optionally only the enabled or only the disabled ones, or only the playbooks that are usable now.",
      inputSchema: z.object({
        enabled: z.boolean().optional(),
        usableOnly: z.boolean().optional(),
      }),
      handler: ({ enabled, usableOnly }) => ({
        playbooks: store.flatMap((item) => {
          const view = toView(item);

          const keep =
            (enabled === undefined || item.enabled === enabled) && (!usableOnly || view.usable);

          return keep ? [view] : [];
        }),
      }),
    }),
    createTool({
      name: "get_playbook",
      description: "Get one playbook of the user.",
      inputSchema: z.object({ playbookId: z.string() }),
      handler: ({ playbookId }) => toView(find(playbookId)),
    }),
    createTool({
      name: "search_playbooks",
      description:
        "Find the enabled playbooks that are valid now and match a text. Returns no matches when nothing is reliably close.",
      inputSchema: z.object({ query: z.string().min(1).max(2000) }),
      handler: ({ query }) => {
        const words = query
          .toLowerCase()
          .split(/\W+/)
          .filter((word) => word.length > 3);

        const matches = store.flatMap((item) => {
          const view = toView(item);
          const text = [view.topic, view.information].join(" ").toLowerCase();

          const found =
            view.enabled &&
            view.periodStatus === "active" &&
            words.some((word) => text.includes(word));

          return found ? [{ score: 0.8, playbook: view }] : [];
        });

        return matches.length === 0
          ? { status: "no_reliable_result", matches: [] }
          : { status: "matched", matches };
      },
    }),
    createTool({
      name: "create_playbook",
      description:
        "Create a playbook for the user. Call it only after the user has confirmed the exact content.",
      inputSchema: fields,
      handler: (input) => {
        const created = playbook({
          id: crypto.randomUUID(),
          topic: input.topic,
          information: input.information,
          ...defined(input),
          channelAccountId: chooseAccount(
            input.conditions?.[0]?.channelAccountId,
            input.enabled ?? true,
          ),
        });

        store.push(created);

        return toView(created);
      },
    }),
    createTool({
      name: "update_playbook",
      description:
        "Change an existing playbook of the user. Name only the fields to change. Call it only after the user has confirmed the exact content.",
      inputSchema: fields.partial().extend({ playbookId: z.string() }),
      handler: ({ playbookId, ...changes }) => {
        const item = find(playbookId);

        Object.assign(item, defined(changes));

        return toView(item);
      },
    }),
  ];

  return { tools, store };
}

/**
 * Lists the tool calls in the messages of a run. The messages of a run start at the user message
 * that it answered and hold nothing from earlier turns, so every assistant message is the agent's.
 */
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

const model = await getAgentModel();
const instructions = await getInstructions();
const observer = createObserver();

/** Where eval results are recorded. It is empty when no tracing backend is configured. */
export const reporters = [observer.evalReporter()].filter((reporter) => reporter !== undefined);

/**
 * Runs the real Assistant Agent, with its production prompt, skills and model, against the fake
 * playbook store, and returns what it said and which tools it called. Call `closeTarget` when all
 * evals have finished so that traces are flushed.
 */
export const target: EvalTarget<AssistantEvalInput, AssistantEvalOutput> = async (
  input,
  _testCase,
  context,
) => {
  const { tools, store } = createFakePlaybookTools(
    input.playbooks,
    input.accounts ?? DEFAULT_ACCOUNTS,
  );

  const { agent, close } = await createAssistantAgent({ model, instructions, observer, tools });

  try {
    const messages: Message[] = input.conversation.map((turn) => ({
      role: turn.role,
      content: turn.content,
    }));

    const response = await agent.generate({ messages, abortSignal: context?.signal });

    return {
      text: response.text,
      toolCalls: toolCallsOf(response.messages),
      playbooks: store,
      trace: response.trace,
    };
  } finally {
    await close();
  }
};

/** Flushes the traces that the target's observer collected. */
export async function closeTarget(): Promise<void> {
  await observer.close();
}
