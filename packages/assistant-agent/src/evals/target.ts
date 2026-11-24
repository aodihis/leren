import { createTool } from "@anvia/core";
import type { AgentResponse, AgentToolInput, Message } from "@anvia/core";
import type { EvalTarget } from "@anvia/core/evals";
import { createObserver } from "@leren/observability";
import { z } from "zod";
import { createAssistantAgent } from "../agent";
import { getAgentModel, getInstructions } from "./models";

/** The fixed time that every eval treats as now. */
const NOW = new Date("2026-11-22T10:00:00.000Z");

/** One turn of the conversation before the message. */
export type Turn = { role: "user" | "assistant"; content: string };

/** A playbook in the fake store. */
export type PlaybookFixture = {
  id: string;
  topic: string;
  response: string;
  timezone: string;
  enabled: boolean;
  examples: readonly string[];
  restrictions: string;
  startsAt: string | null;
  endsAt: string | null;
  /** The connected account of a playbook, or null. */
  channelAccountId: string | null;
};

/** A connected email account in the fake store. */
export type AccountFixture = { id: string; label: string };

/** A tool call that the agent made during the run. */
export type ToolCall = { name: string; input: Readonly<Record<string, unknown>> };

/** What the agent produced during a run. */
export type AssistantEvalOutput = {
  text: string;
  toolCalls: readonly ToolCall[];
  playbooks: readonly PlaybookFixture[];
  /** The trace of the agent run. */
  trace?: AgentResponse["trace"];
};

/** The input of one eval case. */
export type AssistantEvalInput = {
  conversation: readonly Turn[];
  playbooks: readonly PlaybookFixture[];
  accounts?: readonly AccountFixture[];
};

const DEFAULT_ACCOUNTS: readonly AccountFixture[] = [{ id: "acct-main", label: "me@example.com" }];

/** Builds a playbook fixture. */
export function playbook(
  fields: Pick<PlaybookFixture, "id" | "topic" | "response"> & Partial<PlaybookFixture>,
): PlaybookFixture {
  return {
    timezone: "Asia/Jakarta",
    enabled: true,
    examples: [],
    restrictions: "",
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

/** The playbook view that the MCP tools return. */
function toView(item: PlaybookFixture) {
  const status = periodStatus(item);

  return {
    ...item,
    periodStatus: status,
    usable: item.enabled && status === "active",
    conditions: [{ channel: "email", senderMode: "any", channelAccountId: item.channelAccountId }],
  };
}

/** The arguments that a write call names. */
function defined(input: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(input).filter(([key, value]) => key !== "conditions" && value !== undefined),
  );
}

/** Builds the playbook tools over an in-memory store. */
function createFakePlaybookTools(
  initial: readonly PlaybookFixture[],
  accounts: readonly AccountFixture[],
) {
  const store = initial.map((item) => ({ ...item }));

  /** Chooses the account of a playbook. */
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
    response: z.string().describe("What may be said about the subject, up to 5000 characters."),
    timezone: z.string().describe("An IANA timezone name, such as Asia/Jakarta."),
    examples: z.array(z.string()).optional().describe("Sample incoming messages."),
    restrictions: z.string().optional().describe("What must not be said."),
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
          const text = [view.topic, view.response, ...view.examples].join(" ").toLowerCase();

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
          response: input.response,
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

const model = await getAgentModel();
const instructions = await getInstructions();
const observer = createObserver();

/** Where eval results are recorded. */
export const reporters = [observer.evalReporter()].filter((reporter) => reporter !== undefined);

/** Runs the real assistant against the fake store. */
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

/** Flushes the collected traces. */
export async function closeTarget(): Promise<void> {
  await observer.close();
}
